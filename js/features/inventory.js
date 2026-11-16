// js/features/inventory.js
import { DB } from '../core/db.js';
import { Utils } from '../core/utils.js';
import { Categories } from './categories.js';
import { CATEGORY_MAP } from '../core/seed_data.js';

/**
 * Inventory Management Feature
 * Handles entries, stock aggregation, and interactive card rendering.
 */

export const Inventory = {
    subscribers: [],
    subscribe(callback) { this.subscribers.push(callback); },
    notify() { this.subscribers.forEach(cb => cb()); },

    async addEntry(data) {
        if (!data.medicineId || data.quantity === undefined) return false;
        
        const entry = {
            id: data.id || Utils.generateId(),
            medicineId: data.medicineId,
            location: data.location || 'المستودع الرئيسي',
            quantity: parseFloat(data.quantity) || 0,
            expiryDate: data.expiryDate || null,
            auditId: data.auditId || null,
            userName: data.userName || (window.App && window.App.user ? window.App.user.displayName || window.App.user.email : 'صيدلي'),
            type: data.type || 'medicine',
            timestamp: new Date().toISOString()
        };

        await DB.put('inventory', entry);
        this.notify();
        return true;
    },

    async deleteEntry(id) {
        await DB.delete('inventory', id);
        this.notify();
        return true;
    },

    async getAggregatedStock() {
        const entries = await DB.getAll('inventory');
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));
        
        const aggregated = new Map();

        entries.forEach(item => {
            if (!aggregated.has(item.medicineId)) {
                const master = masterMap.get(item.medicineId);
                aggregated.set(item.medicineId, {
                    medicineId: item.medicineId,
                    nameEN: master ? master.nameEN : 'Unknown',
                    nameAR: master ? master.nameAR : 'غير معروف',
                    type: master ? master.type : 'medicine',
                    totalQuantity: 0,
                    earliestExpiry: null
                });
            }

            const group = aggregated.get(item.medicineId);
            group.totalQuantity += Number(item.quantity || 0);

            if (item.expiryDate) {
                if (!group.earliestExpiry || new Date(item.expiryDate) < new Date(group.earliestExpiry)) {
                    group.earliestExpiry = item.expiryDate;
                }
            }
        });

        return Array.from(aggregated.values());
    },

    async getCurrentStockProducts() {
        const masterData = (await DB.getAll('medicineMaster')) || [];
        const inventoryEntries = (await DB.getAll('inventory')) || [];
        
        const stockMap = new Map();
        for (const entry of inventoryEntries) {
            const medId = entry.medicineId;
            if (!stockMap.has(medId)) {
                stockMap.set(medId, {
                    totalQuantity: 0,
                    earliestExpiry: entry.expiryDate || null,
                    location: entry.location || 'المستودع الرئيسي'
                });
            }
            const s = stockMap.get(medId);
            s.totalQuantity += Number(entry.quantity || 0);
            if (entry.expiryDate) {
                if (!s.earliestExpiry || new Date(entry.expiryDate) < new Date(s.earliestExpiry)) {
                    s.earliestExpiry = entry.expiryDate;
                }
            }
        }

        return masterData.map(m => {
            const stock = stockMap.get(m.id) || { totalQuantity: 0, earliestExpiry: null, location: 'غير محدد' };
            return {
                id: m.id,
                medicineId: m.id,
                nameEN: m.nameEN,
                nameAR: m.nameAR || m.nameEN,
                categoryId: m.categoryId,
                type: m.type || 'medicine',
                totalQuantity: stock.totalQuantity,
                earliestExpiry: stock.earliestExpiry,
                location: stock.location,
                imagePath: m.imagePath
            };
        });
    },

    async getCurrentStockStats() {
        const stock = await this.getCurrentStockProducts();
        const now = new Date();
        const sixMonthsAway = new Date();
        sixMonthsAway.setMonth(sixMonthsAway.getMonth() + 6);

        return {
            totalItems: stock.length,
            lowStockCount: stock.filter(item => (item.totalQuantity || 0) <= 5).length,
            expiringCount: stock.filter(item => {
                if (!item.earliestExpiry) return false;
                const d = new Date(item.earliestExpiry);
                return !isNaN(d.getTime()) && d <= sixMonthsAway && d >= now;
            }).length,
            expiredCount: stock.filter(item => {
                if (!item.earliestExpiry) return false;
                const d = new Date(item.earliestExpiry);
                return !isNaN(d.getTime()) && d < now;
            }).length
        };
    },

    async getEntriesByAudit(auditId) {
        if (!auditId) return [];
        try {
            if (DB.getAllByIndex) {
                const indexed = await DB.getAllByIndex('inventory', 'by_audit_id', auditId);
                if (indexed && indexed.length > 0) return indexed;
            }
        } catch (e) {}
        const entries = (await DB.getAll('inventory')) || [];
        return entries.filter(e => e.auditId === auditId);
    },

    async getRecentAuditActivity(sessionId) {
        const entries = await this.getEntriesByAudit(sessionId);
        return entries.slice(-10).reverse();
    },

    renderCard(item, master, isAggregated = true) {
        const m = master || item;
        if (!m) return '';
        const imgUrl = Categories ? Categories.getMedicineImage(m) : (m.imagePath || 'assets/icons/default-med.png');
        const medId = item.medicineId || item.id || m.id;

        // Language preference: 'en' | 'ar' | 'both'
        const langPref = localStorage.getItem('dawaa_med_lang_pref') || 'en';
        let primaryName = m.nameEN || m.nameAR || 'دواء';
        let secondaryName = (m.nameAR && m.nameAR !== m.nameEN) ? m.nameAR : '';

        if (langPref === 'ar') {
            primaryName = m.nameAR || m.nameEN || 'دواء';
            secondaryName = (m.nameEN && m.nameEN !== m.nameAR) ? m.nameEN : '';
        }

        const safePrimary = (typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(primaryName) : primaryName;
        const safeSecondary = (typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(secondaryName) : secondaryName;
        const safeActive = (m.activeIngredient && typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(m.activeIngredient) : (m.activeIngredient || '');

        return `
            <div class="inventory-card master-catalog-card" data-med-id="${medId}" style="display:flex; align-items:center; gap:12px; padding:12px 16px; margin-bottom:10px; border-radius:16px; background:var(--surface); border:1px solid var(--border-color); box-shadow:var(--shadow-sm); transition:all 0.2s ease;">
                <div class="card-img" onclick="window.App.openEntryForm('${medId}')" style="cursor:pointer; width:48px; height:48px; border-radius:12px; overflow:hidden; flex-shrink:0; background:rgba(59,130,246,0.08); display:flex; align-items:center; justify-content:center;">
                    <img src="${imgUrl}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div class="card-info" onclick="window.App.openEntryForm('${medId}')" style="flex:1; min-width:0; cursor:pointer;">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <h3 style="font-size:15px; font-weight:800; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-main);">${safePrimary}</h3>
                        ${safeSecondary ? `<span style="font-size:12px; color:var(--text-muted); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeSecondary}</span>` : ''}
                    </div>
                    ${safeActive ? `
                        <div class="card-meta" style="margin-top:4px;">
                            <span style="font-size:11px; color:var(--primary); font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                                <i class='bx bx-dna'></i> ${safeActive}
                            </span>
                        </div>
                    ` : ''}
                </div>
                <div class="card-actions" style="display:flex; align-items:center; flex-shrink:0;">
                    <button class="icon-btn" onclick="event.stopPropagation(); window.App.openMasterMedicineMenu('${medId}')" title="خيارات الدواء" style="padding:8px; font-size:20px; color:var(--text-muted); border-radius:8px;">
                        <i class='bx bx-dots-vertical-rounded'></i>
                    </button>
                </div>
            </div>
        `;
    }
};
