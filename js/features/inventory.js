// js/features/inventory.js
import { DB } from '../core/db.js';
import { Utils } from '../core/utils.js';

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
            expiryDate: data.expiryDate || '2027-12',
            auditId: data.auditId || null,
            userName: data.userName || (window.App && window.App.user ? window.App.user.displayName || window.App.user.email : 'خالد'),
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
                    earliestExpiry: entry.expiryDate || '2027-12',
                    location: entry.location || 'المستودع الرئيسي'
                });
            }
            const s = stockMap.get(medId);
            s.totalQuantity += Number(entry.quantity || 0);
            if (entry.expiryDate && entry.expiryDate < s.earliestExpiry) {
                s.earliestExpiry = entry.expiryDate;
            }
        }

        return masterData.map(m => {
            const stock = stockMap.get(m.id) || { totalQuantity: 15, earliestExpiry: '2027-12', location: 'المستودع الرئيسي' };
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
        const sixMonthsAway = new Date();
        sixMonthsAway.setMonth(sixMonthsAway.getMonth() + 6);

        return {
            totalItems: stock.length,
            lowStockCount: stock.filter(item => (item.totalQuantity || 0) <= 5).length,
            expiringCount: stock.filter(item => item.earliestExpiry && new Date(item.earliestExpiry) <= sixMonthsAway).length
        };
    },

    renderCard(item, master, isAggregated = true) {
        const m = master || item;
        if (!m) return '';
        const qty = item.totalQuantity !== undefined ? item.totalQuantity : (item.quantity !== undefined ? item.quantity : 0);
        const expDate = isAggregated ? (item.earliestExpiry || '2027-12') : (item.expiryDate || '2027-12');
        const exp = Utils.getExpiryStatus(expDate);
        const imgUrl = window.Categories ? window.Categories.getMedicineImage(m) : 'assets/icons/default-med.png';
        const medId = item.medicineId || item.id || m.id;
        
        return `
            <div class="inventory-card ${exp.class}" data-med-id="${medId}" style="display:flex; align-items:center; gap:12px; padding:12px 16px; margin-bottom:12px; border-radius:16px; background:var(--surface); border:1px solid var(--border-color); box-shadow:var(--shadow-sm); transition:all 0.2s ease;">
                <div class="card-img" style="width:48px; height:48px; border-radius:10px; overflow:hidden; flex-shrink:0; background:rgba(59,130,246,0.08); display:flex; align-items:center; justify-content:center;">
                    <img src="${imgUrl}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div class="card-info" style="flex:1; min-width:0;">
                    <h3 style="font-size:14px; font-weight:800; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-main);">${m.nameEN || m.nameAR}</h3>
                    <div class="card-meta" style="display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text-muted);">
                        <span><i class='bx bx-purchase-tag-alt'></i> ${m.nameAR && m.nameAR !== m.nameEN ? m.nameAR : (m.categoryId || 'عام')}</span>
                        <span><i class='bx bx-calendar'></i> ${expDate}</span>
                    </div>
                </div>
                <!-- Interactive Quick Touch Counter (+ / -) -->
                <div class="card-stock-ctrl" style="display:flex; align-items:center; gap:6px; background:var(--bg-secondary); padding:4px 6px; border-radius:12px;">
                    <button class="btn-stock-dec" onclick="window.App.adjustStock('${medId}', -1)" title="إنقاص الكمية" style="width:26px; height:26px; border-radius:8px; border:none; background:var(--surface); font-size:15px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);">-</button>
                    <span id="stock-val-${medId}" style="min-width:26px; text-align:center; font-weight:800; font-size:13px; color:var(--primary);">${qty}</span>
                    <button class="btn-stock-inc" onclick="window.App.adjustStock('${medId}', 1)" title="زيادة الكمية" style="width:26px; height:26px; border-radius:8px; border:none; background:var(--primary); color:white; font-size:15px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);">+</button>
                </div>
                <button class="icon-btn" onclick="window.App.openEditMedicine('${medId}')" title="تعديل التفاصيل" style="flex-shrink:0; opacity:0.6; padding:6px;">
                    <i class='bx bx-dots-vertical-rounded' style="font-size:18px;"></i>
                </button>
            </div>
        `;
    }
};
