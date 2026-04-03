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
 * دواء - نظام إدارة جرد الأدوية (v16.0.5 Stable)
 * نسخة الجودة القصوى والتناغم البرمجي الشامل.
 */

const App = {
    VERSION: '16.0.5',
    activeAudit: null,
    radarAudits: [],

    async init() {
        console.log(`Dawaa v${this.VERSION}: Total QA Initialization...`);
        window.App = App;
        window.UI = UI;
        window.Exporter = Exporter;
        window.Inventory = Inventory; // For global access

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
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.onupdatefound = () => {
                const newWorker = reg.installing;
                newWorker.onstatechange = () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        UI.showToast('نسخة مستقرة جديدة متاحة! جاري التحديث... 📡', 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    }
                };
            };
        });
    },

    async handleUserSession(user) {
        try {
            this.userName = user.displayName || user.email.split('@')[0];
            document.getElementById('display-user-name').textContent = this.userName;
            
            this.hideLogin();
            await this.renderDashboard();
            this.updateHubNotifications();
            
            // مزامنة صامتة لا تعطل الدخل
            Sync.pull().catch(() => {});
            Sync.pullGlobalInventory().catch(() => {});
        } catch (err) { 
            console.error("Session Error:", err);
            this.hideLogin(); 
        }
    },

    async renderDashboard() {
        const meds = await DB.getAll('medicineMaster');
        const inventory = await DB.getAll('inventory');
        
        const now = new Date();
        const sixMonthsOut = new Date(new Date().setMonth(now.getMonth() + 6));
        
        const totalMaster = meds.length;
        const lowStockCount = inventory.filter(i => i.quantity <= 5).length;
        const expiringCount = inventory.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMonthsOut).length;

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
        if (chevron) chevron.style.transform = list.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
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
        
        const meds = await DB.getAll('medicineMaster');
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
                <i class='bx bx-chevron-left'></i>
            </div>
        `).join('');
    },

    async openMedicineDetails(id) {
        UI.closeModal();
        const med = await DB.get('medicineMaster', id);
        if (!med) return;

        UI.showModal(`
            <div class="med-details-v16">
                <div class="med-header">
                    <i class='bx bxs-capsule icon-large'></i>
                    <h3>${med.nameAR || med.nameEN}</h3>
                    <p class="text-muted">#${med.id}</p>
                </div>
                <div class="inventory-status mt-20">
                    <div class="status-card">
                        <label>الكمية الحالية</label>
                        <span class="value" id="med-detail-qty">جاري التحميل...</span>
                    </div>
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
        
        // Load current qty
        const inv = await DB.getAll('inventory');
        const qty = inv.filter(i => i.medicineId === id).reduce((acc, curr) => acc + curr.quantity, 0);
        document.getElementById('med-detail-qty').textContent = qty;
    },

    async addInventoryAction(id, type) {
        const qty = prompt(`أدخل الكمية المراد ${type === 'add' ? 'إضافتها' : 'سحبها'}:`, "1");
        if (!qty || isNaN(qty)) return;

        const entry = {
            id: Utils.generateId(),
            medicineId: id,
            quantity: type === 'add' ? parseInt(qty) : -parseInt(qty),
            date: new Date().toISOString(),
            status: 'synced'
        };

        await DB.put('inventory', entry);
        UI.showToast('تم تحديث المخزون بنجاح ✅', 'success');
        UI.closeModal();
        this.renderDashboard();
    },

    renderInventory() { UI.switchView('view-inventory'); },
    renderSmartInventory() { UI.switchView('view-smart-inventory'); }
};

window.handleSearch = (q) => App.handleGlobalSearch(q);
App.init();
