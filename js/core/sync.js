// js/core/sync.js
import { DB } from './db.js';
import { UI } from './ui.js';
import { db } from './firebase-config.js';

/**
 * Dawaa Cloud Sync Engine (v9.9.0 - Absolute Essence)
 * Handles Automatic Master Data Synchronization for a Single Pharmacy.
 */

export const Sync = {
    // Fixed Cloud Path for Single Pharmacy Architecture
    CLOUD_PATH: 'global_master/data',
    
    async pull() {
        console.log('Sync: Auto-Pulling Cloud Master (Ironclad v9.9.5)...');
        try {
            const docRef = db.doc(this.CLOUD_PATH);
            const doc = await docRef.get();
            
            if (!doc.exists) return;

            const data = doc.data();
            const globalMeds = data.masterData || [];
            
            if (globalMeds.length === 0) return;

            let syncCount = 0;
            for (const med of globalMeds) {
                // Image Protection: Don't overwrite local high-res with empty cloud data
                const localMed = await DB.get('medicineMaster', med.id);
                if (localMed && localMed.imagePath?.startsWith('data:image') && (!med.imagePath || med.imagePath === '')) {
                    med.imagePath = localMed.imagePath; // Keep local base64 until cloud URL arrives
                }

                med.syncStatus = 'global'; 
                await DB.put('medicineMaster', med);
                syncCount++;
            }
            
            console.log(`Sync: Auto-Pulled ${syncCount} items (Protected).`);
            if (window.App?.renderMasterData) window.App.renderMasterData();
        } catch (err) {
            console.warn('Sync Pull Failed:', err);
        }
    },

    async push(medId) {
        if (window.App?.userRole !== 'admin') {
            UI.showToast('صلاحيات المدير مطلوبة للنشر', 'danger');
            return;
        }

        UI.showToast('جاري النشر للسحابة 🔥...', 'info');

        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) throw new Error('Medicine not found locally');

            // Safety Strip: NEVER push base64 to Firestore (Avoid 1MB limit crash)
            const syncMed = { ...med, syncStatus: 'global', lastSynced: new Date().toISOString() };
            if (syncMed.imagePath?.startsWith('data:image')) {
                syncMed.imagePath = ''; // Only Cloud URLs (https://) allowed in Firestore
            }

            const docRef = db.doc(this.CLOUD_PATH);
            const doc = await docRef.get();
            
            let masterData = [];
            if (doc.exists) {
                masterData = doc.data().masterData || [];
            }

            const existingIdx = masterData.findIndex(m => m.id === med.id);
            if (existingIdx > -1) {
                masterData[existingIdx] = syncMed;
            } else {
                masterData.push(syncMed);
            }

            await docRef.set({ 
                masterData,
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // After push, we don't update local imagePath because it might still be base64 (local truth)
            med.syncStatus = 'global';
            await DB.put('medicineMaster', med);
            
            console.log(`Sync: Pushed "${med.nameEN}" (Striped).`);
            if (window.App?.renderMasterData) window.App.renderMasterData();
            
            setTimeout(() => this.pull(), 1000);
            
        } catch (err) {
            const msg = err.code || err.message || 'خطأ غير معروف';
            UI.showToast(`فشل النشر السحابي: ${msg}`, 'danger');
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
    }
};

window.Sync = Sync;

