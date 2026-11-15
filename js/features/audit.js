// js/features/audit.js
import { DB } from '../core/db.js';
import { Sync } from '../core/sync.js';
import { UI } from '../core/ui.js';
import { Locations } from './locations.js';
import { Categories } from './categories.js';
import { Users } from './users.js';

/**
 * Audit Management Service (v18.0.0 Hierarchical Flow)
 * Manages full lifecycle: Individual & Group sessions, Location Grids,
 * Category Grids, Smart Sorting (Uncounted on top, Counted at bottom with ✅),
 * Hold, Resume, and Finalize.
 */

export const Audit = {
    currentSessionId: null,
    currentLocationId: null,
    currentCategoryId: null,

    async init() {
        console.log('Audit: Initializing Hierarchical Audit Engine...');
    },

    async getAllSessions() {
        try {
            const sessions = (await DB.getAll('audit_sessions')) || [];
            return sessions.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
        } catch (err) {
            console.warn('Error fetching audit sessions:', err);
            return [];
        }
    },

    async getSession(id) {
        if (!id) return null;
        return (await DB.get('audit_sessions', id)) || null;
    },

    async saveSession(session) {
        if (!session.id) session.id = `audit_${Date.now()}`;
        session.updatedAt = new Date().toISOString();
        await DB.put('audit_sessions', session);
        
        // Broadcast in team mode
        if (session.type === 'group') {
            Sync.broadcastAuditStatus(session);
        }
        return session;
    },

    async createSession({ name, type = 'individual', locationIds = [] }) {
        const activeUser = Users.getActive();
        const uName = activeUser?.name || 'صيدلي';

        if (type === 'group' && activeUser?.role !== 'admin' && window.App?.userRole !== 'admin') {
            UI.showToast('صلاحيات المدير مفضلة لإنشاء جرد جماعي للفريق ⚖️', 'info');
        }

        const session = {
            id: `audit_${Date.now()}`,
            name: name || `جرد ${type === 'individual' ? 'فردي' : 'جماعي'} - ${new Date().toLocaleDateString('ar-EG')}`,
            type: type, // 'individual' or 'group'
            status: 'active', // 'active' | 'on_hold' | 'finalized'
            locationIds: locationIds.length > 0 ? locationIds : ['loc_pharmacy', 'loc_cabinet', 'loc_fridge'],
            host: uName,
            participants: [uName],
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            counts: {} // key: `${locationId}___${medicineId}` -> { quantity, expiryDate, countedAt, userName, batches }
        };

        await this.saveSession(session);
        this.currentSessionId = session.id;
        UI.showToast(`تم بدء الجلسة: ${session.name} 🚀`, 'success');
        return session;
    },

    async joinSession(sessionId, userName) {
        const session = await this.getSession(sessionId);
        if (!session) return false;
        const name = userName || Users.getActive()?.name || 'صيدلي';
        if (!session.participants) session.participants = [];
        if (!session.participants.includes(name)) {
            session.participants.push(name);
            await this.saveSession(session);
            UI.showToast(`انضم ${name} إلى فريق الجرد 👥`, 'success');
        }
        return true;
    },

    async holdSession(id) {
        const session = await this.getSession(id);
        if (!session) return;
        session.status = 'on_hold';
        await this.saveSession(session);
        UI.showToast('تم تعليق الجلسة مؤقتاً ⏸️', 'info');
    },

    async resumeSession(id) {
        const session = await this.getSession(id);
        if (!session) return;
        session.status = 'active';
        await this.saveSession(session);
        this.currentSessionId = id;
        UI.showToast('تم استئناف الجلسة ▶️', 'success');
    },

    async finalizeSession(id) {
        const session = await this.getSession(id);
        if (!session) return false;
        if (session.status === 'finalized') {
            UI.showToast('هذه الجلسة تم اعتمادها مسبقاً ✅', 'info');
            return true;
        }

        if (!confirm(`هل أنت متأكد من إنهاء واعتماد "${session.name}"؟ سيتم تحديث رصيد المستودع الفعلي واستبدال الأرصدة القديمة بالكميات المحصورة الدقيقة.`)) {
            return false;
        }

        try {
            // Apply counts to inventory with True Reconciliation (no double-counting!)
            const counts = session.counts || {};
            const entries = Object.entries(counts);
            
            // 1. Fetch current inventory & locations map to avoid N+1 queries
            const allExistingInv = (await DB.getAll('inventory')) || [];
            const allLocations = (await Locations.getAll()) || [];
            const locMap = new Map(allLocations.map(l => [l.id, l]));
            const locNameToId = new Map(allLocations.map(l => [l.nameAR, l.id]));
            const sessionCountedKeys = new Set(Object.keys(counts)); // `${locId}___${medId}`

            // 2. Remove obsolete previous records for the counted pairs
            for (const item of allExistingInv) {
                const itemLocId = item.locationId || (item.location ? locNameToId.get(item.location) : null);
                const pairKey = `${itemLocId}___${item.medicineId}`;
                if (sessionCountedKeys.has(pairKey)) {
                    await DB.delete('inventory', item.id);
                }
            }

            // 3. Insert newly counted verified batches (omit zero quantities to keep inventory clean)
            for (const [key, record] of entries) {
                const [locId, medId] = key.split('___');
                const loc = locMap.get(locId);
                const locName = loc ? loc.nameAR : 'المستودع الرئيسي';

                const batches = (record.batches && record.batches.length > 0) 
                    ? record.batches 
                    : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

                for (let bIndex = 0; bIndex < batches.length; bIndex++) {
                    const b = batches[bIndex];
                    const bQty = parseFloat(b.quantity) || 0;
                    if (bQty <= 0) continue; // Clean inventory: 0 quantity means out-of-stock

                    await DB.put('inventory', {
                        id: `inv_audit_${session.id}_${medId}_${locId}_${bIndex}`,
                        medicineId: medId,
                        location: locName,
                        locationId: locId,
                        quantity: bQty,
                        expiryDate: b.expiryDate || null,
                        batchIndex: bIndex,
                        auditId: session.id,
                        userName: record.userName || session.host,
                        timestamp: record.countedAt || new Date().toISOString()
                    });
                }
            }

            // 4. Mark session finalized after successful reconciliation
            session.status = 'finalized';
            session.finalizedAt = new Date().toISOString();
            await this.saveSession(session);

            if (typeof Sync?.broadcastAuditStatus === 'function') {
                Sync.broadcastAuditStatus(session);
            }

            UI.showToast('تم اعتماد وإنهاء الجلسة وتحديث المستودع بنجاح! 🎊', 'success');
            return true;
        } catch (err) {
            console.error('Finalize session failed:', err);
            UI.showToast('حدث خطأ أثناء اعتماد الجلسة: ' + err.message, 'danger');
            return false;
        }
    },

    async deleteSession(id) {
        if (!id) return false;
        await DB.delete('audit_sessions', id);
        if (this.currentSessionId === id) this.currentSessionId = null;
        return true;
    },

    async archiveSession(id) {
        const session = await this.getSession(id);
        if (!session) return false;
        session.isArchived = true;
        session.archivedAt = new Date().toISOString();
        await this.saveSession(session);
        return true;
    },

    async unarchiveSession(id) {
        const session = await this.getSession(id);
        if (!session) return false;
        session.isArchived = false;
        await this.saveSession(session);
        return true;
    },

    async updateSession(id, data) {
        const session = await this.getSession(id);
        if (!session) return null;
        if (data.name) session.name = data.name;
        if (data.type) session.type = data.type;
        if (data.locationIds && Array.isArray(data.locationIds)) session.locationIds = data.locationIds;
        await this.saveSession(session);
        return session;
    },

    async recordCount(sessionId, locationId, medicineId, { batches, quantity, expiryDate }) {
        const session = await this.getSession(sessionId);
        if (!session) return false;

        const activeUser = Users.getActive();
        const uName = activeUser?.name || 'صيدلي';

        if (!session.counts) session.counts = {};
        const key = `${locationId}___${medicineId}`;

        // Ensure user is in session participants
        if (!session.participants) session.participants = [];
        if (!session.participants.includes(uName)) {
            session.participants.push(uName);
        }

        // Normalize batches
        let cleanBatches = [];
        if (Array.isArray(batches) && batches.length > 0) {
            cleanBatches = batches.map(b => ({
                quantity: parseFloat(b.quantity) || 0,
                expiryDate: b.expiryDate ? b.expiryDate.trim() : '2027-12'
            })).filter(b => b.quantity >= 0);
        } else if (quantity !== undefined && quantity !== null) {
            cleanBatches = [{
                quantity: parseFloat(quantity) || 0,
                expiryDate: expiryDate ? expiryDate.trim() : '2027-12'
            }];
        } else {
            // Default 0 count if zero-count requested
            cleanBatches = [{
                quantity: 0,
                expiryDate: expiryDate ? expiryDate.trim() : '2027-12'
            }];
        }

        const totalQty = cleanBatches.reduce((sum, b) => sum + b.quantity, 0);
        
        // Find earliest expiry date
        const sortedBatches = [...cleanBatches].sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));
        const earliestExpiry = sortedBatches[0]?.expiryDate || '2027-12';

        session.counts[key] = {
            quantity: totalQty,
            expiryDate: earliestExpiry,
            batches: cleanBatches,
            countedAt: new Date().toISOString(),
            userName: uName
        };

        await this.saveSession(session);

        // Collaborative live broadcast
        if (session.type === 'group') {
            Sync.pushAuditEntry({
                auditId: session.id,
                locationId,
                medicineId,
                quantity: totalQty,
                batches: cleanBatches,
                userName: uName
            });
        }

        return session.counts[key];
    },

    async getSessionStats(sessionId) {
        const session = await this.getSession(sessionId);
        if (!session) return { totalMedicines: 0, countedMedicines: 0, progress: 0 };

        const counts = session.counts || {};
        const locationIds = session.locationIds || [];

        let totalMedsCount = 0;
        for (const locId of locationIds) {
            const meds = await Locations.getMedicinesForLocation(locId);
            totalMedsCount += meds.length;
        }

        const countedCount = Object.keys(counts).length;
        const progress = totalMedsCount > 0 ? Math.round((countedCount / totalMedsCount) * 100) : 0;

        return {
            totalMedicines: totalMedsCount,
            countedMedicines: countedCount,
            progress: Math.min(100, progress),
            status: session.status,
            name: session.name,
            type: session.type
        };
    },

    async getLocationStats(sessionId, locationId) {
        const session = await this.getSession(sessionId);
        if (!session) return { total: 0, counted: 0, progress: 0 };

        const meds = await Locations.getMedicinesForLocation(locationId);
        const counts = session.counts || {};

        let counted = 0;
        for (const m of meds) {
            const key = `${locationId}___${m.id}`;
            if (counts[key] !== undefined) counted++;
        }

        const progress = meds.length > 0 ? Math.round((counted / meds.length) * 100) : 0;
        return {
            total: meds.length,
            counted,
            progress: Math.min(100, progress)
        };
    },

    /**
     * Resolves medicines for a specific session location and category,
     * with Smart Sorting: Uncounted on top, Counted at the bottom with ✅.
     */
    async getMedicinesWithAuditStatus(sessionId, locationId, categoryId) {
        const session = await this.getSession(sessionId);
        const counts = (session && session.counts) || {};

        const medicines = await Locations.getMedicinesForLocation(locationId, categoryId);

        const enriched = medicines.map(med => {
            const key = `${locationId}___${med.id}`;
            const countRecord = counts[key];
            const isCounted = !!countRecord;

            let displayExpiry = null;
            if (isCounted) {
                if (countRecord.batches && countRecord.batches.length > 1) {
                    displayExpiry = `${countRecord.expiryDate} (+${countRecord.batches.length - 1} دُفعات)`;
                } else {
                    displayExpiry = countRecord.expiryDate;
                }
            }

            return {
                ...med,
                isCounted,
                countedQty: isCounted ? countRecord.quantity : null,
                countedExpiry: displayExpiry,
                batches: isCounted ? countRecord.batches : null,
                countedAt: isCounted ? countRecord.countedAt : null,
                countedBy: isCounted ? countRecord.userName : null
            };
        });

        // Smart Sort: Uncounted first (false before true), then alphabetical
        return enriched.sort((a, b) => {
            if (a.isCounted !== b.isCounted) {
                return a.isCounted ? 1 : -1; // Uncounted (false) comes first
            }
            return (a.nameEN || '').localeCompare(b.nameEN || '');
        });
    }
};
