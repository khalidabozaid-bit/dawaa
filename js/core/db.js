// js/core/db.js
/**
 * Dawaa DB Engine (IndexedDB)
 * Optimized for rapid medical inventory and bilingual lookup.
 * v4: Added Categorization Store.
 */

const DB_NAME = 'DawaaMedicalDB';
const DB_VERSION = 6; // v11.0.0: High-Performance Audit Indexing

const STORES = {
    MASTER: 'medicineMaster', 
    INVENTORY: 'inventory',   
    CATEGORIES: 'categories',
    SETTINGS: 'settings',
    AUDITS: 'audits' // v10.5.0: Formal Inventory Sessions      
};

export const DB = {
    db: null,

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            // v16.0.7: Emergency Blocked Protection 🛡️
            request.onblocked = () => {
                console.warn('Dawaa DB: Update blocked by another tab. Please close other Dawaa tabs.');
                alert('تنبيه: يوجد تبويبات أخرى مفتوحة للتطبيق، يرجى إغلاقها لتفعيل التحديث الجديد. 🛰️');
                resolve(); // Resolve anyway to allow UI to boot
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log(`Dawaa DB: Upgrading to v${DB_VERSION}...`);
                
                db.onversionchange = () => {
                    db.close();
                    window.location.reload();
                };

                // Master Store
                if (!db.objectStoreNames.contains(STORES.MASTER)) {
                    const masterStore = db.createObjectStore(STORES.MASTER, { keyPath: 'id' });
                    masterStore.createIndex('by_name_en', 'nameEN', { unique: false });
                    masterStore.createIndex('by_name_ar', 'nameAR', { unique: false });
                }

                // Inventory Store
                if (!db.objectStoreNames.contains(STORES.INVENTORY)) {
                    const invStore = db.createObjectStore(STORES.INVENTORY, { keyPath: 'id' });
                    invStore.createIndex('by_medicine_id', 'medicineId', { unique: false });
                    invStore.createIndex('by_expiry', 'expiryDate', { unique: false });
                }

                // Categories & Settings
                if (!db.objectStoreNames.contains(STORES.CATEGORIES)) db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) db.createObjectStore(STORES.SETTINGS);
                if (!db.objectStoreNames.contains(STORES.AUDITS)) db.createObjectStore(STORES.AUDITS, { keyPath: 'id' });
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.db.onversionchange = () => {
                   this.db.close();
                   window.location.reload();
                };
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('Dawaa DB Error:', event.target.error);
                resolve(); // Fail gracefully to allow UI boot
            };
        });
    },

    async add(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(data.id);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async put(storeName, data) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(data.id);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async get(storeName, id) {
        const db = await this.init();
        if (!id) return null;
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAll(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async delete(storeName, id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clear(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteDB() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => {
                console.log('Dawaa DB: Database deleted.');
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }
};

window.DB = DB; // For debugging
