// js/features/inventory.js
import { DB } from '../core/db.js';
import { Utils } from '../core/utils.js';

/**
 * Inventory Management Feature
 * Handles entries, stock aggregation, and deletions.
 */

export const Inventory = {
    // v13.0.0: UI Change Observers
    subscribers: [],
    subscribe(callback) { this.subscribers.push(callback); },
    notify() { this.subscribers.forEach(cb => cb()); },

    async addEntry(data) {
        if (!data.medicineId || !data.quantity) return false;
        
        const entry = {
            id: Utils.generateId(),
            medicineId: data.medicineId,
            location: data.location || 'غير محدد',
            quantity: parseFloat(data.quantity) || 0,
            expiryDate: data.expiryDate || null,
            auditId: data.auditId || null, // v10.5.0 Audit Tagging
            type: data.type || 'medicine',
            timestamp: new Date().toISOString()
        };

        await DB.add('inventory', entry);
        
        // v14.0.0: Unified Cloud Synchronization
        if (entry.auditId) {
            import('../core/sync.js').then(({ Sync }) => Sync.pushInventoryEntry(entry));
        }

        this.notify(); // v13.0.0: Broadcast local change
        return true;
    },

    async saveDualEntry(medicineId, pData, wData) {
        let count = 0;
        const master = await DB.get('medicineMaster', medicineId);
        if (!master) return 0;

        if (pData.qty > 0) {
            await this.addEntry({
                medicineId,
                location: 'صيدلية',
                quantity: pData.qty,
                expiryDate: pData.exp,
                type: master.type
            });
            count++;
        }

        if (wData.qty > 0) {
            await this.addEntry({
                medicineId,
                location: 'مخزن',
                quantity: wData.qty,
                expiryDate: wData.exp,
                type: master.type
            });
            count++;
        }

        return count;
    },

    async deleteEntry(id) {
        await DB.delete('inventory', id);
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
                    locations: new Map(), // loc -> qty
                    earliestExpiry: null
                });
            }

            const group = aggregated.get(item.medicineId);
            group.totalQuantity += item.quantity;
            
            // Track per location
            const locQty = group.locations.get(item.location) || 0;
            group.locations.set(item.location, locQty + item.quantity);

            // Track earliest expiry
            if (item.expiryDate) {
                if (!group.earliestExpiry || new Date(item.expiryDate) < new Date(group.earliestExpiry)) {
                    group.earliestExpiry = item.expiryDate;
                }
            }
        });

        return Array.from(aggregated.values());
    },

    /**
     * Precision Filtering (v11.1.0 Engineered Indexing)
     */
    async getEntriesByAudit(auditId) {
        if (!auditId) return [];
        const db = await DB.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['inventory'], 'readonly');
            const store = tx.objectStore('inventory');
            const index = store.index('by_audit_id');
            const request = index.getAll(auditId);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getRecentAuditActivity(auditId, limit = 10) {
        let entries = await this.getEntriesByAudit(auditId);
        // Sort by timestamp descending and slice
        return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
    },

    /**
     * Standardized Card Rendering (Efficiency Protocol v9.7.1)
     */
    renderCard(item, master, isAggregated = false) {
        if (!master) return '';
        const exp = Utils.getExpiryStatus(isAggregated ? item.earliestExpiry : item.expiryDate);
        const imgUrl = window.Categories ? window.Categories.getMedicineImage(master) : 'assets/icons/default-med.png';
        
        return `
            <div class="inventory-card ${exp.class}">
                <div class="card-img mini" style="width:50px; height:50px; border-radius:8px; overflow:hidden; margin-left:12px">
                    <img src="${imgUrl}" onerror="this.src='assets/icons/default-med.png'" style="width:100%; height:100%; object-fit:cover">
                </div>
                <div class="card-info">

                    <h3>${master.nameEN} / ${master.nameAR || ''}</h3>
                    <div class="card-meta">
                        <span><i class='bx bx-map-pin'></i> ${isAggregated ? 'أماكن متعددة' : (item.location || 'غير محدد')}</span>
                        <span><i class='bx bx-purchase-tag-alt'></i> ${isAggregated ? item.totalQuantity : item.quantity}</span>
                    </div>
                </div>
                <div class="card-expiry">
                    <span class="expiry-date">${isAggregated ? (item.earliestExpiry || 'N/A') : (item.expiryDate || 'N/A')}</span>
                    <div class="card-actions">
                        ${!isAggregated ? `<button class="icon-btn delete-btn" onclick="window.App.deleteEntry('${item.id}')"><i class='bx bx-trash'></i></button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }
};

