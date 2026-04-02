import { DB } from './core/db.js';
import { UI } from './core/ui.js';
import { Inventory } from './features/inventory.js';
import { Categories } from './features/categories.js';
import { Audit } from './features/audit.js';
import { Exporter } from './features/export.js';
import { Utils } from './core/utils.js';
import { Sync } from './core/sync.js';
import { auth, db, storage } from './core/firebase-config.js';

/**
 * Dawaa App Orchestrator (v16.0.0 - Sovereign Radar)
 */

const App = {
    VERSION: '16.0.1',
    activeAudit: null, 
    inventoryUnsubscribe: null,
    isJoined: false,   
    selectedCategoryId: null, 
    radarAudits: [],

    async init() {
        console.log(`Dawaa v${this.VERSION}: Initializing Supreme Engine...`);
        window.App = App;
        window.UI = UI;

        await DB.init();
        
        // v16.0.0: Global Operations Radar (Sovereign Scan)
        Sync.subscribeToAuditRadar((audits) => {
            this.radarAudits = audits;
            
            // Auto-Sync Current Mission
            if (this.activeAudit) {
                const refreshed = audits.find(a => a.id === this.activeAudit.id);
                if (refreshed) this.updateAuditSession(refreshed);
                else {
                    this.activeAudit = null;
                    if (this.inventoryUnsubscribe) {
                        this.inventoryUnsubscribe();
                        this.inventoryUnsubscribe = null;
                    }
                }
            }
            
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
            this.renderActiveAuditCard();
        });

        Inventory.subscribe(() => {
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
        });

        await Categories.seedInitialData();
        UI.init();
        
        auth.onAuthStateChanged(async (user) => {
            if (user) await this.handleUserSession(user);
            else this.showLogin();
        });

        window.onpopstate = (event) => {
            if (event.state && event.state.viewId) UI.switchView(event.state.viewId, false);
            else UI.switchView('view-dashboard', false);
        };

        history.replaceState({ viewId: 'view-dashboard' }, "", "#dashboard");
        this.initServiceWorker();
    },

    initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('./sw.js').then(reg => {
            this.swRegistration = reg;
        });
        
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    },

    async handleUserSession(user) {
        try {
            let profileDoc = await db.collection('users').doc(user.uid).get();
            if (!profileDoc.exists) {
                const role = (await db.collection('users').get()).size === 0 ? 'admin' : 'staff';
                const profile = { uid: user.uid, email: user.email, displayName: user.email.split('@')[0], role };
                await db.collection('users').doc(user.uid).set(profile);
                profileDoc = await db.collection('users').doc(user.uid).get();
            }
            this.user = profileDoc.data();
            this.userRole = this.user.role;
            document.getElementById('display-user-name').textContent = this.user.displayName || this.user.email;
            
            this.hideLogin();
            await this.renderDashboard();
            this.updateAdminUI();
            this.updateHubNotifications(); // v16.0.1
            Sync.pull();
        } catch (err) { console.error("Session Error:", err); }
    },

    async renderDashboard() {
        const items = await DB.getAll('inventory');
        const total = items.length || 0;
        
        // v16.0.1: Focus Stats logic
        const lowStock = items.filter(i => i.quantity <= 5).length;
        const now = new Date();
        const sixMonthsOut = new Date(new Date().setMonth(now.getMonth() + 6));
        const expiring = items.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMonthsOut).length;

        document.getElementById('stat-total-items').textContent = total;
        document.getElementById('stat-low-stock').textContent = lowStock;
        document.getElementById('stat-expiring-items').textContent = expiring;
        
        this.renderActiveAuditCard();
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
            badge.textContent = totalNotifs;
            badge.classList.remove('admin-hidden');
            
            list.innerHTML = [
                ...lowStock.map(p => `
                    <div class="hub-notif-item danger">
                        <div class="hub-notif-icon danger"><i class='bx bx-error'></i></div>
                        <div class="hub-notif-text">
                            <strong>رصيد منخفض: ${masterMap.get(p.medicineId)?.nameAR || 'صنف غير معروف'}</strong>
                            <span>الكمية المتبقية: ${p.quantity} وحدة فقط</span>
                        </div>
                    </div>
                `),
                ...expiring.map(p => `
                    <div class="hub-notif-item warning">
                        <div class="hub-notif-icon warning"><i class='bx bx-time'></i></div>
                        <div class="hub-notif-text">
                            <strong>صلاحية قريبة: ${masterMap.get(p.medicineId)?.nameAR || 'صنف غير معروف'}</strong>
                            <span>تنتهي في: ${p.expiryDate}</span>
                        </div>
                    </div>
                `)
            ].join('');
        } else {
            badge.classList.add('admin-hidden');
            list.innerHTML = '<p class="text-center text-muted p-20">لا توجد تنبيهات حالياً ✅</p>';
        }
    },

    toggleHubNotifications() {
        const center = document.querySelector('.notifications-center');
        center.classList.toggle('open');
        document.getElementById('hub-notif-list').classList.toggle('admin-hidden');
    },

    showLogin() { 
        const loginView = document.getElementById('view-login');
        if (loginView) loginView.style.display = 'flex';
    },
    hideLogin() { 
        const loginView = document.getElementById('view-login');
        if (loginView) loginView.style.display = 'none';
    },
    
    updateAdminUI() {
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(el => el.style.display = this.userRole === 'admin' ? 'block' : 'none');
    },

    // --- Core UI Logic ---
    async renderDashboard() {
        const inventory = await DB.getAll('inventory');
        const sixMonths = new Date();
        sixMonths.setMonth(sixMonths.getMonth() + 6);
        UI.updateDashboardStats({
            totalItems: inventory.length,
            lowStockCount: inventory.filter(i => i.quantity <= 5).length,
            expiringCount: inventory.filter(i => i.expiryDate && new Date(i.expiryDate) <= sixMonths).length
        });
    },

    async renderInventory(type = 'detailed') {
        const container = document.getElementById('inventory-list');
        if (!container) return;
        this.renderCategoryChips();
        let data = await DB.getAll('inventory');
        if (type === 'expiry') {
            const sixMonths = new Date();
            sixMonths.setMonth(sixMonths.getMonth() + 6);
            data = data.filter(i => i.expiryDate && new Date(i.expiryDate) <= sixMonths);
        } else if (type === 'low-stock') {
            data = (await Inventory.getAggregatedStock()).filter(i => i.totalQuantity <= 5);
        }
        this.renderInventoryList(data, 'inventory-items-list', type === 'low-stock');
    },

    async renderCategoryChips() {
        const container = document.getElementById('category-chips');
        if (!container) return;
        const cats = await Categories.getAllSorted();
        container.innerHTML = `
            <div class="category-chip ${!this.selectedCategoryId ? 'active' : ''}" onclick="window.App.filterByCategory(null)">الكل</div>
            ${cats.map(c => `<div class="category-chip ${this.selectedCategoryId === c.id ? 'active' : ''}" onclick="window.App.filterByCategory('${c.id}')">${c.nameAR}</div>`).join('')}
        `;
    },

    filterByCategory(catId) {
        this.selectedCategoryId = catId;
        this.renderInventory();
    },

    async renderInventoryList(items, containerId, isAggregated = false) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (items.length === 0) {
            container.innerHTML = UI.renderEmptyState('لا توجد سجلات حالياً 📦');
            return;
        }
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));
        container.innerHTML = items.map(item => Inventory.renderCard(item, isAggregated ? item : masterMap.get(item.medicineId), isAggregated)).join('');
    },

    // --- Audit & Operations Radar ---
    updateAuditSession(session) {
        if (session && (!this.activeAudit || this.activeAudit.id !== session.id)) {
            if (this.inventoryUnsubscribe) this.inventoryUnsubscribe();
            this.inventoryUnsubscribe = Sync.subscribeToInventory(session.id, () => Inventory.notify());
        }
        this.activeAudit = session;
        const banner = document.getElementById('audit-banner');
        if (banner) {
            if (session) {
                banner.innerHTML = `
                    <div class="audit-info">
                        <i class='bx bxs-megaphone bx-tada'></i>
                        <span>جاري الجرد الجماعي: <strong>${session.name}</strong></span>
                    </div>
                    <div class="audit-actions">
                        ${!this.isJoined ? `<button class="sm-btn btn-primary" onclick="window.App.joinRadarAudit('${session.id}')">انضمام</button>` : ''}
                        ${this.userRole === 'admin' ? `<button class="sm-btn btn-glass" onclick="window.App.closeAudit()">إنهاء</button>` : ''}
                    </div>
                `;
                banner.classList.add('active');
            } else {
                banner.classList.remove('active');
            }
        }
        this.renderActiveAuditCard();
        if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
    },

    renderActiveAuditCard(session = this.activeAudit) {
        const container = document.getElementById('active-audit-container');
        if (!container) return;
        
        if (session) {
            container.innerHTML = `
                <div class="audit-status-card animate-fade-in" onclick="window.App.openAuditHub()">
                    <div class="pulse-dot"></div>
                    <div class="audit-details">
                        <h4>مشاركة جارية: ${session.name}</h4>
                        <p>✅ أنت جزء من فريق العمل الآن</p>
                    </div>
                </div>
            `;
        } else if (this.radarAudits && this.radarAudits.length > 0) {
            const count = this.radarAudits.length;
            container.innerHTML = `
                <div class="radar-alert-card animate-shimmer" onclick="window.App.openAuditHub()">
                    <div class="radar-ping"><i class='bx bx-broadcast'></i></div>
                    <div class="radar-alert-info">
                        <h4>تم رصد ${count} عملية جرد نشطة! 🛰️</h4>
                        <p>اضغط للانضمام لزملائك في الميدان</p>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '';
        }
    },

    openAuditHub() {
        UI.switchView('view-audit-hub');
        this.renderAuditHub();
    },

    async renderAuditHub() {
        const container = document.getElementById('hub-session-content');
        if (!container) return;
        const session = this.activeAudit;

        if (!session) {
            container.innerHTML = `
                <div class="hub-idle-state text-center mt-30 animate-fade-in">
                    <div class="command-orb"><i class='bx bx-station bx-tada'></i></div>
                    <h2 class="premium-title">Operations Radar</h2>
                    <p class="text-muted mb-25">جاري مسح ترددات الصيدلية بحثاً عن أي مهمات نشطة...</p>
                    
                    <div class="radar-scan-container">
                        ${this.radarAudits.length > 0 ? `
                            <div class="radar-results-grid">
                                ${this.radarAudits.map(a => `
                                    <div class="radar-tactical-card" onclick="window.App.joinRadarAudit('${a.id}')">
                                        <div class="radar-status-dot pulse-success"></div>
                                        <div class="radar-tactical-info">
                                            <strong>مهمة: ${a.name}</strong>
                                            <span>القائد: ${a.host} • 👥 ${a.participants ? a.participants.length : 0}</span>
                                        </div>
                                        <i class='bx bx-chevron-left'></i>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <div class="radar-empty-state">
                                <div class="radar-waves"><div></div><div></div><div></div></div>
                                <p>لا توجد عمليات جرد جماعي حالياً</p>
                            </div>
                        `}
                    </div>
                    
                    ${this.userRole === 'admin' ? `
                        <button class="commander-btn-primary mt-30" onclick="window.App.startAudit('team')">
                            <i class='bx bx-broadcast'></i>
                            <span>فتح بث لمهمة جديدة</span>
                        </button>
                    ` : ''}
                </div>
            `;
        } else {
            const stats = await Audit.getSessionStats(session.id);
            container.innerHTML = `
                <div class="hub-mission-control animate-scale-up">
                    <div class="mission-header-card">
                        <span class="mission-type-badge">${session.type === 'team' ? 'جرد مشترك' : 'جرد فردي'}</span>
                        <h1>${session.name}</h1>
                        <p>بواسطة: ${session.host}</p>
                    </div>

                    <div class="stats-grid-tactical mt-20">
                        <div class="stat-glass-card">
                            <span class="label">إجمالي الوحدات</span>
                            <span class="value">${stats.totalUnits}</span>
                        </div>
                        <div class="stat-glass-card">
                            <span class="label">الأصناف المكتشفة</span>
                            <span class="value">${stats.uniqueCount}</span>
                        </div>
                    </div>

                    <div class="participants-section mt-25">
                        <h3 class="section-title">المشاركون الآن 👥</h3>
                        <div class="participants-chips">
                            ${(session.participants || []).map(p => `
                                <div class="p-tactical-chip">
                                    <div class="p-avatar">${p.charAt(0).toUpperCase()}</div>
                                    <span>${p}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="action-dock mt-30">
                        <button class="dock-btn primary" onclick="window.UI.switchView('view-smart-inventory')">
                            <i class='bx bx-rocket'></i>
                            <span>دخول الميدان</span>
                        </button>
                        ${this.userRole === 'admin' ? `
                            <button class="dock-btn glass danger" onclick="window.App.closeAudit()">
                                <i class='bx bx-power-off'></i>
                                <span>إنهاء المهمة</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }
    },

    // --- Master Data & Inventory Ops ---
    async saveEntry(medicineId) {
        try {
            const qty = parseFloat(document.getElementById('entry-qty').value);
            const entryData = {
                medicineId,
                location: document.getElementById('entry-location-main').value,
                quantity: qty,
                expiryDate: document.getElementById('entry-expiry').value,
                auditId: this.activeAudit?.id
            };
            await Inventory.addEntry(entryData);
            UI.showToast('تم الحفظ بنجاح ✅', 'success');
            UI.closeModal();
            this.renderInventory();
        } catch (err) { UI.showToast('فشل الحفظ', 'danger'); }
    },

    async startAudit(mode) {
        const session = await Audit.start(mode, this.user);
        if (session) {
            this.activeAudit = session;
            this.isJoined = true;
            this.updateAuditSession(session);
        }
    },

    async closeAudit() {
        if (await Audit.end()) UI.showToast('تم الإنهاء ✅', 'success');
    },

    async joinRadarAudit(auditId) {
        if (await Audit.join(auditId, this.user)) {
            this.isJoined = true;
            UI.showToast('تم الانضمام للجلسة! 👥✨', 'success');
        }
    },

    // --- Search ---
    async handleGlobalSearch(query) {
        if (!query) return this.renderInventory();
        const master = await DB.getAll('medicineMaster');
        const results = master.filter(m => m.nameEN.toLowerCase().includes(query.toLowerCase()) || m.nameAR.includes(query));
        this.renderSearchResults(results);
    },

    renderSearchResults(results) {
        const container = document.getElementById('inventory-items-list');
        if (!container) return;
        container.innerHTML = results.map(m => `
            <div class="inventory-card" onclick="window.App.openEntryForm('${m.id}')">
                <h3>${m.nameEN} / ${m.nameAR || ''}</h3>
                <p>اضغط لبدء الجرد</p>
            </div>
        `).join('') || UI.renderEmptyState('لا توجد نتائج 🔍');
    },

    async openEntryForm(medicineId) {
        const med = await DB.get('medicineMaster', medicineId);
        UI.showModal(`
            <h2>جرد: ${med.nameEN}</h2>
            <form onsubmit="event.preventDefault(); window.App.saveEntry('${medicineId}')">
                <select id="entry-location-main" class="form-select"><option>صيدلية</option><option>مخزن</option></select>
                <input type="number" id="entry-qty" class="form-input" placeholder="الكمية" required>
                <input type="month" id="entry-expiry" class="form-input">
                <button type="submit" class="btn-primary mt-20">حفظ</button>
            </form>
        `);
    },

    // --- Master Data Management ---
    openAddMedicine() {
        UI.showModal(`
            <h2>إضافة صنف جديد</h2>
            <form id="add-med-form" onsubmit="event.preventDefault(); window.App.saveMasterMedicine()">
                <div class="form-group">
                    <label>الاسم (English)</label>
                    <input type="text" id="master-name-en" class="form-input" required>
                </div>
                <div class="form-group">
                    <label>الاسم (عربي)</label>
                    <input type="text" id="master-name-ar" class="form-input" required>
                </div>
                <div class="form-group">
                    <label>الباركود / المعرف</label>
                    <input type="text" id="master-id" class="form-input" required>
                </div>
                <button type="submit" class="btn-primary mt-20">حفظ بالخزنة 🔒</button>
            </form>
        `);
    },

    async saveMasterMedicine() {
        const med = {
            id: document.getElementById('master-id').value,
            nameEN: document.getElementById('master-name-en').value,
            nameAR: document.getElementById('master-name-ar').value,
            lastUpdated: new Date().toISOString()
        };
        await DB.put('medicineMaster', med);
        UI.showToast('تم الحفظ بالخزنة بنجاح ✅', 'success');
        UI.closeModal();
        this.renderMasterData();
    },

    async deleteMasterMedicine(id) {
        if (!confirm('🚨 هل أنت متأكد من حذف هذا الصنف نهائياً من المستودع؟')) return;
        await DB.delete('medicineMaster', id);
        UI.showToast('تم الحذف بنجاح ✅', 'success');
        this.renderMasterData();
    },

    openManageCategories() {
        UI.switchView('view-smart-inventory');
    },

    async renderMasterData() {
        const container = document.getElementById('master-items-list');
        if (!container) return;
        const master = await DB.getAll('medicineMaster');
        if (master.length === 0) {
            container.innerHTML = UI.renderEmptyState('لا توجد بيانات أصناف حالياً 📦');
            return;
        }
        container.innerHTML = master.map(m => `
            <div class="inventory-card">
                <div class="card-info">
                    <h3>${m.nameEN} / ${m.nameAR || ''}</h3>
                    <p>${m.id}</p>
                </div>
                <div class="card-actions-float">
                    ${this.userRole === 'admin' ? `
                        <button class="icon-btn sync-btn" onclick="window.Sync.push('${m.id}')" title="نشر عالمي"><i class='bx bx-cloud-upload'></i></button>
                        <button class="icon-btn danger" onclick="window.App.deleteMasterMedicine('${m.id}')"><i class='bx bx-trash'></i></button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    },

    handleLogout() {
        if (!confirm('تسجيل خروج؟')) return;
        auth.signOut();
    },

    async fullReset() {
        if (!confirm('⚠️ مسح كافة البيانات؟ لا يمكن التراجع!')) return;
        await DB.deleteDB();
        window.location.reload();
    },

    async renderCategoriesGrid() {
        const container = document.getElementById('category-grid');
        if (!container) return;
        const cats = await Categories.getAllSorted();
        container.innerHTML = cats.map(c => `
            <div class="category-card" onclick="window.App.openCategory('${c.id}')">
                <i class='bx ${c.icon}'></i>
                <span>${c.nameAR}</span>
            </div>
        `).join('');
    },

    openCategory(catId) {
        this.selectedCategoryId = catId;
        UI.switchView('view-inventory');
        this.renderInventory();
    },

    async forceUpdateSystem() {
        if (!confirm('🚨 سيتم مسح الذاكرة المؤقتة وإعادة تحميل أحدث نسخة من النظام. هل أنت متأكد؟')) return;
        
        UI.showToast('جاري البدء في التحديث القسري... 🛰️', 'info');
        
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let reg of registrations) { await reg.unregister(); }

            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));

            UI.showToast('تم مسح الذاكرة بنجاح. جاري إعادة التحميل... 🛡️', 'success');
            setTimeout(() => { window.location.reload(true); }, 1500);
        } catch (err) {
            UI.showToast('فشل التحديث القسري', 'danger');
        }
    },

    async checkUpdate() {
        const text = document.getElementById('update-status-text');
        if (text) text.textContent = 'جاري البحث عن تحديثات... 🛰️';
        
        if (!('serviceWorker' in navigator)) return;
        
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
            await reg.update();
            if (!reg.waiting && !reg.installing) {
                UI.showToast('أنت تستخدم أحدث نسخة بالفعل ✅', 'success');
                if (text) text.textContent = 'أنت تستخدم أحدث نسخة بالفعل ✅';
            }
        }
    }
};

window.App = App;
window.UI = UI;
window.handleSearch = (q) => App.handleGlobalSearch(q);
window.switchView = (id) => UI.switchView(id.startsWith('view-') ? id : `view-${id}`);

App.init();
