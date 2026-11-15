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
        const imgUrl = window.Categories ? window.Categories.getMedicineImage(m) : 'assets/icons/default-med.png';
        const medId = item.medicineId || item.id || m.id;
        
        let catName = m.categoryId || 'عام';
        let catIcon = 'bx-purchase-tag-alt';
        if (window.Categories && window.Categories.cache) {
            const cat = window.Categories.cache.find(c => c.id === m.categoryId);
            if (cat) {
                catName = cat.nameAR;
                catIcon = cat.icon || 'bx-category';
            }
        }
        
        return `
            <div class="inventory-card master-catalog-card" data-med-id="${medId}" style="display:flex; align-items:center; gap:12px; padding:12px 16px; margin-bottom:12px; border-radius:16px; background:var(--surface); border:1px solid var(--border-color); box-shadow:var(--shadow-sm); transition:all 0.2s ease;">
                <div class="card-img" style="width:48px; height:48px; border-radius:10px; overflow:hidden; flex-shrink:0; background:rgba(59,130,246,0.08); display:flex; align-items:center; justify-content:center;">
                    <img src="${imgUrl}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div class="card-info" style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h3 style="font-size:14px; font-weight:800; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-main);">${m.nameEN || m.nameAR}</h3>
                        ${m.nameAR && m.nameAR !== m.nameEN ? `<span style="font-size:12px; color:var(--text-muted); font-weight:normal;">(${m.nameAR})</span>` : ''}
                    </div>
                    <div class="card-meta" style="display:flex; align-items:center; gap:10px; font-size:11px; margin-top:4px;">
                        <span class="badge-cat" style="background:rgba(59,130,246,0.1); color:var(--primary); padding:2px 8px; border-radius:6px; font-weight:bold; display:inline-flex; align-items:center; gap:4px;">
                            <i class='bx ${catIcon}'></i> ${catName}
                        </span>
                        ${m.activeIngredient ? `<span style="color:var(--text-muted);"><i class='bx bx-dna'></i> ${m.activeIngredient}</span>` : ''}
                    </div>
                </div>
                <div class="card-actions" style="display:flex; align-items:center; gap:6px;">
                    <button class="btn-ghost sm-btn" onclick="window.App.openMoveCategoryModal('${medId}')" title="نقل إلى تصنيف آخر" style="font-size:11px; padding:6px 10px; border-radius:8px; border:1px solid var(--border-color); display:flex; align-items:center; gap:4px;">
                        <i class='bx bx-transfer'></i> <span>نقل</span>
                    </button>
                    <button class="icon-btn" onclick="window.App.openMasterMedicineMenu('${medId}')" title="خيارات إضافية" style="flex-shrink:0; opacity:0.8; padding:6px;">
                        <i class='bx bx-dots-vertical-rounded' style="font-size:18px;"></i>
                    </button>
                </div>
            </div>
        `;
    }
};
