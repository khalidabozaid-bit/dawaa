import { SyncV2 } from './sync_v2.js';

/**
 * Dawaa Cloud Sync Engine (v16.3.1 - Restructured)
 * Handles Automatic Master Data Synchronization for a Single Pharmacy.
 */

export const Sync = {
    // Fixed Cloud Path for Single Pharmacy Architecture
    CLOUD_PATH: 'global_master/data',
    
    // v16.3.1: Delegated V2 Bridge
    get V2_ACTIVE() { return SyncV2.ACTIVE; },
    isV2Active() { return SyncV2.ACTIVE; },
    LOG_COLLECTION: 'sync_logs',

    async initV2() {
        return SyncV2.init();
    },

    async log(op, status, message, medId = null, extra = {}) {
        return SyncV2.log(op, status, message, medId, extra);
    },

    /**
     * MedicinesSyncLayer (v16.3.1 - Proxy)
     */
    MedicinesSyncLayer: {
        async pullV2() { return SyncV2.pull(); },
        async pushV2(med) { return SyncV2.push(med); },
        async runMigration() { return SyncV2.runMigration(Sync.CLOUD_PATH); }
    },
    
    async pull() {
        console.log(`Sync: Pulling Master Data (Mode: ${this.isV2Active() ? 'V2' : 'Legacy'})... 🔄`);
        
        try {
            let globalMeds = null;
            let currentMode = this.isV2Active() ? 'V2' : 'LEGACY';

            // 1. Try V2 Mode via isolated module
            if (this.isV2Active()) {
                globalMeds = await SyncV2.pull();
                // v16.3.1: Only fallback if result is strictly NULL (error), not empty array []
                if (globalMeds === null) {
                    await this.log('PULL_FALLBACK', 'WARN', 'V2 technical failure, falling back to Legacy');
                    currentMode = 'LEGACY';
                }
            }

            // 2. Fallback to Legacy logic
            if (currentMode === 'LEGACY') {
                const docRef = db.doc(this.CLOUD_PATH);
                const doc = await docRef.get();
                if (doc.exists) {
                    globalMeds = doc.data().masterData || [];
                }
            }

            if (!globalMeds || (Array.isArray(globalMeds) && globalMeds.length === 0)) {
                console.log('Sync: No data to update locally.');
                return;
            }

            // 3. Process and Save Locally
            let syncCount = 0;
            for (const med of globalMeds) {
                const localMed = await DB.get('medicineMaster', med.id);
                
                if (localMed && localMed.imagePath?.startsWith('data:image') && (!med.imagePath || med.imagePath === '')) {
                    med.imagePath = localMed.imagePath;
                }

                med.v = med.v || (localMed ? localMed.v : 0);
                med.syncStatus = currentMode === 'V2' ? 'global_v2' : 'global_legacy';
                
                await DB.put('medicineMaster', med);
                syncCount++;
            }
            
            console.log(`Sync: Pulled ${syncCount} items via ${currentMode}. ✅`);
            if (window.App?.renderMasterData) window.App.renderMasterData();
            
        } catch (err) {
            const msg = err.code || err.message || 'خطأ غير معروف';
            console.error('Sync Pull Failed:', err);
            await this.log('PULL_ERROR', 'CRITICAL', msg, null, { source: 'pull', retryable: true });
        }
    },

    async push(medId) {
        if (window.App?.userRole !== 'admin') {
            UI.showToast('صلاحيات المدير مطلوبة للنشر', 'danger');
            return;
        }

        UI.showToast('جاري التحديث السحابي الشامل 🔥...', 'info');

        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) throw new Error('Medicine not found locally');

            med.v = (med.v || 0) + 1;
            med.lastSynced = new Date().toISOString();
            
            const syncMed = { ...med, syncStatus: 'global' };
            if (syncMed.imagePath?.startsWith('data:image')) {
                syncMed.imagePath = ''; 
            }

            const logMeta = { version: med.v, source: 'push' };

            // 1. Legacy Write (Old Structure)
            let legacySuccess = false;
            try {
                const docRef = db.doc(this.CLOUD_PATH);
                const doc = await docRef.get();
                let masterData = doc.exists ? (doc.data().masterData || []) : [];
                
                const existingIdx = masterData.findIndex(m => m.id === med.id);
                if (existingIdx > -1) masterData[existingIdx] = syncMed;
                else masterData.push(syncMed);

                await docRef.set({ 
                    masterData,
                    updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                legacySuccess = true;
            } catch (lex) {
                console.warn('Sync: Legacy push failed...', lex);
            }

            // 2. V2 Write via isolated SyncV2 module
            let v2Success = false;
            if (this.isV2Active()) {
                v2Success = await SyncV2.push(syncMed);
            }

            // 3. Enriched Logging Matrix (Observability)
            if (legacySuccess && v2Success) {
                await this.log('PUSH_DUAL_SUCCESS', 'SUCCESS', `Synced version ${med.v} to both layers`, med.id, logMeta);
            } else if (legacySuccess && !v2Success) {
                const status = this.isV2Active() ? 'FAIL' : 'WARN';
                await this.log('PUSH_PARTIAL_SUCCESS_V2_FAIL', status, 'Legacy OK, V2 failed', med.id, { ...logMeta, retryable: true });
            } else if (!legacySuccess && v2Success) {
                await this.log('PUSH_PARTIAL_SUCCESS_LEGACY_FAIL', 'WARN', 'Legacy failed, V2 OK', med.id, { ...logMeta, retryable: true });
            } else {
                await this.log('PUSH_TOTAL_FAIL', 'CRITICAL', 'Both Legacy and V2 writes failed', med.id, { ...logMeta, retryable: true });
                throw new Error('Cloud push failed completely');
            }

            med.syncStatus = v2Success ? 'global_v2' : 'global_legacy';
            await DB.put('medicineMaster', med);
            
            UI.showToast(`تم تأمين "${med.nameEN}" سحابياً ✅`, 'success');
            if (window.App?.renderMasterData) window.App.renderMasterData();
            
        } catch (err) {
            const msg = err.code || err.message || 'خطأ غير معروف';
            UI.showToast(`فشل التحديث السحابي: ${msg}`, 'danger');
            await this.log('PUSH_ERROR', 'CRITICAL', msg, medId, { source: 'push', retryable: true });
        }
    },

    async submit(medId) {
        // Future: Submit to 'ReviewQueue' for larger networks
        UI.showToast('الصنف محلي حالياً. الأدمن سيقوم بنشره للسحابة.', 'info');
    },

    /**
     * Collaborative Audit Synchronization (v10.5.0 Supreme Auditor)
     */
    async broadcastAuditStatus(session) {
        if (window.App?.userRole !== 'admin') return;
        try {
            await db.collection('audits').doc('current').set({
                ...session,
                active: !!session,
                participants: session ? [window.App.user.displayName || window.App.user.email] : [],
                host: session ? (window.App.user.displayName || window.App.user.email) : null,
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn('Sync: Failed to broadcast audit status', err);
        }
    },

    async joinAudit(userName) {
        try {
            const docRef = db.collection('audits').doc('current');
            const doc = await docRef.get();
            if (doc.exists && doc.data().active) {
                const participants = doc.data().participants || [];
                if (!participants.includes(userName)) {
                    participants.push(userName);
                    await docRef.update({ participants });
                }
                return true;
            }
            return false;
        } catch (err) {
            console.error('Join Error:', err);
            return false;
        }
    },

    subscribeToAudit(callback) {
        console.log('Sync: Listening for Live Collaborative Audits... 📡');
        return db.collection('audits').doc('current').onSnapshot(doc => {
            if (doc.exists) {
                const data = doc.data();
                callback(data.active ? data : null);
            } else {
                callback(null);
            }
        }, err => {
            console.error('Audit Stream Error:', err);
        });
    },

    async pushAuditEntry(entry) {
        try {
            await db.collection('audit_feed').add({
                ...entry,
                userName: window.App?.userName || 'مستخدم الميدان',
                timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn('Sync: Push Audit Entry Failed', err);
        }
    },

    subscribeToFeed(auditId, callback) {
        return db.collection('audit_feed')
            .where('auditId', '==', auditId)
            .orderBy('timestamp', 'desc')
            .limit(5)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        callback(change.doc.data());
                    }
                });
            });
    },

    // v14.0.0: Inventory Transaction Sync (The Heart of Global Auditing)
    async pushInventoryEntry(entry) {
        if (!entry.auditId) return;
        try {
            console.log('Sync: Pushing inventory entry to cloud...');
            await db.collection('inventory_sync').add({
                ...entry,
                cloud_timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error('Cloud Entry Push Failed:', err);
        }
    },

    subscribeToInventory(auditId, callback) {
        if (!auditId) return null;
        console.log(`Sync: Subscribing to Cloud Inventory for mission ${auditId}...`);
        
        return db.collection('inventory_sync')
            .where('auditId', '==', auditId)
            .onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let hasNew = false;
                
                for (const change of changes) {
                    if (change.type === 'added') {
                        const cloudData = change.doc.data();
                        // Deduplicate Cloud vs Local
                        const exists = await DB.get('inventory', cloudData.id);
                        if (!exists) {
                            await DB.put('inventory', cloudData);
                            hasNew = true;
                        }
                    }
                }
                
                if (hasNew && callback) {
                    callback();
                }
            });
    },

    // v15.0.0: Structured Task-Based Sessions (The Task Engine)
    async createStructuredSession(name, assignments) {
        const sessionId = 'session_' + Date.now();
        const batch = db.batch();
        
        // 1. Create Session Header
        const sessionRef = db.collection('inventory_sessions').doc(sessionId);
        batch.set(sessionRef, {
            id: sessionId,
            name: name,
            status: 'in_progress',
            created_by: window.App?.user?.displayName || window.App?.user?.email,
            created_at: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
        });

        // 2. Create Tasks for each assignment
        assignments.forEach(task => {
            const taskId = 'task_' + Math.random().toString(36).substr(2, 9);
            const taskRef = db.collection('inventory_tasks').doc(taskId);
            batch.set(taskRef, {
                id: taskId,
                session_id: sessionId,
                user_id: task.user_id, 
                location_name: task.location || 'متعدد',
                location_ids: task.location_ids || [task.location], // Array Support
                type: task.individual ? 'individual' : 'group',
                status: 'pending',
                progress: 0,
                total_items: 0 
            });
        });

        await batch.commit();
        return sessionId;
    },

    subscribeToUserTasks(userId, callback) {
        return db.collection('inventory_tasks')
            .where('user_id', '==', userId)
            .where('status', 'in', ['pending', 'in_progress'])
            .onSnapshot(snapshot => {
                const tasks = snapshot.docs.map(doc => doc.data());
                callback(tasks);
            });
    },

    async pushTaskCount(taskId, productId, quantity, locationId) {
        const countId = `count_${taskId}_${locationId}_${productId}`;
        await db.collection('inventory_counts').doc(countId).set({
            id: countId,
            task_id: taskId,
            product_id: productId,
            location_id: locationId, // Mandatory Context
            quantity: parseFloat(quantity) || 0,
            timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
        });
    },

    subscribeToSessionProgress(sessionId, callback) {
        return db.collection('inventory_tasks')
            .where('session_id', '==', sessionId)
            .onSnapshot(snapshot => {
                const tasks = snapshot.docs.map(doc => doc.data());
                callback(tasks);
            });
    }
};

window.Sync = Sync;

