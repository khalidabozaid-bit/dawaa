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
 * دواء - نظام إدارة جرد الأدوية (v16.0.4 Stable)
 * نسخة الاستقرار المطلق والاعتماد المحلي الذكي.
 */

const App = {
    VERSION: '16.0.4',
    activeAudit: null,
    inventoryUnsubscribe: null,
    selectedCategoryId: null,
    radarAudits: [],

    async init() {
        console.log(`Dawaa v${this.VERSION}: Initializing Central Engine...`);
        window.App = App;
        window.UI = UI;
        window.Exporter = Exporter;

        await DB.init();
        
        // رادار المأموريات (صامت)
        Sync.subscribeToAuditRadar((audits) => {
            this.radarAudits = audits;
            if (this.activeAudit) {
                const refreshed = audits.find(a => a.id === this.activeAudit.id);
                if (refreshed) this.updateAuditSession(refreshed);
            }
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
        });

        Inventory.subscribe(() => {
            this.renderDashboard();
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
            this.updateHubNotifications();
        });

        await Categories.seedInitialData();
        UI.init();
        
        auth.onAuthStateChanged(async (user) => {
            if (user) await this.handleUserSession(user);
            else this.showLogin();
        });

        this.initServiceWorker();
    },

    initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('./sw.js');
    },

    setSyncStatus(status) {
        const indicator = document.getElementById('cloud-sync-indicator');
        if (!indicator) return;
        if (status === 'online') {
            indicator.innerHTML = "<i class='bx bx-cloud'></i>";
            indicator.className = "sync-indicator online";
            indicator.title = "متصل بالسحابة ✅";
        } else if (status === 'syncing') {
            indicator.innerHTML = "<i class='bx bx-sync bx-spin'></i>";
            indicator.className = "sync-indicator syncing";
            indicator.title = "جاري الحفظ... 📡";
        } else {
            indicator.innerHTML = "<i class='bx bx-cloud-off'></i>";
            indicator.className = "sync-indicator offline";
            indicator.title = "يعمل محلياً (Shield Mode) 🛡️";
        }
    },

    async handleUserSession(user) {
        try {
            this.userName = user.displayName || user.email.split('@')[0];
            document.getElementById('display-user-name').textContent = this.userName;
            
            this.hideLogin();
            await this.renderDashboard();
            this.updateHubNotifications();
            
            this.setSyncStatus('syncing');
            // مزامنة صامتة لا تعطل الدخول
            Sync.pull().then(() => this.setSyncStatus('online'))
                   .catch(() => this.setSyncStatus('offline'));
            Sync.pullGlobalInventory().catch(() => {});
        } catch (err) { 
            console.error("Session Error:", err);
            this.hideLogin(); 
        }
    },

    async renderDashboard() {
        const items = await DB.getAll('inventory');
        const now = new Date();
        const sixMonthsOut = new Date(new Date().setMonth(now.getMonth() + 6));
        
        const total = items.length;
        const lowStock = items.filter(i => i.quantity <= 5).length;
        const expiring = items.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMonthsOut).length;

        const totalEl = document.getElementById('total-meds');
        const lowEl = document.getElementById('low-stock-count');
        const expEl = document.getElementById('expired-count');

        if (totalEl) totalEl.textContent = total;
        if (lowEl) lowEl.textContent = lowStock;
        if (expEl) expEl.textContent = expiring;
    },

    showLogin() { UI.switchView('view-login'); },
    hideLogin() { UI.switchView('view-dashboard'); },

    async handleAuthSubmit() {
        const name = document.getElementById('auth-name').value;
        const id = document.getElementById('auth-email').value;
        if (!name || !id) return;

        UI.showToast('جاري الدخول للنظام... 🛰️', 'info');
        try {
            await auth.signInAnonymously();
            this.userName = name;
            this.hideLogin();
            this.renderDashboard();
        } catch (err) {
            console.warn("Firebase Auth Error: Entering Offline Mode.");
            this.userName = name;
            this.hideLogin();
            this.renderDashboard();
        }
    },

    async updateHubNotifications() {
        const list = document.getElementById('hub-notif-list');
        const badge = document.getElementById('hub-notif-count');
        if (!list) return;

        const items = await DB.getAll('inventory');
        const master = await DB.getAll('medicineMaster');
        const masterMap = new Map(master.map(m => [m.id, m]));

        const now = new Date();
        const sixMonthsOut = new Date(new Date().setMonth(now.getMonth() + 6));
        
        const lowStock = items.filter(i => i.quantity <= 5);
        const expiring = items.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMonthsOut);

        const totalNotifs = lowStock.length + expiring.length;
        
        if (totalNotifs > 0) {
            badge.style.display = 'flex';
            badge.textContent = totalNotifs;
            list.innerHTML = [
                ...lowStock.map(i => {
                    const m = masterMap.get(i.medicineId);
                    return `<div class="hub-item warning">⚠️ رصيد منخفض: ${m ? m.nameAR : 'صنف مجهول'} (${i.quantity})</div>`;
                }),
                ...expiring.map(i => {
                    const m = masterMap.get(i.medicineId);
                    return `<div class="hub-item danger">⌛ يقترب من الانتهاء: ${m ? m.nameAR : 'صنف مجهول'}</div>`;
                })
            ].join('');
        } else {
            badge.style.display = 'none';
            list.innerHTML = '<div class="hub-empty">لا توجد تنبيهات عاجلة ✅</div>';
        }
    },

    toggleHubNotifications() {
        const list = document.getElementById('hub-notif-list');
        const chevron = document.getElementById('notif-chevron');
        list.classList.toggle('active');
        chevron.style.transform = list.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
        if (list.classList.contains('active')) this.updateHubNotifications();
    },

    async forceUpdateSystem() {
        if (!confirm('🚨 سيتم إعادة تحميل أحدث ملفات النظام. هل أنت متأكد؟')) return;
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) await reg.unregister();
        const cachesKeys = await caches.keys();
        await Promise.all(cachesKeys.map(k => caches.delete(k)));
        window.location.reload(true);
    },

    async handleLogout() {
        if (!confirm('هل تريد تسجيل الخروج؟')) return;
        await auth.signOut();
        window.location.reload();
    },

    async openQuickAdd() {
        UI.showModal(`
            <div class="quick-add-form">
                <h3>إضافة حركة سريعة 📦</h3>
                <div class="form-group">
                    <label>ابحث عن الصنف</label>
                    <input type="text" id="qa-search" class="form-input" placeholder="اسم الدواء أو الباركود..." oninput="window.App.handleGlobalSearch(this.value)">
                    <div id="quick-search-results" class="results-list"></div>
                </div>
            </div>
        `);
    },

    async handleGlobalSearch(q) {
        const results = document.getElementById('quick-search-results');
        if (!q || q.length < 2) { results.innerHTML = ''; return; }
        const meds = await DB.getAll('medicineMaster');
        const filtered = meds.filter(m => 
            m.nameEN.toLowerCase().includes(q.toLowerCase()) || 
            (m.nameAR && m.nameAR.includes(q)) ||
            m.id.includes(q)
        ).slice(0, 5);
        results.innerHTML = filtered.map(m => `
            <div class="search-item" onclick="window.App.openMedicineDetails('${m.id}')">
                <i class='bx bx-capsule'></i>
                <span>${m.nameAR || m.nameEN}</span>
            </div>
        `).join('');
    }
};

window.handleSearch = (q) => App.handleGlobalSearch(q);
App.init();
