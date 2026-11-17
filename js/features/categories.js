// js/features/categories.js
import { DB } from '../core/db.js';
import { CATEGORY_MAP, SEED_MEDICINES } from '../core/seed_data.js';
import { Utils } from '../core/utils.js';
import { auth } from '../core/firebase-config.js';

/**
 * Categories & Master Data Feature (v18.7.4 - Clean Logic & Uncategorized Support)
 * Robust categorization, legacy migration, and uncategorized medicine management.
 */

export const Categories = {
    // --- Legacy / Alias Mapping Dictionary ---
    LEGACY_CATEGORY_MAP: {
        // NSAID -> Analgesics
        'nsaid': 'Analgesics',
        'مسكنات وآلام': 'Analgesics',
        'مسكنات': 'Analgesics',
        'مسكنات وحرارة': 'Analgesics',

        // Anti-Flu, Laryng., Antihistamines, Flu -> Respiratory
        'anti-flu': 'Respiratory',
        'antiflu': 'Respiratory',
        'laryng.': 'Respiratory',
        'laryng': 'Respiratory',
        'antihistamines': 'Respiratory',
        'flu': 'Respiratory',
        'أدوية البرد': 'Respiratory',
        'أذن وحنجرة': 'Respiratory',
        'جهاز تنفسي': 'Respiratory',
        'برد وصدر وحساسية': 'Respiratory',

        // GIT Prep -> Gastro
        'git prep': 'Gastro',
        'gitprep': 'Gastro',
        'git': 'Gastro',
        'أدوية المعدة': 'Gastro',
        'معدة وجهاز هضمي': 'Gastro',

        // Topical, Local Prep, Dermatology, Eye-Ear-Nose, Eye-Ear -> Topical
        'local prep': 'Topical',
        'localprep': 'Topical',
        'dermatology': 'Topical',
        'eye-ear-nose': 'Topical',
        'eye-ear': 'Topical',
        'كريمات ودهانات': 'Topical',
        'قطرات عيون وأذن': 'Topical',
        'مراهم وقطرات': 'Topical',

        // Serum, Emergency -> Injections
        'serum': 'Injections',
        'emergency': 'Injections',
        'حقن': 'Injections',
        'حقن ومحاليل وأمصال': 'Injections',

        // Antibiotics aliases
        'antibiotic': 'Antibiotics',
        'antimicrobial': 'Antibiotics',
        'antimicrobials': 'Antibiotics',
        'مضادات حيوية': 'Antibiotics',
        'مضادات حيوية وميكروبية': 'Antibiotics',

        // Consumables aliases
        'consumable': 'Consumables',
        'supplies': 'Consumables',
        'مستلزمات طبية': 'Consumables',
        'مستلزمات وغيار طبي': 'Consumables',

        // Chronic aliases
        'أمراض مزمنة': 'Chronic',
        'chronic': 'Chronic'
    },

    // --- Category Management & Seeding ---

    async seedInitialData() {
        try {
            console.log('Dawaa Categories: Checking for initial data...');
            
            // Ensure canonical categories are present in categories store
            for (const key in CATEGORY_MAP) {
                const cat = CATEGORY_MAP[key];
                const existing = await DB.get('categories', key);
                if (!existing) {
                    await DB.put('categories', {
                        id: key,
                        nameAR: cat.ar,
                        nameEN: cat.en || key,
                        icon: cat.icon,
                        color: cat.color,
                        prefix: cat.prefix || 'Z',
                        isSystem: true
                    });
                } else if (!existing.nameEN) {
                    existing.nameEN = cat.en || key;
                    await DB.put('categories', existing);
                }
            }

            // Seed Medicines only if DB is empty AND no authenticated user
            // (logged-in users get real data from Sync.pull — no need for dummy seed)
            const existingMeds = await DB.getAll('medicineMaster');
            const hasAuthUser = (typeof auth !== 'undefined' && auth?.currentUser) || 
                                (typeof firebase !== 'undefined' && firebase?.auth?.()?.currentUser);
            if (existingMeds.length === 0 && !hasAuthUser) {
                console.log('Dawaa Categories: Seeding default medicines (first-time, no auth)...');
                for (const med of SEED_MEDICINES) {
                    await DB.add('medicineMaster', {
                        id: med.id, 
                        nameEN: med.nameEN,
                        nameAR: med.nameAR || med.nameEN,
                        activeIngredient: med.activeIngredient || '',
                        categoryId: med.categoryId || 'uncategorized',
                        type: med.type || 'medicine',
                        imagePath: med.imagePath,
                        lastUpdated: new Date().toISOString()
                    });
                }
            }

            // Always run cleanup and legacy migration
            await this.cleanupAndMigrate();

            // Pre-populate category cache
            await this.getAllSorted();
        } catch (err) {
            console.error('Dawaa Categories: Seed Error:', err);
        }
    },

    /**
     * Cleanup and Legacy Migration (v18.7.4)
     * Harmonizes category IDs, migrates medicines from old schemes, and supports 'uncategorized'.
     */
    async cleanupAndMigrate() {
        try {
            console.log('Dawaa Categories: Starting cleanup and legacy migration...');
            
            // 1. Ensure canonical categories + 'uncategorized' exist
            for (const key in CATEGORY_MAP) {
                const cat = CATEGORY_MAP[key];
                const existing = await DB.get('categories', key);
                if (!existing) {
                    await DB.put('categories', {
                        id: key,
                        nameAR: cat.ar,
                        nameEN: cat.en || key,
                        icon: cat.icon,
                        color: cat.color,
                        prefix: cat.prefix || 'Z',
                        isSystem: true
                    });
                }
            }

            // Always ensure 'uncategorized' exists
            const uncatExisting = await DB.get('categories', 'uncategorized');
            if (!uncatExisting) {
                await DB.put('categories', {
                    id: 'uncategorized',
                    nameAR: 'أدوية غير مصنفة',
                    nameEN: 'Uncategorized',
                    icon: 'bx-help-circle',
                    color: '#94a3b8',
                    prefix: 'U',
                    isSystem: true
                });
            }

            // 2. Fetch all registered categories and medicines
            const allCats = (await DB.getAll('categories')) || [];
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            const registeredCatIds = new Set(allCats.map(c => c.id));
            registeredCatIds.add('uncategorized');

            let migratedCount = 0;

            // 3. Migrate medicines with legacy, alias, or orphan categoryId
            for (const med of allMeds) {
                let currentCat = (med.categoryId || '').trim();
                let targetCat = null;

                if (!currentCat || currentCat === 'undefined' || currentCat === 'null') {
                    targetCat = 'uncategorized';
                } else {
                    const lowerCat = currentCat.toLowerCase();
                    if (this.LEGACY_CATEGORY_MAP[lowerCat]) {
                        targetCat = this.LEGACY_CATEGORY_MAP[lowerCat];
                    } else if (!registeredCatIds.has(currentCat)) {
                        // Check if currentCat matches any category's nameAR
                        const matchByName = allCats.find(c => c.nameAR && c.nameAR.trim() === currentCat);
                        if (matchByName) {
                            targetCat = matchByName.id;
                        } else {
                            // Truly unknown or orphan category ID -> assign to Uncategorized!
                            targetCat = 'uncategorized';
                        }
                    }
                }

                if (targetCat && targetCat !== currentCat) {
                    console.log(`Dawaa Migration: Migrating med [${med.id}] "${med.nameEN || med.nameAR}" from '${currentCat}' -> '${targetCat}'`);
                    med.categoryId = targetCat;
                    med.lastUpdated = new Date().toISOString();
                    await DB.put('medicineMaster', med);
                    migratedCount++;

                    // Push update to cloud if Sync is ready
                    if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                        window.Sync.push(med.id).catch(() => {});
                    }
                }
            }

            // 4. Clean up obsolete legacy categories and empty ghost categories from 'categories' store
            // (e.g. 'NSAID', 'Anti-Flu', 'Laryng.', 'GIT Prep', 'Local Prep', 'Eye-Ear-Nose')
            const obsoleteIds = ['nsaid', 'anti-flu', 'laryng.', 'git prep', 'local prep', 'eye-ear-nose'];
            const freshMeds = (await DB.getAll('medicineMaster')) || [];
            
            for (const cat of allCats) {
                const lowerId = (cat.id || '').toLowerCase();
                const isObsoleteId = obsoleteIds.includes(lowerId);
                // A ghost category is strictly one with corrupt/missing name, NOT user-created categories starting with 'cat_'
                const isGhostCat = !cat.nameAR || cat.nameAR === 'undefined' || cat.nameAR === 'null' || !cat.nameAR.trim();
                
                if (cat.id && cat.id !== 'uncategorized') {
                    if (isGhostCat) {
                        console.log(`Dawaa Migration: Removing corrupt/ghost category without name '${cat.id}'`);
                        await DB.delete('categories', cat.id);
                        if (typeof window.Sync !== 'undefined' && window.Sync.deleteCategory) {
                            window.Sync.deleteCategory(cat.id).catch(() => {});
                        }
                    } else if (isObsoleteId) {
                        const stillUsed = freshMeds.some(m => m.categoryId === cat.id);
                        if (!stillUsed) {
                            console.log(`Dawaa Migration: Removing obsolete empty category '${cat.id}'`);
                            await DB.delete('categories', cat.id);
                            if (typeof window.Sync !== 'undefined' && window.Sync.deleteCategory) {
                                window.Sync.deleteCategory(cat.id).catch(() => {});
                            }
                        }
                    }
                }
            }

            // Reset in-memory cache
            this.cache = null;
            this._cache = null;
            await this.getAllSorted();

            console.log(`Dawaa Categories: Cleanup and migration complete. Migrated ${migratedCount} medicines.`);
            return { migratedCount };
        } catch (err) {
            console.error('Dawaa Categories: Cleanup/Migration error:', err);
            return { migratedCount: 0, error: err };
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
        const cats = (await DB.getAll('categories')) || [];
        this.cache = cats;
        this._cache = cats;
        // Sort alphabetically by Arabic name, keeping 'uncategorized' consistently at the end
        return cats.sort((a, b) => {
            if (a.id === 'uncategorized') return 1;
            if (b.id === 'uncategorized') return -1;
            return (a.nameAR || '').localeCompare(b.nameAR || '');
        });
    },

    getCategoryNameAR(catId) {
        if (!catId || catId === 'uncategorized') return 'أدوية غير مصنفة';
        const cache = this.cache || this._cache;
        if (cache) {
            const found = cache.find(c => c.id === catId);
            if (found && found.nameAR) return found.nameAR;
        }
        if (CATEGORY_MAP[catId] && CATEGORY_MAP[catId].ar) {
            return CATEGORY_MAP[catId].ar;
        }
        const lower = String(catId).toLowerCase();
        if (this.LEGACY_CATEGORY_MAP && this.LEGACY_CATEGORY_MAP[lower]) {
            const canonicalKey = this.LEGACY_CATEGORY_MAP[lower];
            if (CATEGORY_MAP[canonicalKey]) return CATEGORY_MAP[canonicalKey].ar;
        }
        return catId;
    },

    getCategoryIcon(catId) {
        if (!catId || catId === 'uncategorized') return 'bx-help-circle';
        const cache = this.cache || this._cache;
        if (cache) {
            const found = cache.find(c => c.id === catId);
            if (found && found.icon) return found.icon;
        }
        if (CATEGORY_MAP[catId] && CATEGORY_MAP[catId].icon) {
            return CATEGORY_MAP[catId].icon;
        }
        const lower = String(catId).toLowerCase();
        if (this.LEGACY_CATEGORY_MAP && this.LEGACY_CATEGORY_MAP[lower]) {
            const canonicalKey = this.LEGACY_CATEGORY_MAP[lower];
            if (CATEGORY_MAP[canonicalKey]) return CATEGORY_MAP[canonicalKey].icon;
        }
        return 'bx-purchase-tag-alt';
    },

    async getInfo(id) {
        if (!id || id === 'uncategorized') {
            return { 
                id: 'uncategorized', 
                nameAR: 'أدوية غير مصنفة', 
                nameEN: 'Uncategorized', 
                icon: 'bx-help-circle', 
                color: '#94a3b8',
                isSystem: true 
            };
        }
        // Check database first so user edits take precedence over default map!
        try {
            const fromDb = await DB.get('categories', id);
            if (fromDb) {
                return {
                    id: fromDb.id,
                    nameAR: fromDb.nameAR || (CATEGORY_MAP[id] && CATEGORY_MAP[id].ar) || id,
                    nameEN: fromDb.nameEN || (CATEGORY_MAP[id] && CATEGORY_MAP[id].en) || id,
                    icon: fromDb.icon || (CATEGORY_MAP[id] && CATEGORY_MAP[id].icon) || 'bx-category',
                    color: fromDb.color || (CATEGORY_MAP[id] && CATEGORY_MAP[id].color) || '#3b82f6',
                    isSystem: fromDb.isSystem || false
                };
            }
        } catch (e) {
            console.warn('Error fetching category from DB:', e);
        }

        if (CATEGORY_MAP[id]) {
            return {
                id: id,
                nameAR: CATEGORY_MAP[id].ar,
                nameEN: CATEGORY_MAP[id].en || id,
                icon: CATEGORY_MAP[id].icon,
                color: CATEGORY_MAP[id].color,
                isSystem: true
            };
        }
        return { 
            id: id, 
            nameAR: this.getCategoryNameAR(id), 
            nameEN: id, 
            icon: this.getCategoryIcon(id), 
            color: '#64748b',
            isSystem: false 
        };
    },

    async saveCategory(cat) {
        if (!cat.id || cat.id === '') cat.id = `cat_${Date.now()}`;
        await DB.put('categories', cat);
        this.cache = null;
        this._cache = null;
        await this.getAllSorted();
        try {
            if (typeof window.Sync !== 'undefined' && window.Sync.pushCategory) {
                await window.Sync.pushCategory(cat);
            }
        } catch (e) {
            console.warn('Sync pushCategory notice:', e);
        }
        return cat.id;
    },

    async deleteCategory(id) {
        if (id === 'uncategorized') return false; // Protected system category
        await DB.delete('categories', id);

        // Migrate all medicines belonging to this deleted category to 'uncategorized'
        try {
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            for (const med of allMeds) {
                if (med.categoryId === id) {
                    med.categoryId = 'uncategorized';
                    med.lastUpdated = new Date().toISOString();
                    await DB.put('medicineMaster', med);
                    if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                        window.Sync.push(med.id).catch(() => {});
                    }
                }
            }
        } catch (me) {}

        this.cache = null;
        this._cache = null;
        await this.getAllSorted();
        try {
            if (typeof window.Sync !== 'undefined' && window.Sync.deleteCategory) {
                window.Sync.deleteCategory(id);
            }
        } catch (e) {
            console.warn('Sync deleteCategory notice:', e);
        }
        return true;
    },

    // --- Search & Retrieval ---

    async getMedicinesByCategoryId(catId) {
        const all = (await DB.getAll('medicineMaster')) || [];
        
        // Uncategorized handling: fetch all meds with null/empty/'uncategorized' OR unmapped category IDs
        if (!catId || catId === 'uncategorized') {
            const validCats = await DB.getAll('categories');
            const validIds = new Set(validCats.filter(c => c.id !== 'uncategorized').map(c => c.id));
            return all
                .filter(m => !m.categoryId || m.categoryId === 'uncategorized' || !validIds.has(m.categoryId))
                .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
        }

        try {
            if (DB.getAllByIndex) {
                const indexed = await DB.getAllByIndex('medicineMaster', 'by_category_id', catId);
                if (indexed && indexed.length > 0) {
                    return indexed.sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
                }
            }
        } catch (e) {}

        return all
            .filter(m => m.categoryId === catId)
            .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
    },

    async searchMaster(query) {
        if (!query) return [];
        const qRaw = String(query).trim().toLowerCase();
        if (!qRaw) return [];
        const qNorm = (typeof Utils !== 'undefined' && Utils.normalizeArabic) ? Utils.normalizeArabic(qRaw) : qRaw;
        const all = (await DB.getAll('medicineMaster')) || [];
        return all
            .filter(m => {
                const en = (m.nameEN || '').toLowerCase();
                const arRaw = (m.nameAR || '').toLowerCase();
                const arNorm = (typeof Utils !== 'undefined' && Utils.normalizeArabic) ? Utils.normalizeArabic(arRaw) : arRaw;
                const actRaw = (m.activeIngredient || '').toLowerCase();
                const actNorm = (typeof Utils !== 'undefined' && Utils.normalizeArabic) ? Utils.normalizeArabic(actRaw) : actRaw;
                const id = String(m.id || '').toLowerCase();

                return en.includes(qRaw) ||
                       arRaw.includes(qRaw) ||
                       arNorm.includes(qNorm) ||
                       actRaw.includes(qRaw) ||
                       actNorm.includes(qNorm) ||
                       id.includes(qRaw);
            })
            .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
    },

    // --- Medicine Master CRUD ---

    async saveMedicine(med) {
        if (!med.id) med.id = await this.generateNextId();
        if (!med.categoryId) med.categoryId = 'uncategorized';
        if (!med.lastUpdated) med.lastUpdated = new Date().toISOString();
        await DB.put('medicineMaster', med);
        // Push to cloud
        if (typeof window.Sync !== 'undefined' && window.Sync.push) {
            window.Sync.push(med.id).catch(() => {});
        }
        return med.id;
    },

    getMedicineImage(med, options = {}) {
        if (!med) return 'assets/icons/default-med.png';
        const img = med.imagePath || med.image || med.imageUrl || med.photo;
        if (!img || img === '' || img === 'null' || img === 'undefined') {
            return 'assets/icons/default-med.png';
        }
        return img;
    },

    async deleteMedicine(id) {
        try {
            const med = await DB.get('medicineMaster', id);
            if (med?.imagePath && typeof window.App?.deleteStorageImage === 'function') {
                window.App.deleteStorageImage(med.imagePath).catch(() => {});
            }
        } catch (e) {}

        await DB.delete('medicineMaster', id);
        // Also cleanup inventory for this medicine
        const inv = await DB.getAll('inventory');
        for (const item of inv) {
            if (item.medicineId === id) {
                await DB.delete('inventory', item.id);
                if (typeof window.Sync !== 'undefined' && window.Sync.deleteInventoryEntry) {
                    window.Sync.deleteInventoryEntry(item.id).catch(() => {});
                }
            }
        }
        if (typeof window.Sync !== 'undefined' && window.Sync.deleteMedicine) {
            window.Sync.deleteMedicine(id).catch(() => {});
        }
        return true;
    }
};
