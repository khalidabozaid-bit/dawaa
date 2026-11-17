// js/features/categories.js
import { DB } from '../core/db.js';
import { CATEGORY_MAP, SEED_MEDICINES } from '../core/seed_data.js';
import { Utils } from '../core/utils.js?v=18.17.3';
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

            // v18.13.1: Never pre-seed 44 dummy medicines on boot before Firebase Auth resolves.
            // Real pharmacy medicines (e.g. 178+) are pulled directly from Firestore via Sync.pull() on login.
            // (Eliminates stale 44-medicine flash & ghost seed records in IndexedDB on fresh/incognito browsers.)

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

    getCategoryDisplayName(catOrId, mode = 'both', catMap = null) {
        const isRawAutoId = (val) => !val || /^cat_\d+$/i.test(String(val).trim()) || /^\d+$/.test(String(val).trim());
        let cat = null;
        let catId = '';

        if (catOrId && typeof catOrId === 'object') {
            cat = catOrId;
            catId = cat.id || '';
        } else {
            catId = catOrId || 'uncategorized';
            if (catMap && typeof catMap.get === 'function') {
                cat = catMap.get(catId) || null;
            }
            if (!cat) {
                const cache = this.cache || this._cache;
                if (cache) cat = cache.find(c => c.id === catId) || null;
            }
        }

        if (!catId || catId === 'uncategorized') {
            if (mode === 'en') return 'Uncategorized';
            if (mode === 'ar') return 'أدوية غير مصنفة';
            return 'أدوية غير مصنفة (Uncategorized)';
        }

        const mapped = CATEGORY_MAP[catId] || null;
        const nameAR = (cat?.nameAR && !isRawAutoId(cat.nameAR) ? cat.nameAR.trim() : '')
            || mapped?.ar
            || (!isRawAutoId(catId) ? catId : 'بدون تصنيف');
        const nameEN = (cat?.nameEN && !isRawAutoId(cat.nameEN) ? cat.nameEN.trim() : '')
            || mapped?.en
            || (!isRawAutoId(catId) ? catId : '');

        if (mode === 'en') return nameEN || nameAR;
        if (mode === 'ar') return nameAR || nameEN;
        if (nameAR && nameEN && nameAR.toLowerCase() !== nameEN.toLowerCase()) {
            return `${nameAR} (${nameEN})`;
        }
        return nameAR || nameEN;
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
                const isRawAutoId = /^cat_\d+$/i.test(String(id || '')) || /^\d+$/.test(String(id || ''));
                const cleanDbEn = (fromDb.nameEN && !/^cat_\d+$/i.test(String(fromDb.nameEN).trim()) && !/^\d+$/.test(String(fromDb.nameEN).trim()))
                    ? fromDb.nameEN.trim()
                    : '';
                return {
                    id: fromDb.id,
                    nameAR: fromDb.nameAR || (CATEGORY_MAP[id] && CATEGORY_MAP[id].ar) || id,
                    nameEN: cleanDbEn || (CATEGORY_MAP[id] && CATEGORY_MAP[id].en) || (isRawAutoId ? '' : id),
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
        // Save deleted category snapshot to Recycle Bin (Trash)
        try {
            const existingCat = await DB.get('categories', id);
            if (existingCat) {
                const deletedBy = (typeof window.Users !== 'undefined' && window.Users.getActive?.()) ? window.Users.getActive().name : 'صيدلي';
                const trashItem = {
                    id: `trash_cat_${id}_${Date.now()}`,
                    itemType: 'category',
                    originalId: id,
                    data: existingCat,
                    deletedAt: new Date().toISOString(),
                    deletedBy,
                    syncStatus: 'local'
                };
                await DB.put('trash', trashItem);
                if (typeof window.Sync !== 'undefined' && window.Sync.pushTrashItem) {
                    window.Sync.pushTrashItem(trashItem).catch(() => {});
                }
            }
        } catch (te) { console.warn('Trash backup category notice:', te); }

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
        const qRaw = String(query).trim();
        if (!qRaw) return [];
        const all = (await DB.getAll('medicineMaster')) || [];
        return Utils.smartFilter(
            all,
            qRaw,
            (pq, m) => Utils.smartScoreMed(pq, m, [m.categoryId]),
            { tieBreaker: (a, b) => (a.nameEN || '').localeCompare(b.nameEN || '') }
        );
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
        // v18.15.0: Soft-delete to Recycle Bin (Trash) + clean orphan counts from open audit sessions!
        let med = null;
        try { med = await DB.get('medicineMaster', id); } catch (e) {}

        // Backup inventory entries for this medicine
        const inv = (await DB.getAll('inventory')) || [];
        const invBackup = inv.filter(item => item.medicineId === id);

        // Backup & clean counts for this medicine inside open (non-finalized) audit sessions
        const auditCountsBackup = [];
        try {
            const sessions = (await DB.getAll('audit_sessions')) || [];
            for (const session of sessions) {
                if (!session || !session.counts) continue;
                const keysToRemove = Object.keys(session.counts).filter(k => {
                    const parts = k.split('___');
                    return parts[1] === String(id);
                });
                if (keysToRemove.length > 0 && session.status !== 'finalized') {
                    for (const k of keysToRemove) {
                        auditCountsBackup.push({ sessionId: session.id, key: k, record: session.counts[k] });
                        delete session.counts[k];
                    }
                    session.updatedAt = new Date().toISOString();
                    await DB.put('audit_sessions', session);
                    if (typeof window.Sync !== 'undefined' && window.Sync.deleteAuditCountKeys) {
                        window.Sync.deleteAuditCountKeys(session.id, keysToRemove).catch(() => {});
                    }
                }
            }
        } catch (ae) { console.warn('Audit orphan cleanup on delete notice:', ae); }

        // Save snapshot into Recycle Bin (Trash) — keep storage image intact until permanent delete!
        if (med) {
            try {
                const deletedBy = (typeof window.Users !== 'undefined' && window.Users.getActive?.()) ? window.Users.getActive().name : 'صيدلي';
                const trashItem = {
                    id: `trash_med_${id}_${Date.now()}`,
                    itemType: 'medicine',
                    originalId: id,
                    data: med,
                    inventoryBackup: invBackup,
                    auditCountsBackup,
                    deletedAt: new Date().toISOString(),
                    deletedBy,
                    syncStatus: 'local'
                };
                await DB.put('trash', trashItem);
                if (typeof window.Sync !== 'undefined' && window.Sync.pushTrashItem) {
                    window.Sync.pushTrashItem(trashItem).catch(() => {});
                }
            } catch (te) { console.warn('Trash backup medicine notice:', te); }
        }

        await DB.delete('medicineMaster', id);
        for (const item of invBackup) {
            await DB.delete('inventory', item.id);
            if (typeof window.Sync !== 'undefined' && window.Sync.deleteInventoryEntry) {
                window.Sync.deleteInventoryEntry(item.id).catch(() => {});
            }
        }
        if (typeof window.Sync !== 'undefined' && window.Sync.deleteMedicine) {
            window.Sync.deleteMedicine(id).catch(() => {});
        }
        return true;
    },

    // --- Recycle Bin (Trash) Operations ---
    async getTrashItems() {
        const items = (await DB.getAll('trash')) || [];
        return items.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
    },

    async restoreFromTrash(trashId) {
        const trashItem = await DB.get('trash', trashId);
        if (!trashItem || !trashItem.data) return false;

        if (trashItem.itemType === 'category') {
            const cat = { ...trashItem.data, updatedAt: new Date().toISOString() };
            await this.saveCategory(cat);
        } else {
            // Restore medicine with its exact original id
            const med = { ...trashItem.data, lastUpdated: new Date().toISOString(), v: (trashItem.data.v || 1) + 1 };
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(() => {});
            }
            // Restore backed-up inventory entries
            if (Array.isArray(trashItem.inventoryBackup)) {
                for (const invItem of trashItem.inventoryBackup) {
                    await DB.put('inventory', invItem);
                    if (typeof window.Sync !== 'undefined' && window.Sync.pushInventoryEntry) {
                        window.Sync.pushInventoryEntry(invItem).catch(() => {});
                    }
                }
            }
            // Restore backed-up counts into still-open audit sessions
            if (Array.isArray(trashItem.auditCountsBackup)) {
                const bySession = new Map();
                for (const entry of trashItem.auditCountsBackup) {
                    if (!bySession.has(entry.sessionId)) bySession.set(entry.sessionId, []);
                    bySession.get(entry.sessionId).push(entry);
                }
                for (const [sid, entries] of bySession) {
                    const session = await DB.get('audit_sessions', sid);
                    if (session && session.status !== 'finalized') {
                        if (!session.counts) session.counts = {};
                        for (const e of entries) session.counts[e.key] = e.record;
                        session.updatedAt = new Date().toISOString();
                        await DB.put('audit_sessions', session);
                        if (typeof window.Sync !== 'undefined' && window.Sync.pushAuditSession) {
                            window.Sync.pushAuditSession(session).catch(() => {});
                        }
                    }
                }
            }
        }

        await DB.delete('trash', trashId);
        if (typeof window.Sync !== 'undefined' && window.Sync.deleteTrashItem) {
            window.Sync.deleteTrashItem(trashId).catch(() => {});
        }
        return true;
    },

    async permanentDeleteFromTrash(trashId) {
        const trashItem = await DB.get('trash', trashId);
        if (trashItem?.itemType === 'medicine' && trashItem.data?.imagePath && typeof window.App?.deleteStorageImage === 'function') {
            window.App.deleteStorageImage(trashItem.data.imagePath).catch(() => {});
        }
        await DB.delete('trash', trashId);
        if (typeof window.Sync !== 'undefined' && window.Sync.deleteTrashItem) {
            window.Sync.deleteTrashItem(trashId).catch(() => {});
        }
        return true;
    },

    async emptyTrash() {
        const items = await this.getTrashItems();
        for (const item of items) {
            await this.permanentDeleteFromTrash(item.id);
        }
        return items.length;
    }
};
