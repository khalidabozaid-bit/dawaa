// js/features/categories.js
import { DB } from '../core/db.js';
import { CATEGORY_MAP, SEED_MEDICINES } from '../core/seed_data.js';
import { Utils } from '../core/utils.js';

/**
 * Categories & Master Data Feature (v6.6.1 - Pure Architecture)
 * Simple categorization and medicine registry. No migration/forcing logic.
 */

export const Categories = {
    // --- Category Management ---

    async seedInitialData() {
        try {
            console.log('Dawaa Categories: Checking for initial data...');
            
            // Seed Categories if empty
            const existingCats = await DB.getAll('categories');
            if (existingCats.length === 0) {
                console.log('Dawaa Categories: Seeding default categories...');
                for (const key in CATEGORY_MAP) {
                    const cat = CATEGORY_MAP[key];
                    await DB.add('categories', {
                        id: key,
                        nameAR: cat.ar,
                        icon: cat.icon,
                        color: cat.color,
                        prefix: cat.prefix || 'Z',
                        isSystem: true
                    });
                }
            }

            // Seed Medicines if empty
            const existingMeds = await DB.getAll('medicineMaster');
            if (existingMeds.length === 0) {
                console.log('Dawaa Categories: Seeding default medicines (1001-Native)...');
                for (const med of SEED_MEDICINES) {
                    await DB.add('medicineMaster', {
                        id: med.id, 
                        nameEN: med.nameEN,
                        nameAR: med.nameAR || med.nameEN,
                        activeIngredient: med.activeIngredient || '',
                        categoryId: med.categoryId,
                        type: med.type || 'medicine',
                        imagePath: med.imagePath,
                        lastUpdated: new Date().toISOString()
                    });
                }
            }
        } catch (err) {
            console.error('Dawaa Categories: Seed Error:', err);
        }
    },

    async generateNextId() {
        const allMeds = await DB.getAll('medicineMaster');
        let maxNum = 0;
        allMeds.forEach(m => {
            const numPart = parseInt(m.id);
            if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
        });
        // Default to starting at 1001 for all new entries
        if (maxNum === 0 && allMeds.length === 0) return "1001";
        return (Math.max(1001, maxNum + 1)).toString();
    },

    async getAllSorted() {
        const cats = await DB.getAll('categories');
        return cats.sort((a, b) => (a.nameAR || '').localeCompare(b.nameAR || ''));
    },

    async getInfo(id) {
        return await DB.get('categories', id) || { nameAR: id, icon: 'bx-package', color: '#64748b' };
    },

    async saveCategory(cat) {
        if (!cat.id || cat.id === '') cat.id = Utils.generateId();
        await DB.put('categories', cat);
        return cat.id;
    },

    async deleteCategory(id) {
        await DB.delete('categories', id);
        return true;
    },

    // --- Search & Retrieval (v6.6.2 Sorted) ---

    async getMedicinesByCategoryId(catId) {
        const all = await DB.getAll('medicineMaster');
        return all
            .filter(m => m.categoryId === catId)
            .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
    },

    async searchMaster(query) {
        const all = await DB.getAll('medicineMaster');
        const q = query.toLowerCase();
        return all
            .filter(m => 
                (m.nameEN || '').toLowerCase().includes(q) || 
                (m.nameAR || '').includes(q) ||
                (m.id || '').toString().includes(q)
            )
            .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
    },

    // --- Medicine Master CRUD ---

    async saveMedicine(med) {
        if (!med.id) med.id = await this.generateNextId();
        if (!med.lastUpdated) med.lastUpdated = new Date().toISOString();
        await DB.put('medicineMaster', med);
        return med.id;
    },

    getMedicineImage(med, options = {}) {
        if (!med || !med.imagePath || med.imagePath === '') {
            return `assets/icons/default-med.png`; // Fallback
        }
        
        // v9.9.6: Unified Visualizer - Support Base64 AND Cloud URLs
        if (med.imagePath.startsWith('data:image') || med.imagePath.startsWith('http')) {
            return med.imagePath;
        }
        
        return `assets/icons/default-med.png`;
    },


    async deleteMedicine(id) {
        await DB.delete('medicineMaster', id);
        // Also cleanup inventory for this medicine
        const inv = await DB.getAll('inventory');
        for (const item of inv) {
            if (item.medicineId === id) await DB.delete('inventory', item.id);
        }
        return true;
    }
};
