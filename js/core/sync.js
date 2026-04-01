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
    }
};

window.Sync = Sync;

