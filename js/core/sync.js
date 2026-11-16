import { UI } from './ui.js';
import { SyncV2 } from './sync_v2.js';
import { DB } from './db.js';
import { db } from './firebase-config.js';

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
        console.log('Sync: Pulling Complete Cloud State (Medicines, Categories, Locations, Audits, Inventory)... 🔄');
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) return;

        try {
            // 1. Pull Medicines (from 'medicines' collection with fallback to CLOUD_PATH)
            let cloudMeds = [];
            try {
                const medSnap = await firestore.collection('medicines').get();
                if (!medSnap.empty) {
                    cloudMeds = medSnap.docs.map(d => ({ ...d.data(), id: d.id }));
                }
            } catch (me) {}

            if (!cloudMeds || cloudMeds.length === 0) {
                try {
                    const doc = await firestore.doc(this.CLOUD_PATH).get();
                    if (doc.exists) cloudMeds = doc.data().masterData || [];
                } catch (de) {}
            }

            if (Array.isArray(cloudMeds) && cloudMeds.length > 0) {
                let syncCount = 0;
                for (const med of cloudMeds) {
                    const localMed = await DB.get('medicineMaster', med.id);
                    if (localMed && localMed.imagePath?.startsWith('data:image') && (!med.imagePath || med.imagePath === '')) {
                        med.imagePath = localMed.imagePath;
                    }
                    med.v = med.v || (localMed ? localMed.v : 0);
                    med.syncStatus = 'synced';
                    await DB.put('medicineMaster', med);
                    syncCount++;
                }
                console.log(`Sync: Pulled ${syncCount} medicines from cloud. ✅`);
            }

            // 2. Pull Categories
            try {
                const catSnap = await firestore.collection('categories').get();
                if (!catSnap.empty) {
                    for (const doc of catSnap.docs) {
                        await DB.put('categories', { ...doc.data(), id: doc.id });
                    }
                    if (typeof Categories !== 'undefined') {
                        Categories.cache = null;
                        Categories._cache = null;
                    }
                }
            } catch (ce) {}

            // 3. Pull Locations
            try {
                const locSnap = await firestore.collection('locations').get();
                if (!locSnap.empty) {
                    for (const doc of locSnap.docs) {
                        await DB.put('locations', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (le) {}

            // 4. Pull Audit Sessions
            try {
                const sessionSnap = await firestore.collection('audit_sessions').get();
                if (!sessionSnap.empty) {
                    for (const doc of sessionSnap.docs) {
                        await DB.put('audit_sessions', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (se) {}

            // 5. Pull Inventory Stock Entries
            try {
                const invSnap = await firestore.collection('inventory_sync').get();
                if (!invSnap.empty) {
                    for (const doc of invSnap.docs) {
                        await DB.put('inventory', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (ie) {}

            console.log('Sync: Full cloud state synchronization complete ✅');
            if (window.App?.refreshAllViews) window.App.refreshAllViews();

        } catch (err) {
            console.error('Sync Pull Failed:', err);
        }
    },

    async push(medId) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) {
            console.log('Sync.push: Skipped cloud write (Firestore not initialized).');
            return;
        }

        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) throw new Error('Medicine not found locally');

            med.v = (med.v || 0) + 1;
            med.lastSynced = new Date().toISOString();
            
            const syncMed = { ...med, syncStatus: 'global_v2' };
            
            // Allow lightweight compressed images (<120KB) to sync to Firestore doc; strip only giant legacy data URLs (>120KB)
            if (syncMed.imagePath?.startsWith('data:image') && syncMed.imagePath.length > 120000) {
                syncMed.imagePath = ''; 
            }

            // 1. V2 Document-per-medicine write for live multi-device listeners
            await firestore.collection('medicines').doc(med.id).set({
                ...syncMed,
                lastUpdatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // 2. Legacy Master Array write for backward compatibility
            try {
                const docRef = firestore.doc(this.CLOUD_PATH);
                const doc = await docRef.get();
                let masterData = doc.exists ? (doc.data().masterData || []) : [];
                
                // In the legacy multi-item array, strip data:image to avoid 1MB document limit
                const legacyMed = { ...syncMed };
                if (legacyMed.imagePath?.startsWith('data:image')) {
                    legacyMed.imagePath = '';
                }

                const existingIdx = masterData.findIndex(m => m.id === med.id);
                if (existingIdx > -1) masterData[existingIdx] = legacyMed;
                else masterData.push(legacyMed);

                await docRef.set({ 
                    masterData,
                    updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch (lex) {
                console.warn('Sync: Legacy master array write warning:', lex.message);
            }

            med.syncStatus = 'global_v2';
            await DB.put('medicineMaster', med);
            console.log(`Sync: Medicine "${med.nameEN || med.id}" pushed to cloud ☁️✅`);
            
        } catch (err) {
            console.error('Sync Push Error:', err);
        }
    },

    async deleteMedicine(medId) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !medId) return;

        try {
            // 1. Delete from 'medicines' collection
            await firestore.collection('medicines').doc(medId).delete();

            // 2. Remove from legacy array
            try {
                const docRef = firestore.doc(this.CLOUD_PATH);
                const doc = await docRef.get();
                if (doc.exists) {
                    let masterData = doc.data().masterData || [];
                    masterData = masterData.filter(m => m.id !== medId);
                    await docRef.set({
                        masterData,
                        updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
            } catch (lex) {}

            // 3. Delete any stock entries in cloud for this medicine
            try {
                const invSnap = await firestore.collection('inventory_sync').where('medicineId', '==', medId).get();
                const batch = firestore.batch();
                invSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            } catch (ix) {}

            console.log(`Sync: Medicine "${medId}" deleted from cloud 🗑️`);
        } catch (err) {
            console.error('Sync deleteMedicine error:', err);
        }
    },

    // --- Audit Sessions Cloud Sync ---
    async pushAuditSession(session) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !session || !session.id) return;
        try {
            await firestore.collection('audit_sessions').doc(session.id).set({
                ...session,
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Sync: Audit Session "${session.id}" pushed to cloud ☁️`);
        } catch (e) {
            console.warn('Sync pushAuditSession notice:', e.message);
        }
    },

    async deleteAuditSession(id) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !id) return;
        try {
            await firestore.collection('audit_sessions').doc(id).delete();
            console.log(`Sync: Audit Session "${id}" deleted from cloud 🗑️`);
        } catch (e) {
            console.warn('Sync deleteAuditSession notice:', e.message);
        }
    },

    // --- Inventory Stock Entries Cloud Sync ---
    async pushInventoryEntry(entry) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !entry || !entry.id) return;
        try {
            await firestore.collection('inventory_sync').doc(entry.id).set({
                ...entry,
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Sync: Inventory Entry "${entry.id}" pushed to cloud ☁️`);
        } catch (e) {
            console.warn('Sync pushInventoryEntry notice:', e.message);
        }
    },

    async deleteInventoryEntry(id) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !id) return;
        try {
            await firestore.collection('inventory_sync').doc(id).delete();
            console.log(`Sync: Inventory Entry "${id}" deleted from cloud 🗑️`);
        } catch (e) {
            console.warn('Sync deleteInventoryEntry notice:', e.message);
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
            const hostName = window.App?.user?.displayName || window.App?.user?.email || (typeof Users !== 'undefined' && Users.getActive() ? Users.getActive().name : 'صيدلي');
            const participants = (session && session.participants && session.participants.length > 0) ? session.participants : [hostName];
            await db.collection('audits').doc('current').set({
                ...session,
                active: !!session,
                participants: participants,
                host: hostName,
                updatedAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString())
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
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) {
            console.warn('Sync: Firestore db not ready, skipping live audit stream.');
            return null;
        }
        try {
            return firestore.collection('audits').doc('current').onSnapshot(doc => {
                if (doc.exists) {
                    const data = doc.data();
                    callback(data.active ? data : null);
                } else {
                    callback(null);
                }
            }, err => {
                console.warn('Sync: Live audit stream unavailable (offline or permission required):', err.message);
            });
        } catch (e) {
            console.warn('Sync: Could not subscribe to audit:', e.message);
            return null;
        }
    },

    async pushAuditEntry(entry) {
        try {
            await db.collection('audit_feed').add({
                ...entry,
                userName: window.App?.userName || 'مستخدم الميدان',
                timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn('Sync: Push Audit Entry skipped (offline mode):', err?.message);
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
    },

    // --- Bi-Directional Cloud Categories Sync ---
    async pushCategory(cat) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !cat || !cat.id) return;
            await firestore.collection('categories').doc(cat.id).set({
                id: cat.id,
                nameAR: cat.nameAR,
                nameEN: cat.nameEN || cat.id,
                icon: cat.icon || 'bx-category',
                color: cat.color || '#3b82f6',
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Sync: Category ${cat.id} pushed to cloud ☁️`);
        } catch (e) {
            console.warn('Sync Category Push notice:', e.message);
        }
    },

    async deleteCategory(id) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !id) return;
            await firestore.collection('categories').doc(id).delete();
            console.log(`Sync: Category ${id} deleted from cloud ☁️`);
        } catch (e) {
            console.warn('Sync Category Delete notice:', e.message);
        }
    },

    // --- Bi-Directional Cloud Storage Locations Sync ---
    async pushLocation(loc) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !loc || !loc.id) return;
            await firestore.collection('locations').doc(loc.id).set({
                id: loc.id,
                nameAR: loc.nameAR,
                nameEN: loc.nameEN || loc.nameAR || '',
                icon: loc.icon || 'bx-map-pin',
                color: loc.color || '#3b82f6',
                allowedCategories: loc.allowedCategories || ['all'],
                description: loc.description || '',
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`Sync: Location ${loc.id} pushed to cloud ☁️`);
        } catch (e) {
            console.warn('Sync Location Push notice:', e.message);
        }
    },

    async deleteLocation(id) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !id) return;
            await firestore.collection('locations').doc(id).delete();
            console.log(`Sync: Location ${id} deleted from cloud ☁️`);
        } catch (e) {
            console.warn('Sync Location Delete notice:', e.message);
        }
    },

    // --- Live Real-Time Multi-Device Sync Stream (v18.7.3) ---
    _liveListeners: [],
    startLiveSync() {
        if (this._liveListeners.length > 0) return; // Already active
        console.log('Sync: Initializing real-time cross-device sync streams... 📡⚡');
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) return;

        // 1. Live Master Data (Legacy Single-Pharmacy Document)
        try {
            const unsubMaster = firestore.doc(this.CLOUD_PATH).onSnapshot(async (doc) => {
                if (!doc.exists) return;
                const cloudMeds = doc.data()?.masterData;
                if (!Array.isArray(cloudMeds) || cloudMeds.length === 0) return;

                let updatedCount = 0;
                for (const med of cloudMeds) {
                    const localMed = await DB.get('medicineMaster', med.id);
                    if (!localMed || (med.v && med.v > (localMed.v || 0)) || (!localMed.v && med.lastSynced && med.lastSynced !== localMed.lastSynced)) {
                        if (localMed && localMed.imagePath?.startsWith('data:image') && (!med.imagePath || med.imagePath === '')) {
                            med.imagePath = localMed.imagePath;
                        }
                        med.syncStatus = 'synced';
                        await DB.put('medicineMaster', med);
                        updatedCount++;
                    }
                }
                if (updatedCount > 0) {
                    console.log(`Sync Live: ${updatedCount} medicines synchronized from cloud.`);
                    if (window.App?.refreshAllViews) window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live master notice:', err.message));
            this._liveListeners.push(unsubMaster);
        } catch (e) {}

        // 2. Live Master Medicines Collection (V2)
        try {
            const unsubMeds = firestore.collection('medicines').onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let updated = false;
                for (const change of changes) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const med = { ...change.doc.data(), id: change.doc.id };
                        const local = await DB.get('medicineMaster', med.id);
                        if (!local || (med.v && med.v > (local.v || 0))) {
                            if (local && local.imagePath?.startsWith('data:image') && !med.imagePath) {
                                med.imagePath = local.imagePath;
                            }
                            await DB.put('medicineMaster', med);
                            updated = true;
                        }
                    } else if (change.type === 'removed') {
                        await DB.delete('medicineMaster', change.doc.id);
                        updated = true;
                    }
                }
                if (updated && window.App?.refreshAllViews) {
                    window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live medicines V2 notice:', err.message));
            this._liveListeners.push(unsubMeds);
        } catch (e) {}

        // 3. Live Categories Collection
        try {
            const unsubCats = firestore.collection('categories').onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let updated = false;
                for (const change of changes) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const cat = { ...change.doc.data(), id: change.doc.id };
                        const local = await DB.get('categories', cat.id);
                        if (!local || local.nameAR !== cat.nameAR || local.nameEN !== cat.nameEN || local.icon !== cat.icon || local.color !== cat.color) {
                            await DB.put('categories', cat);
                            updated = true;
                        }
                    } else if (change.type === 'removed') {
                        await DB.delete('categories', change.doc.id);
                        updated = true;
                    }
                }
                if (updated) {
                    if (typeof Categories !== 'undefined') {
                        Categories.cache = null;
                        Categories._cache = null;
                        await Categories.getAllSorted();
                    }
                    if (window.App?.refreshAllViews) window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live categories notice:', err.message));
            this._liveListeners.push(unsubCats);
        } catch (e) {}

        // 4. Live Locations Collection
        try {
            const unsubLocs = firestore.collection('locations').onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let updated = false;
                for (const change of changes) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const loc = { ...change.doc.data(), id: change.doc.id };
                        const local = await DB.get('locations', loc.id);
                        if (!local || local.nameAR !== loc.nameAR || local.nameEN !== loc.nameEN || local.icon !== loc.icon) {
                            await DB.put('locations', loc);
                            updated = true;
                        }
                    } else if (change.type === 'removed') {
                        await DB.delete('locations', change.doc.id);
                        updated = true;
                    }
                }
                if (updated && window.App?.refreshAllViews) {
                    window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live locations notice:', err.message));
            this._liveListeners.push(unsubLocs);
        } catch (e) {}

        // 5. Live Audit Sessions Collection
        try {
            const unsubSessions = firestore.collection('audit_sessions').onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let updated = false;
                for (const change of changes) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const session = { ...change.doc.data(), id: change.doc.id };
                        await DB.put('audit_sessions', session);
                        updated = true;
                    } else if (change.type === 'removed') {
                        await DB.delete('audit_sessions', change.doc.id);
                        updated = true;
                    }
                }
                if (updated) {
                    console.log('Sync Live: Audit sessions synced from cloud 📡');
                    if (window.App?.renderAuditView && UI.currentView === 'audit') {
                        window.App.renderAuditView();
                    }
                    if (window.App?.renderActiveAuditCard) {
                        window.App.renderActiveAuditCard();
                    }
                }
            }, err => console.warn('Sync Live audit_sessions notice:', err.message));
            this._liveListeners.push(unsubSessions);
        } catch (e) {}

        // 6. Live Inventory Sync Collection
        try {
            const unsubInv = firestore.collection('inventory_sync').onSnapshot(async (snapshot) => {
                const changes = snapshot.docChanges();
                let updated = false;
                for (const change of changes) {
                    if (change.type === 'added' || change.type === 'modified') {
                        const entry = { ...change.doc.data(), id: change.doc.id };
                        await DB.put('inventory', entry);
                        updated = true;
                    } else if (change.type === 'removed') {
                        await DB.delete('inventory', change.doc.id);
                        updated = true;
                    }
                }
                if (updated) {
                    console.log('Sync Live: Inventory entries synced from cloud 📡');
                    if (window.App?.refreshAllViews) window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live inventory_sync notice:', err.message));
            this._liveListeners.push(unsubInv);
        } catch (e) {}
    },

    // --- On-Demand Full Cloud Sync (One-Click) ---
    async pullAll() {
        UI.showToast('جاري سحب ومزامنة البيانات من السحابة... 🔄', 'info');
        try {
            await this.pull();
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            let catCount = 0;
            let locCount = 0;

            if (firestore) {
                const catSnap = await firestore.collection('categories').get();
                for (const doc of catSnap.docs) {
                    await DB.put('categories', { ...doc.data(), id: doc.id });
                    catCount++;
                }
                if (catCount > 0 && typeof Categories !== 'undefined') {
                    Categories.cache = null;
                    Categories._cache = null;
                    await Categories.getAllSorted();
                }

                const locSnap = await firestore.collection('locations').get();
                for (const doc of locSnap.docs) {
                    await DB.put('locations', { ...doc.data(), id: doc.id });
                    locCount++;
                }
            }

            const allMeds = (await DB.getAll('medicineMaster')) || [];
            if (window.App?.refreshAllViews) await window.App.refreshAllViews();
            UI.showToast(`تمت مزامنة كامل البيانات مع السحابة (${allMeds.length} دواء) ☁️✅`, 'success');
        } catch (err) {
            console.error('PullAll Error:', err);
            UI.showToast(`تعذر سحب البيانات: ${err.message || 'خطأ في الاتصال'}`, 'danger');
        }
    }
};

window.Sync = Sync;

