// js/core/sync.js
import { DB } from './db.js';
import { UI } from './ui.js';
import { db } from './firebase-config.js';

/**
 * Dawaa Cloud Sync Engine (v9.8.0 - Firebase Edition)

 * Handles Managed Master Data Synchronization with Firestore.
 */

export const Sync = {
    // We use a hierarchical document structure for better isolation: /pharmacies/{code}
    
    async pull() {
        const code = window.App?.pharmacyCode;
        if (!code) {
            console.log('Sync: No pharmacy code set. Pull skipped.');
            return;
        }
        
        console.log(`Sync: Pulling Cloud Master for [${code}]...`);
        try {
            // Document Path: pharmacies/{code}
            const docRef = db.collection('pharmacies').doc(code);
            const doc = await docRef.get();
            
            if (!doc.exists) {
                console.log('Sync: No cloud data found for this code yet.');
                return;
            }

            const data = doc.data();
            const globalMeds = data.masterData || [];
            
            if (globalMeds.length === 0) {
                console.log('Sync: Cloud master list is empty.');
                return;
            }

            // Syncing to local DB (Merging)
            let syncCount = 0;
            for (const med of globalMeds) {
                // Ensure lastSynced is updated for local tracking
                med.syncStatus = 'global'; 
                await DB.put('medicineMaster', med);
                syncCount++;
            }
            
            console.log(`Sync: Pulled ${syncCount} items from cloud.`);
            if (window.App?.renderMasterData) window.App.renderMasterData();
        } catch (err) {
            console.warn('Sync Pull Failed:', err);
            UI.showToast('فشل سحب البيانات. تأكد من إعدادات Firebase.', 'danger');
        }
    },

    async push(medId) {
        if (window.App?.userRole !== 'admin') {
            UI.showToast('صلاحيات المدير مطلوبة للنشر العالمي', 'danger');
            return;
        }

        const code = window.App?.pharmacyCode;
        if (!code) { 
            UI.showToast('يرجى ربط الصيدلية بالكود في الإعدادات أولاً', 'warning'); 
            return; 
        }

        UI.showToast('جاري النشر للسحابة 🔥...', 'info');

        try {
            // 1. Get the local medicine data
            const med = await DB.get('medicineMaster', medId);
            if (!med) throw new Error('Medicine not found locally');

            // 2. Prepare the update for the global hub
            const docRef = db.collection('pharmacies').doc(code);
            const doc = await docRef.get();
            
            let masterData = [];
            if (doc.exists) {
                masterData = doc.data().masterData || [];
            }

            // 3. Merge/Update the medicine in the cloud list
            const existingIdx = masterData.findIndex(m => m.id === med.id);
            
            // v9.8.0: Image is now a light Cloud URL (or local base64 waiting for upload)
            const syncMed = { 
                ...med, 
                syncStatus: 'global', 
                lastSynced: new Date().toISOString() 
            };



            if (existingIdx > -1) {
                masterData[existingIdx] = syncMed;
            } else {
                masterData.push(syncMed);
            }

            // 4. Save the full master list back to Firestore
            await docRef.set({ 
                masterData,
                updatedAt: (window.firebase || firebase).firestore.FieldValue.serverTimestamp()
            }, { merge: true });


            // 5. Update local status to reflect successful sync
            await DB.put('medicineMaster', syncMed);
            
            console.log(`Sync: Pushed "${med.nameEN}" successfully.`);
            if (window.App?.renderMasterData) window.App.renderMasterData();
            
            // Re-pull to ensure absolute consistency
            setTimeout(() => this.pull(), 1000);
            
        } catch (err) {
            const msg = err.code || err.message || 'خطأ غير معروف';
            UI.showToast(`فشل النشر العالمي: ${msg}`, 'danger');
            console.error('Push Error Details:', err);
        }

    },

    async submit(medId) {
        // Future: Submit to 'ReviewQueue' for larger networks
        UI.showToast('الصنف محلي حالياً. الأدمن سيقوم بنشره للسحابة.', 'info');
    }
};

window.Sync = Sync;

