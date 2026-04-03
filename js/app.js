import { DB } from './core/db.js';
import { UI } from './core/ui.js';
import { Inventory } from './features/inventory.js';
import { Categories } from './features/categories.js';
import { Audit } from './features/audit.js';
import { Exporter } from './features/export.js';
import { Utils } from './core/utils.js';
import { Sync } from './core/sync.js';
import { auth, db } from './core/firebase-config.js';

/**
 * دواء - نظام إدارة جرد الأدوية (v16.0.7 Emergency Bridge)
 * نسخة "الجسر الفوري" لإعادة الروح للأزرار وتجاوز تعليق النظام.
 */

const App = {
    VERSION: '16.0.7',
    activeAudit: null,
    radarAudits: [],

    async init() {
        console.log(`Dawaa v${this.VERSION}: Emergency Bridge Booting...`);
        window.App = App;
        window.UI = UI;
        window.Exporter = Exporter;
        window.Inventory = Inventory;

        // 🛡️ الخطوة 0: تهيئة الواجهة فوراً لتعمل الأزرار والملاحة بدون انتظار
        UI.init();
        
        // 🛡️ الخطوة 1: بدء القاعدة بشكل متوازي (لا تعطل الواجهة)
        DB.init().then(() => {
            console.log("App: Database stabilized.");
            this.renderDashboard();
        }).catch(err => console.warn("DB Delay:", err));

        // ربط رادار المأموريات (صامت)
        Sync.subscribeToAuditRadar((audits) => {
            this.radarAudits = audits;
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
        });

        Inventory.subscribe(() => {
            this.renderDashboard();
            this.updateHubNotifications();
        });

        await Categories.seedInitialData().catch(() => {});
        
        auth.onAuthStateChanged(async (user) => {
            if (user) await this.handleUserSession(user);
            else this.showLogin();
        });

        this.initServiceWorker();
    },

    initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('./sw.js?v=16.0.7');
    },

    async handleUserSession(user) {
        try {
            this.userName = user.displayName || user.email.split('@')[0];
            const nameEl = document.getElementById('display-user-name');
            if (nameEl) nameEl.textContent = this.userName;
            
            this.hideLogin();
            await this.renderDashboard();
            this.updateHubNotifications();
            
            this.setSyncStatus('syncing');
            Sync.pull().then(() => this.setSyncStatus('online'))
                   .catch(() => this.setSyncStatus('offline'));
        } catch (err) { 
            console.error("Session Error:", err);
            this.hideLogin(); 
        }
    },

    setSyncStatus(status) {
        const indicator = document.getElementById('cloud-sync-indicator');
        if (!indicator) return;
        if (status === 'online') {
            indicator.innerHTML = "<i class='bx bx-cloud'></i>";
            indicator.className = "sync-indicator online";
        } else if (status === 'syncing') {
            indicator.innerHTML = "<i class='bx bx-sync bx-spin'></i>";
            indicator.className = "sync-indicator syncing";
        } else {
            indicator.innerHTML = "<i class='bx bx-cloud-off'></i>";
            indicator.className = "sync-indicator offline";
        }
    },

    async renderDashboard() {
        const meds = await DB.getAll('medicineMaster').catch(() => []);
        const inventory = await DB.getAll('inventory').catch(() => []);
        
        const now = new Date();
        const sixMonthsOut = new Date(new Date().setMonth(now.getMonth() + 6));
        
        const totalMaster = meds.length;
        const lowStockCount = inventory.filter(i => i.quantity <= 5).length;
        const expiringCount = inventory.filter(i => (i.expiryDate && new Date(i.expiryDate) < sixMonthsOut)).length;

        UI.updateDashboardStats({
            totalItems: totalMaster,
            lowStockCount: lowStockCount,
            expiringCount: expiringCount
        });
    },

    showLogin() { UI.switchView('view-login'); },
    hideLogin() { UI.switchView('view-dashboard'); },

    async handleAuthSubmit() {
        const name = document.getElementById('auth-name').value;
        const id = document.getElementById('auth-email').value;
        if (!name || !id) return;

        UI.showToast('جاري التحقق... 🛰️', 'info');
        try {
            await auth.signInAnonymously();
            this.userName = name;
            this.hideLogin();
        } catch (err) {
            this.userName = name;
            this.hideLogin();
        }
    },

    async forceUpdateSystem() {
        if (!confirm('🚨 سيتم مسح الذاكرة وتحديث النظام. هل أنت متأكد؟')) return;
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) await reg.unregister();
        const cachesKeys = await caches.keys();
        await Promise.all(cachesKeys.map(k => caches.delete(k)));
        window.location.reload(true);
    },

    async openQuickAdd() {
        UI.showModal(`
            <div class="quick-add-form">
                <h3>إضافة حركة سريعة 📦</h3>
                <div class="form-group">
                    <label>ابحث عن الصنف</label>
                    <input type="text" id="qa-search" class="form-input" placeholder="اسم الدواء أو الباركود..." oninput="window.App.handleGlobalSearch(this.value, 'qa-results')">
                </div>
                <div id="qa-results" class="results-list results-modal"></div>
            </div>
        `);
    },

    async handleGlobalSearch(q, targetId = 'quick-search-results') {
        const results = document.getElementById(targetId);
        if (!q || q.length < 2) { results.innerHTML = ''; return; }
        
        const meds = await DB.getAll('medicineMaster').catch(() => []);
        const filtered = meds.filter(m => 
            m.nameEN.toLowerCase().includes(q.toLowerCase()) || 
            (m.nameAR && m.nameAR.includes(q)) ||
            m.id.includes(q)
        ).slice(0, 5);

        results.innerHTML = filtered.map(m => `
            <div class="search-item" onclick="window.App.openMedicineDetails('${m.id}')">
                <i class='bx bx-capsule'></i>
                <div class="search-item-info">
                    <span class="name">${m.nameAR || m.nameEN}</span>
                    <span class="id">#${m.id}</span>
                </div>
            </div>
        `).join('');
    },

    async openMedicineDetails(id) {
        UI.closeModal();
        const med = await DB.get('medicineMaster', id).catch(() => null);
        if (!med) return;

        UI.showModal(`
            <div class="med-details-v16">
                <div class="med-header">
                    <i class='bx bxs-capsule icon-large'></i>
                    <h3>${med.nameAR || med.nameEN}</h3>
                    <p class="text-muted">#${med.id}</p>
                </div>
                <div class="action-grid mt-30">
                    <button class="btn-primary" onclick="window.App.addInventoryAction('${med.id}', 'add')">
                        <i class='bx bx-plus'></i> إضافة رصيد
                    </button>
                    <button class="btn-outline-danger" onclick="window.App.addInventoryAction('${med.id}', 'remove')">
                        <i class='bx bx-minus'></i> سحب رصيد
                    </button>
                </div>
            </div>
        `);
    },

    async addInventoryAction(medId, type) {
        const qty = prompt(`الكمية:`, "1");
        if (!qty || isNaN(qty)) return;

        const entry = {
            id: Utils.generateId(),
            medicineId: medId,
            quantity: type === 'add' ? parseInt(qty) : -parseInt(qty),
            date: new Date().toISOString()
        };

        await DB.put('inventory', entry).catch(() => {});
        UI.showToast('تم بنجاح ✅', 'success');
        UI.closeModal();
        this.renderDashboard();
    },

    async handleLogout() {
        if (!confirm('هل تريد تسجيل الخروج؟')) return;
        await auth.signOut();
        window.location.reload();
    }
};

window.handleSearch = (q) => App.handleGlobalSearch(q);
App.init();
