import { UI } from './ui.js';
import { SyncV2 } from './sync_v2.js';
import { DB } from './db.js';
import { db } from './firebase-config.js';

/**
 * Dawaa Cloud Sync Engine (v16.3.1 - Restructured)
 * Handles Automatic Master Data Synchronization for a Single Pharmacy.
 */

export const Sync = {
    // v18.10.0: Removed dead CLOUD_PATH, V2_ACTIVE proxy, MedicinesSyncLayer proxy
    LOG_COLLECTION: 'sync_logs',
    _retryQueue: [],
    _retryTimer: null,

    async initV2() {
        return SyncV2.init();
    },

    async log(op, status, message, medId = null, extra = {}) {
        return SyncV2.log(op, status, message, medId, extra);
    },
    
    async pull() {
        console.log('Sync: Pulling Complete Cloud State (Medicines, Categories, Locations, Audits, Inventory)... ðŸ”„');
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) return;

        try {
            // 1. Pull Medicines (from 'medicines' collection â€” Pure V2)
            let cloudMeds = [];
            try {
                const medSnap = await firestore.collection('medicines').get();
                if (!medSnap.empty) {
                    cloudMeds = medSnap.docs.map(d => ({ ...d.data(), id: d.id }));
                }
            } catch (me) { console.warn('Sync pull medicines notice:', me.message); }

            if (Array.isArray(cloudMeds) && cloudMeds.length > 0) {
                const cloudMedIds = new Set();
                let syncCount = 0;
                for (const med of cloudMeds) {
                    cloudMedIds.add(med.id);
                    const localMed = await DB.get('medicineMaster', med.id);
                    if (localMed && localMed.imagePath?.startsWith('data:image') && (!med.imagePath || med.imagePath === '')) {
                        med.imagePath = localMed.imagePath;
                    }
                    med.v = med.v || (localMed ? localMed.v : 0);
                    med.syncStatus = 'synced';
                    await DB.put('medicineMaster', med);
                    syncCount++;
                }
                // v18.13.1: Reconcile IndexedDB — remove deleted/stale dummy records not in cloud
                // (preserve any unsynced offline additions with syncStatus === 'local')
                const allLocalMeds = (await DB.getAll('medicineMaster')) || [];
                let prunedCount = 0;
                for (const localMed of allLocalMeds) {
                    if (!cloudMedIds.has(localMed.id) && localMed.syncStatus !== 'local') {
                        await DB.delete('medicineMaster', localMed.id);
                        prunedCount++;
                    }
                }
                console.log(`Sync: Pulled ${syncCount} medicines from cloud (pruned ${prunedCount} stale local records). ✅`);
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
            } catch (ce) { console.warn('Sync pull categories notice:', ce.message); }

            // 3. Pull Locations
            try {
                const locSnap = await firestore.collection('locations').get();
                if (!locSnap.empty) {
                    for (const doc of locSnap.docs) {
                        await DB.put('locations', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (le) { console.warn('Sync pull locations notice:', le.message); }

            // 4. Pull Audit Sessions
            try {
                const sessionSnap = await firestore.collection('audit_sessions').get();
                if (!sessionSnap.empty) {
                    for (const doc of sessionSnap.docs) {
                        await DB.put('audit_sessions', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (se) { console.warn('Sync pull audit_sessions notice:', se.message); }

            // 5. Pull Inventory Stock Entries
            try {
                const invSnap = await firestore.collection('inventory_sync').get();
                if (!invSnap.empty) {
                    for (const doc of invSnap.docs) {
                        await DB.put('inventory', { ...doc.data(), id: doc.id });
                    }
                }
            } catch (ie) { console.warn('Sync pull inventory notice:', ie.message); }

            console.log('Sync: Full cloud state synchronization complete ✅');
            // v18.11.6: Invalidate dashboard cache so fresh data renders immediately
            if (window.App) {
                window.App._dashCache = null;
                window.App._dashCacheTime = 0;
            }
            if (window.App?.refreshAllViews) window.App.refreshAllViews();
            
            // Process any offline background image uploads
            this.processPendingImageQueue().catch(() => {});

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

            const newVersion = (med.v ?? 0) + 1;
            med.lastSynced = new Date().toISOString();
            
            const syncMed = { ...med, v: newVersion, syncStatus: 'global_v2' };
            
            // Allow lightweight compressed images (<120KB) to sync to Firestore doc; strip only giant legacy data URLs (>120KB)
            if (syncMed.imagePath?.startsWith('data:image') && syncMed.imagePath.length > 120000) {
                syncMed.imagePath = ''; 
            }

            // V2 Document-per-medicine write (Pure V2 â€” no legacy global_master)
            await firestore.collection('medicines').doc(med.id).set({
                ...syncMed,
                lastUpdatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // Only update local version AFTER successful cloud write
            med.v = newVersion;
            med.syncStatus = 'global_v2';
            await DB.put('medicineMaster', med);
            console.log(`Sync: Medicine "${med.nameEN || med.id}" pushed to cloud â˜ï¸âœ…`);
            
        } catch (err) {
            console.error('Sync Push Error:', err);
            throw err; // Re-throw for pushWithRetry to catch
        }
    },

    // v18.10.0: Retry wrapper with exponential backoff
    async pushWithRetry(medId, attempt = 1) {
        try {
            await this.push(medId);
        } catch (err) {
            if (attempt < 3) {
                const delay = attempt === 1 ? 5000 : 30000;
                console.warn(`Sync: Retry ${attempt}/3 for ${medId} in ${delay/1000}s...`);
                setTimeout(() => this.pushWithRetry(medId, attempt + 1), delay);
            } else {
                console.error(`Sync: Failed to push ${medId} after 3 attempts`);
                this._retryQueue.push({ medId, failedAt: Date.now() });
            }
        }
    },

    async deleteMedicine(medId) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !medId) return;

        try {
            // Delete from 'medicines' collection (Pure V2)
            await firestore.collection('medicines').doc(medId).delete();

            // Delete any stock entries in cloud for this medicine
            try {
                const invSnap = await firestore.collection('inventory_sync').where('medicineId', '==', medId).get();
                const batch = firestore.batch();
                invSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            } catch (ix) {}

            console.log(`Sync: Medicine "${medId}" deleted from cloud ðŸ—‘ï¸`);
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
            console.log(`Sync: Audit Session "${session.id}" pushed to cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync pushAuditSession notice:', e.message);
        }
    },

    async deleteAuditSession(id) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !id) return;
        try {
            await firestore.collection('audit_sessions').doc(id).delete();
            console.log(`Sync: Audit Session "${id}" deleted from cloud ðŸ—‘ï¸`);
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
            console.log(`Sync: Inventory Entry "${entry.id}" pushed to cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync pushInventoryEntry notice:', e.message);
        }
    },

    async deleteInventoryEntry(id) {
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore || !id) return;
        try {
            await firestore.collection('inventory_sync').doc(id).delete();
            console.log(`Sync: Inventory Entry "${id}" deleted from cloud ðŸ—‘ï¸`);
        } catch (e) {
            console.warn('Sync deleteInventoryEntry notice:', e.message);
        }
    },

    async submit(medId) {
        // Future: Submit to 'ReviewQueue' for larger networks
        UI.showToast('Ø§Ù„ØµÙ†Ù Ù…Ø­Ù„ÙŠ Ø­Ø§Ù„ÙŠØ§Ù‹. Ø§Ù„Ø£Ø¯Ù…Ù† Ø³ÙŠÙ‚ÙˆÙ… Ø¨Ù†Ø´Ø±Ù‡ Ù„Ù„Ø³Ø­Ø§Ø¨Ø©.', 'info');
    },

    /**
     * Collaborative Audit Synchronization (v10.5.0 Supreme Auditor)
     */
    async broadcastAuditStatus(session) {
        if (window.App?.userRole !== 'admin') return;
        try {
            const hostName = window.App?.user?.displayName || window.App?.user?.email || (typeof Users !== 'undefined' && Users.getActive() ? Users.getActive().name : 'ØµÙŠØ¯Ù„ÙŠ');
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
        console.log('Sync: Listening for Live Collaborative Audits... ðŸ“¡');
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
                userName: window.App?.userName || 'Ù…Ø³ØªØ®Ø¯Ù… Ø§Ù„Ù…ÙŠØ¯Ø§Ù†',
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

    // v14.0.0: Inventory Transaction Sync â€” delegated to pushInventoryEntry() above (L207)
    // Legacy duplicate removed to prevent .add() creating duplicates

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
                location_name: task.location || 'Ù…ØªØ¹Ø¯Ø¯',
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
            const timestamp = (window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()));
            await firestore.collection('categories').doc(cat.id).set({
                id: cat.id,
                nameAR: cat.nameAR,
                nameEN: cat.nameEN || cat.id,
                icon: cat.icon || 'bx-category',
                color: cat.color || '#3b82f6',
                isSystem: !!cat.isSystem,
                updatedAt: timestamp
            }, { merge: true });
            console.log(`Sync: Category ${cat.id} pushed to cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync Category Push notice:', e.message);
        }
    },

    async pushAllCategories() {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore) return;
            const localCats = (await DB.getAll('categories')) || [];
            for (const cat of localCats) {
                if (!cat.id || cat.id === 'undefined') continue;
                await this.pushCategory(cat);
            }
            console.log(`Sync: Pushed ${localCats.length} categories to cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync pushAllCategories notice:', e.message);
        }
    },

    async deleteCategory(id) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !id) return;
            await firestore.collection('categories').doc(id).delete();
            console.log(`Sync: Category ${id} deleted from cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync Category Delete notice:', e.message);
        }
    },

    // --- Bi-Directional Cloud Storage Locations Sync ---
    async pushLocation(loc) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !loc || !loc.id) return;
            const timestamp = (window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()));
            await firestore.collection('locations').doc(loc.id).set({
                id: loc.id,
                nameAR: loc.nameAR,
                nameEN: loc.nameEN || loc.nameAR || '',
                icon: loc.icon || 'bx-map-pin',
                color: loc.color || '#3b82f6',
                allowedCategories: loc.allowedCategories || ['all'],
                description: loc.description || '',
                isSystem: !!loc.isSystem,
                updatedAt: timestamp
            }, { merge: true });
            console.log(`Sync: Location ${loc.id} pushed to cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync Location Push notice:', e.message);
        }
    },

    async deleteLocation(id) {
        try {
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            if (!firestore || !id) return;
            await firestore.collection('locations').doc(id).delete();
            console.log(`Sync: Location ${id} deleted from cloud â˜ï¸`);
        } catch (e) {
            console.warn('Sync Location Delete notice:', e.message);
        }
    },

    // --- Live Real-Time Multi-Device Sync Stream (v18.7.3) ---
    _liveListeners: [],
    
    stopLiveSync() {
        if (this._liveListeners.length === 0) return;
        console.log('Sync: Stopping live sync streams...');
        for (const unsub of this._liveListeners) {
            try { unsub(); } catch (e) { console.warn("Sync stream setup notice:", e.message); }
        }
        this._liveListeners = [];
        console.log('Sync: All live sync streams stopped âœ…');
    },

    startLiveSync() {
        if (this._liveListeners.length > 0) return; // Already active
        console.log('Sync: Initializing real-time cross-device sync streams... ðŸ“¡âš¡');
        const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (!firestore) return;

        // 1. Live Master Medicines Collection (V2 â€” Pure Cloud Sync)
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
                    window.App._dashCache = null;
                    window.App._dashCacheTime = 0;
                    window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live medicines V2 notice:', err.message));
            this._liveListeners.push(unsubMeds);
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }

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
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }

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
                    window.App._dashCache = null;
                    window.App._dashCacheTime = 0;
                    window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live locations notice:', err.message));
            this._liveListeners.push(unsubLocs);
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }

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
                    console.log('Sync Live: Audit sessions synced from cloud ðŸ“¡');
                    if (window.App?.renderAuditView && UI.currentView === 'audit') {
                        window.App.renderAuditView();
                    }
                    if (window.App?.renderActiveAuditCard) {
                        window.App.renderActiveAuditCard();
                    }
                }
            }, err => console.warn('Sync Live audit_sessions notice:', err.message));
            this._liveListeners.push(unsubSessions);
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }

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
                    console.log('Sync Live: Inventory entries synced from cloud ðŸ“¡');
                    if (window.App?.refreshAllViews) window.App.refreshAllViews();
                }
            }, err => console.warn('Sync Live inventory_sync notice:', err.message));
            this._liveListeners.push(unsubInv);
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }
    },

    // --- On-Demand Full Cloud Sync (One-Click) ---
    async pullAll() {
        UI.showToast('Ø¬Ø§Ø±ÙŠ Ø³Ø­Ø¨ ÙˆÙ…Ø²Ø§Ù…Ù†Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ù† Ø§Ù„Ø³Ø­Ø§Ø¨Ø©... ðŸ”„', 'info');
        try {
            await this.pull();
            const firestore = (typeof db !== 'undefined' ? db : window.db) || (window.firebase?.firestore ? window.firebase.firestore() : null);
            let catCount = 0;
            let locCount = 0;

            if (firestore) {
                const catSnap = await firestore.collection('categories').get();
                if (!catSnap.empty) {
                    for (const doc of catSnap.docs) {
                        await DB.put('categories', { ...doc.data(), id: doc.id });
                        catCount++;
                    }
                }
                // Push any local categories that are missing from cloud
                await this.pushAllCategories();

                if (typeof Categories !== 'undefined') {
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
            UI.showToast(`ØªÙ…Øª Ù…Ø²Ø§Ù…Ù†Ø© ÙƒØ§Ù…Ù„ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø¹ Ø§Ù„Ø³Ø­Ø§Ø¨Ø© (${allMeds.length} Ø¯ÙˆØ§Ø¡) â˜ï¸âœ…`, 'success');
        } catch (err) {
            console.error('PullAll Error:', err);
            UI.showToast(`ØªØ¹Ø°Ø± Ø³Ø­Ø¨ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª: ${err.message || 'Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø§ØªØµØ§Ù„'}`, 'danger');
        }
    },

    /**
     * Offline Background Image Upload Queue (v18.8.0)
     * Automatically captures and queues images while offline, drains when online.
     */
    enqueuePendingImage(medId, dataUrl) {
        if (!medId || !dataUrl || !dataUrl.startsWith('data:image')) return;
        try {
            const queueKey = 'dawaa_pending_image_queue';
            let queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
            queue = queue.filter(item => item.medId !== medId);
            queue.push({ medId, dataUrl, timestamp: Date.now() });
            localStorage.setItem(queueKey, JSON.stringify(queue));
            console.log(`Sync: Enqueued image for medicine ${medId} to offline queue â³`);
        } catch (e) {
            console.warn('Error enqueuing image:', e);
        }
    },

    async processPendingImageQueue() {
        if (!navigator.onLine) return;
        const queueKey = 'dawaa_pending_image_queue';
        let queue = [];
        try {
            queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
        } catch (e) {
            return;
        }
        if (!Array.isArray(queue) || queue.length === 0) return;

        console.log(`Sync: Processing ${queue.length} pending offline images... â˜ï¸`);
        const remaining = [];
        let successCount = 0;

        for (const item of queue) {
            try {
                if (typeof window.App?.uploadImage === 'function') {
                    const res = await fetch(item.dataUrl);
                    const blob = await res.blob();
                    const cloudUrl = await window.App.uploadImage(blob, item.medId);
                    if (cloudUrl) {
                        const med = await DB.get('medicineMaster', item.medId);
                        if (med) {
                            med.imagePath = cloudUrl;
                            await DB.put('medicineMaster', med);
                            await this.push(item.medId);
                            successCount++;
                        }
                    } else {
                        remaining.push(item);
                    }
                }
            } catch (err) {
                console.warn(`Sync: Failed to upload pending image for ${item.medId}:`, err);
                remaining.push(item);
            }
        }

        try {
            localStorage.setItem(queueKey, JSON.stringify(remaining));
        } catch (e) { console.warn("Sync stream setup notice:", e.message); }

        if (successCount > 0) {
            console.log(`Sync: Successfully synced ${successCount} offline images to cloud! âœ¨`);
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(`ØªÙ…Øª Ù…Ø²Ø§Ù…Ù†Ø© ${successCount} ØµÙˆØ±Ø© Ù…Ø¹Ù„Ù‚Ø© ÙÙŠ Ø§Ù„Ø³Ø­Ø§Ø¨Ø© Ø¨Ù†Ø¬Ø§Ø­ âœ¨`, 'success');
            }
            if (window.App?.refreshAllViews) window.App.refreshAllViews();
        }
    }
};

window.Sync = Sync;

