import { DB } from './db.js';
import { db, auth } from './firebase-config.js';

/**
 * دواء - محرك المزامنة المتطور (v17.0.0 Real-time Cloud)
 * يوفر مزامنة لحظية مع عزل بيانات لكل مستخدم وتأمين متكامل.
 */

export const Sync = {
    STORES: {
        MASTER: 'medicine_master',
        INVENTORY: 'inventory_sync',
        AUDITS: 'audits'
    },

    /**
     * الحصول على المسار الخاص بالمستخدم الحالي لتأمين البيانات
     */
    getUserPath() {
        const user = auth.currentUser;
        if (!user) return null;
        return `users/${user.uid}`;
    },

    // سحب بيانات الأدوية العالمية (من مجموعة مشتركة)
    async pullMasterData() {
        try {
            const snapshot = await db.collection(this.STORES.MASTER).get();
            for (const doc of snapshot.docs) {
                const med = { id: doc.id, ...doc.data() };
                const local = await DB.get('medicineMaster', med.id);
                
                // حماية الصور المحلية من المسح إذا لم تتوفر في السحابة
                if (local && local.imagePath?.startsWith('data:image') && !med.imagePath) {
                    med.imagePath = local.imagePath;
                }
                await DB.put('medicineMaster', med);
            }
            console.log('Sync Master: Pull Complete.');
            if (window.App?.renderDashboard) window.App.renderDashboard();
        } catch (err) {
            console.warn('Sync Master Pull: Failed (Permissions/Offline).');
        }
    },

    // رفع صنف للسحابة (للمديرين فقط)
    async pushMasterItem(medId) {
        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) return;

            const syncMed = { 
                ...med, 
                syncStatus: 'global', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            };
            
            // منع رفع الصور القاعدية الضخمة (يُنصح باستخدام Storage)
            if (syncMed.imagePath?.startsWith('data:image')) syncMed.imagePath = ''; 

            await db.collection(this.STORES.MASTER).doc(medId).set(syncMed, { merge: true });
            
            med.syncStatus = 'global';
            await DB.put('medicineMaster', med);
        } catch (err) {
            console.error('Sync Master Push Failed:', err);
        }
    },

    // مرآة السحاب للمخزون (تحت معرف المستخدم)
    async pushInventoryEntry(entry) {
        const path = this.getUserPath();
        if (!path) return;

        try {
            await db.doc(path).collection(this.STORES.INVENTORY).doc(entry.id).set({
                ...entry,
                cloud_updated: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn(`Sync Entry Failed: ${entry.id}`);
        }
    },

    /**
     * حذف صيانة من السحابة عند مسحها محلياً
     */
    async deleteInventoryEntry(id) {
        const path = this.getUserPath();
        if (!path) return;

        try {
            await db.doc(path).collection(this.STORES.INVENTORY).doc(id).delete();
        } catch (err) {
            console.warn(`Sync Delete Failed: ${id}`);
        }
    },

    // سحب المخزون الخاص بالمستخدم (مرة واحدة عند البدء)
    async pullUserInventory() {
        const path = this.getUserPath();
        if (!path) return;

        try {
            const snapshot = await db.doc(path).collection(this.STORES.INVENTORY).get();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                await DB.put('inventory', data);
            }
        } catch (err) {
            console.warn('Sync Inventory Pull: Failed.');
        }
    },

    /**
     * الاستماع اللحظي للتغييرات السحابية
     */
    initListeners(onUpdate) {
        const path = this.getUserPath();
        if (!path) return null;

        // مراقبة المخزون الخاص
        return db.doc(path).collection(this.STORES.INVENTORY)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(async change => {
                    if (change.type === 'added' || change.type === 'modified') {
                        await DB.put('inventory', change.doc.data());
                    } else if (change.type === 'removed') {
                        await DB.delete('inventory', change.doc.id);
                    }
                });
                if (onUpdate) onUpdate();
            }, err => console.warn('Sync Listener: Restricted.'));
    }
};

window.Sync = Sync;
