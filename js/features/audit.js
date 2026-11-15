// js/features/audit.js
import { DB } from '../core/db.js';
import { Sync } from '../core/sync.js';
import { UI } from '../core/ui.js';
import { Locations } from './locations.js';
import { Categories } from './categories.js';

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
        const user = (window.App && window.App.user) || { displayName: 'خالد', email: 'khaled@dawaa.local' };
        const uName = user.displayName || user.email || 'خالد';

        if (type === 'group' && window.App?.userRole !== 'admin') {
            UI.showToast('صلاحيات المدير مطلوبة لإنشاء جرد جماعي للفريق ⚖️', 'warning');
            return null;
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
            counts: {} // key: `${locationId}___${medicineId}` -> { quantity, expiryDate, countedAt, userName }
        };

        await this.saveSession(session);
        this.currentSessionId = session.id;
        UI.showToast(`تم بدء الجلسة: ${session.name} 🚀`, 'success');
        return session;
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
        if (!session) return;

        if (!confirm(`هل أنت متأكد من إنهاء واعتماد "${session.name}"؟ سيتم تحديث رصيد المستودع الفعلي بالكميات المحصورة.`)) {
            return false;
        }

        session.status = 'finalized';
        session.finalizedAt = new Date().toISOString();
        await this.saveSession(session);

        // Apply counts to inventory
        const counts = session.counts || {};
        const entries = Object.entries(counts);
        
        for (const [key, record] of entries) {
            const [locId, medId] = key.split('___');
            const loc = await Locations.get(locId);
            const locName = loc ? loc.nameAR : 'المستودع الرئيسي';

            const batches = (record.batches && record.batches.length > 0) 
                ? record.batches 
                : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

            for (let bIndex = 0; bIndex < batches.length; bIndex++) {
                const b = batches[bIndex];
                await DB.put('inventory', {
                    id: `inv_audit_${session.id}_${medId}_${locId}_${bIndex}`,
                    medicineId: medId,
                    location: locName,
                    locationId: locId,
                    quantity: parseFloat(b.quantity) || 0,
                    expiryDate: b.expiryDate || '2027-12',
                    batchIndex: bIndex,
                    auditId: session.id,
                    userName: record.userName || session.host,
                    timestamp: record.countedAt || new Date().toISOString()
                });
            }

            if (window.App?.userRole === 'admin') {
                Sync.push(medId);
            }
        }

        UI.showToast('تم اعتماد وإنهاء الجلسة وتحديث المخزون بنجاح! 🎊', 'success');
        return true;
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

        const user = (window.App && window.App.user) || { displayName: 'خالد' };
        const uName = user.displayName || user.email || 'خالد';

        if (!session.counts) session.counts = {};
        const key = `${locationId}___${medicineId}`;

        // Normalize batches
        let cleanBatches = [];
        if (Array.isArray(batches) && batches.length > 0) {
            cleanBatches = batches.map(b => ({
                quantity: parseFloat(b.quantity) || 0,
                expiryDate: b.expiryDate ? b.expiryDate.trim() : '2027-12'
            })).filter(b => b.quantity >= 0);
        } else {
            cleanBatches = [{
                quantity: parseFloat(quantity) || 0,
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
