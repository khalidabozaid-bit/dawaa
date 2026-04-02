import { DB } from './db.js';
import { db } from './firebase-config.js';

/**
 * دواء - محرك المزامنة المستقر (v16.0.3 Silent Sync)
 * يوفر مزامنة سحابية هادئة ولا يزعج المستخدم في حال فشل الاتصال.
 */

export const Sync = {
    CLOUD_PATH: 'global_master/data',
    
    // سحب بيانات الأدوية العالمية
    async pull() {
        try {
            const doc = await db.doc(this.CLOUD_PATH).get();
            if (!doc.exists) return;

            const globalMeds = doc.data().masterData || [];
            for (const med of globalMeds) {
                const local = await DB.get('medicineMaster', med.id);
                // حماية الصور المحلية (عدم الكتابة فوقها ببيانات فارغة من السحابة)
                if (local && local.imagePath?.startsWith('data:image') && !med.imagePath) {
                    med.imagePath = local.imagePath;
                }
                await DB.put('medicineMaster', med);
            }
            if (window.App?.renderMasterData) window.App.renderMasterData();
        } catch (err) {
            console.warn('Sync Pull: Cloud connection skipped (Permissions/Offline).');
        }
    },

    // رفع صنف للسحابة (للمديرين فقط)
    async push(medId) {
        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) return;

            const syncMed = { ...med, syncStatus: 'global', lastSynced: new Date().toISOString() };
            if (syncMed.imagePath?.startsWith('data:image')) syncMed.imagePath = ''; // منع رفع الصور الضخمة
            
            const docRef = db.doc(this.CLOUD_PATH);
            const doc = await docRef.get();
            let masterData = doc.exists ? (doc.data().masterData || []) : [];

            const idx = masterData.findIndex(m => m.id === med.id);
            if (idx > -1) masterData[idx] = syncMed; else masterData.push(syncMed);

            await docRef.set({ masterData, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            
            med.syncStatus = 'global';
            await DB.put('medicineMaster', med);
        } catch (err) {
            console.warn('Sync Push: Failed (Permissions/Offline).');
        }
    },

    // رادار المأموريات (صامت)
    subscribeToAuditRadar(callback) {
        return db.collection('audits')
            .where('active', '==', true)
            .onSnapshot(snapshot => {
                const audits = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                callback(audits);
            }, err => {
                console.warn('Radar Silent Error: Firebase permissions restricted.');
            });
    },

    // دفع مدخلات الجرد للسحابة
    async pushInventoryEntry(entry) {
        try {
            const col = entry.auditId ? 'inventory_sync' : 'global_inventory';
            await db.collection(col).add({
                ...entry,
                cloud_timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn(`Sync Entry: Cloud mirror failed for ${entry.id}.`);
        }
    },

    // سحب المخزون العالمي المحدث
    async pullGlobalInventory() {
        try {
            const snapshot = await db.collection('global_inventory').limit(100).get();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                const exists = await DB.get('inventory', data.id);
                if (!exists) await DB.put('inventory', data);
            }
        } catch (err) {
            console.warn('Sync Global Pull: Permissions restricted.');
        }
    }
};

window.Sync = Sync;
