// js/features/inventory.js
import { DB } from '../core/db.js';
import { Utils } from '../core/utils.js';

/**
 * Inventory Management Feature
 * Handles entries, stock aggregation, and deletions.
 */

export const Inventory = {
    async addEntry(data) {
        if (!data.medicineId || !data.quantity) return false;
        
        const entry = {
            id: Utils.generateId(),
            medicineId: data.medicineId,
            location: data.location || 'غير محدد',
            quantity: parseFloat(data.quantity) || 0,
            expiryDate: data.expiryDate || null,
            type: data.type || 'medicine',
            timestamp: new Date().toISOString()
        };

        await DB.add('inventory', entry);
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
    }
};
