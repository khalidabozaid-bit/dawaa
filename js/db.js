// js/db.js
/**
 * Dawaa Inventory Database Engine (IndexedDB)
 * Optimized for rapid medical inventory and bilingual lookup.
 */

const DB_NAME = 'DawaaInventoryDB';
const DB_VERSION = 1;
const STORES = {
    MASTER: 'medicineMaster', // Static medicine/supply definitions
    INVENTORY: 'inventory',   // Actual stock entries per location
    SETTINGS: 'settings'      // User preferences
};

export const DB = {
    db: null,

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Master Store: Medicine & Supplies Registry
                if (!db.objectStoreNames.contains(STORES.MASTER)) {
                    const masterStore = db.createObjectStore(STORES.MASTER, { keyPath: 'id' });
                    masterStore.createIndex('by_name_en', 'nameEN', { unique: false });
                    masterStore.createIndex('by_name_ar', 'nameAR', { unique: false });
                    masterStore.createIndex('by_ingredient', 'activeIngredient', { unique: false });
                }

                // 2. Inventory Store: Real-time stock counts
                if (!db.objectStoreNames.contains(STORES.INVENTORY)) {
                    const invStore = db.createObjectStore(STORES.INVENTORY, { keyPath: 'id' });
                    invStore.createIndex('by_medicine', 'medicineId', { unique: false });
                    invStore.createIndex('by_location', 'location', { unique: false });
                    invStore.createIndex('by_type', 'type', { unique: false }); // Medicine, Supply, Emergency
                }

                // 3. Settings Store
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS);
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('Dawaa DB Store Error:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    // --- Generic Operations ---

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
            request.onsuccess = () => resolve(request.result);
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

    // --- Specialized Queries ---

    async queryByIndex(storeName, indexName, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(IDBKeyRange.only(value));
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
};

// Expose for debugging if needed
window.DawaaDB = DB;
