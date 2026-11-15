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
            
            // Ensure default categories are present
            for (const key in CATEGORY_MAP) {
                const cat = CATEGORY_MAP[key];
                const existing = await DB.get('categories', key);
                if (!existing) {
                    await DB.put('categories', {
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

            // Pre-populate category cache
            await this.getAllSorted();
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
        this.cache = cats;
        this._cache = cats;
        return cats.sort((a, b) => (a.nameAR || '').localeCompare(b.nameAR || ''));
    },

    getCategoryNameAR(catId) {
        if (!catId) return 'عام';
        if (CATEGORY_MAP[catId] && CATEGORY_MAP[catId].ar) {
            return CATEGORY_MAP[catId].ar;
        }
        const cache = this.cache || this._cache;
        if (cache) {
            const found = cache.find(c => c.id === catId);
            if (found && found.nameAR) return found.nameAR;
        }
        // Common translations mapping - 8 Simplified Core Categories
        const aliases = {
            'Antibiotics': 'مضادات حيوية',
            'Analgesics': 'مسكنات وحرارة',
            'NSAID': 'مسكنات وحرارة',
            'Respiratory': 'برد وصدر وحساسية',
            'Anti-Flu': 'برد وصدر وحساسية',
            'Laryng.': 'برد وصدر وحساسية',
            'Antihistamines': 'برد وصدر وحساسية',
            'Gastro': 'معدة وجهاز هضمي',
            'GIT Prep': 'معدة وجهاز هضمي',
            'Chronic': 'أمراض مزمنة',
            'Injections': 'حقن ومحاليل وأمصال',
            'Serum': 'حقن ومحاليل وأمصال',
            'Emergency': 'حقن ومحاليل وأمصال',
            'Topical': 'مراهم وقطرات',
            'Local Prep': 'مراهم وقطرات',
            'Dermatology': 'مراهم وقطرات',
            'Eye-Ear-Nose': 'مراهم وقطرات',
            'Eye-Ear': 'مراهم وقطرات',
            'Consumables': 'مستلزمات وغيار طبي'
        };
        return aliases[catId] || catId;
    },

    getCategoryIcon(catId) {
        if (!catId) return 'bx-category';
        if (CATEGORY_MAP[catId] && CATEGORY_MAP[catId].icon) {
            return CATEGORY_MAP[catId].icon;
        }
        const cache = this.cache || this._cache;
        if (cache) {
            const found = cache.find(c => c.id === catId);
            if (found && found.icon) return found.icon;
        }
        return 'bx-purchase-tag-alt';
    },

    async getInfo(id) {
        if (CATEGORY_MAP[id]) {
            return {
                id: id,
                nameAR: CATEGORY_MAP[id].ar,
                icon: CATEGORY_MAP[id].icon,
                color: CATEGORY_MAP[id].color
            };
        }
        const fromDb = await DB.get('categories', id);
        if (fromDb) return fromDb;
        return { nameAR: this.getCategoryNameAR(id), icon: this.getCategoryIcon(id), color: '#64748b' };
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
        if (!med) return 'assets/icons/default-med.png';
        const img = med.imagePath || med.image || med.imageUrl || med.photo;
        if (!img || img === '' || img === 'null' || img === 'undefined') {
            return 'assets/icons/default-med.png'; // Fallback to default icon
        }
        
        // Return whatever image is stored (Base64 data:image, Cloud URL, Local asset path, Blob)
        return img;
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
