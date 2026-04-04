// js/core/sync_v2.js
import { DB } from './db.js';
import { UI } from './ui.js';
import { db } from './firebase-config.js';

/**
 * MedicinesSyncLayer (v16.3.1 - Isolated Core)
 * Handles document-per-medicine Firestore synchronization.
 */
export const SyncV2 = {
    // Kill Switch (Controlled by Firestore config/sync)
    ACTIVE: false,
    LOG_COLLECTION: 'sync_logs',
    _unsubscribe: null,

    /**
     * Initialization: Listens for remote sync configuration.
     */
    async init() {
        if (this._unsubscribe) {
            console.warn('SyncV2: Already initialized, skipping duplicate subscription. 🛡️');
            return;
        }

        console.log('SyncV2: Initializing isolated engine... 📡');
        try {
            this._unsubscribe = db.collection('config').doc('sync').onSnapshot(doc => {
                if (doc.exists) {
                    this.ACTIVE = !!doc.data().syncV2_active;
                    console.log(`SyncV2: Isolated Status = ${this.ACTIVE ? 'ACTIVE ✅' : 'DISABLED 🔴'}`);
                }
            }, err => {
                console.error('SyncV2: Config stream error', err);
                this.log('INIT_V2_ERROR', 'FAIL', err.message);
            });

            await this.log('INIT_V2', 'SUCCESS', 'SyncV2 Module Initialized');
        } catch (err) {
            console.warn('SyncV2: Remote init failed', err);
        }
    },

    /**
     * Stop: Safely terminates the remote config listener.
     */
    stop() {
        if (this._unsubscribe) {
            console.log('SyncV2: Stopping engine and clearing listeners... 🛑');
            this._unsubscribe();
            this._unsubscribe = null;
            this.ACTIVE = false;
        }
    },

    /**
     * Centralized Logging System (Cloud)
     * @param {string} op - Operation name (e.g., PUSH_DUAL_SUCCESS)
     * @param {string} status - Result status (SUCCESS, FAIL, WARN)
     * @param {string} message - Descriptive log message
     * @param {string} medId - Affected Medicine ID
     * @param {object} extra - Additional metadata (version, source, retryable, etc)
     */
    async log(op, status, message, medId = null, extra = {}) {
        try {
            await db.collection(this.LOG_COLLECTION).add({
                op,
                status,
                message,
                medId,
                ...extra, // Flattening extra metadata for easier querying
                userName: window.App?.userName || 'system_worker',
                timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn('SyncV2: Logging failure', err);
        }
    },

    /**
     * PULL Logic: Fetches individual documents from 'medicines' collection.
     */
    async pull() {
        try {
            const snapshot = await db.collection('medicines').get();
            // v16.3.1: Explicitly return empty array instead of null for valid empty state
            if (snapshot.empty) return [];
            
            return snapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id,
                lastSynced: new Date().toISOString()
            }));
        } catch (err) {
            await this.log('PULL_V2_ERROR', 'CRITICAL', err.message, null, { source: 'pull', retryable: true });
            console.error('SyncV2: pull failed', err);
            return null; // Return null ONLY on technical failure
        }
    },

    /**
     * PUSH Logic: Writes/Updates a specific medicine document.
     */
    async push(medData) {
        try {
            const docRef = db.collection('medicines').doc(medData.id);
            const syncData = { 
                ...medData, 
                syncStatus: 'global_v2', 
                lastUpdatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp() 
            };
            
            await docRef.set(syncData, { merge: true });
            await this.log('PUSH_V2', 'SUCCESS', `Version ${medData.v} synced`, medData.id, { 
                version: medData.v, 
                source: 'push' 
            });
            return true;
        } catch (err) {
            await this.log('PUSH_V2_ERROR', 'FAIL', err.message, medData.id, { 
                version: medData.v, 
                source: 'push',
                retryable: true 
            });
            console.error('SyncV2: push failed', err);
            return false;
        }
    },

    /**
     * Migration Tool: Moves legacy data to 'medicines' collection.
     * @param {string} legacyPath - The Firestore path to pull legacy data from.
     */
    async runMigration(legacyPath) {
        if (!legacyPath) {
            console.error('SyncV2: Migration requires a valid legacyPath.');
            return null;
        }

        UI.showToast('جاري بدء هجرة البيانات (V2)... 🚚', 'info');
        await this.log('MIGRATION_START', 'INFO', `Manual migration from ${legacyPath} triggered`);
        
        try {
            const doc = await db.doc(legacyPath).get();
            if (!doc.exists) throw new Error('Legacy data not found');

            const legacyData = doc.data().masterData || [];
            let migratedCount = 0;
            let failedCount = 0;

            for (const med of legacyData) {
                const success = await this.push(med);
                if (success) migratedCount++;
                else failedCount++;
            }

            const status = failedCount === 0 ? 'SUCCESS' : 'PARTIAL';
            await this.log('MIGRATION_END', status, `Migrated: ${migratedCount}, Failed: ${failedCount}`, null, {
                source: 'migration',
                migrated: migratedCount,
                failed: failedCount
            });
            
            UI.showToast(`اكتملت الهجرة: تم نقل ${migratedCount} دواء بنجاح ✅`, 'success');
            return { migratedCount, failedCount };
        } catch (err) {
            UI.showToast(`فشلت الهجرة: ${err.message}`, 'danger');
            await this.log('MIGRATION_ERROR', 'CRITICAL', err.message, null, { source: 'migration' });
            return null;
        }
    }
};

// Global Exposure for Console access
window.SyncV2 = SyncV2;
