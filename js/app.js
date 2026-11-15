import { DB } from './core/db.js';
import { UI } from './core/ui.js';
import { Inventory } from './features/inventory.js';
import { Categories } from './features/categories.js';
import { Locations } from './features/locations.js';
import { Audit } from './features/audit.js';
import { Users } from './features/users.js';
import { EgyptianDrugs } from './core/egyptian_drugs.js';
window.Users = Users;
window.EgyptianDrugs = EgyptianDrugs;
import { Exporter } from './features/export.js';
import { Utils } from './core/utils.js';
import { Sync } from './core/sync.js';
import { TaskManager } from './features/tasks.js';
import { auth, db, storage } from './core/firebase-config.js';
import { Recovery } from './recovery.js';

// Immediate Global Bindings to prevent undefined calls during boot
window.UI = UI;
window.Locations = Locations;
window.Audit = Audit;
window.Categories = Categories;
window.Inventory = Inventory;
window.Users = Users;
window.DB = DB;
window.db = db;
window.auth = auth;
window.storage = storage;

/**
 * Dawaa App Orchestrator (v17.2.0 - Sovereign Reset)
 * Cache-Busting Service Worker Logic Enabled.
 */

const App = {
    VERSION: '18.6.2', // Universal Sovereign v18.6.2
    activeAudit: null, 
    inventoryUnsubscribe: null, // v14.0.0 Sync Handle
    isJoined: false,   
    selectedCategoryId: null, 
    notifications: [],
    unreadCount: 0,

    /**
     * Image Upload Helper for Cloud Storage (v9.8.0)
     */
    async uploadImage(file, medId) {
        if (!file) return null;
        try {
            const storageRef = storage.ref(`medicine_images/${medId}_${Date.now()}.jpg`);
            const snapshot = await storageRef.put(file);
            return await snapshot.ref.getDownloadURL();
        } catch (err) {
            console.error('Storage Upload Error:', err);
            return null;
        }
    },

    /**
     * Offline Guard & Network Monitor (v17.2.0)
     */
    initNetworkMonitor() {
        const updateNetworkUI = (isOnline) => {
            const badge = document.getElementById('network-status');
            if (badge) {
                badge.className = `network-status-badge ${isOnline ? 'online' : 'offline'}`;
                badge.innerHTML = `<i class='bx ${isOnline ? 'bx-wifi' : 'bx-wifi-off'}'></i>`;
                badge.title = isOnline ? 'متصل بالسحابة 🟢' : 'وضع عدم الاتصال (حفظ محلي) 🔴';
            }
        };

        window.addEventListener('online', async () => {
            updateNetworkUI(true);
            if (window.UI) UI.showToast('تم استعادة الاتصال بالإنترنت 🌐 جاري مزامنة التغييرات المعلقة...', 'success');
            try {
                const { SyncV2 } = await import('./core/sync_v2.js');
                if (SyncV2 && typeof SyncV2.pushLocalChanges === 'function') {
                    await SyncV2.pushLocalChanges();
                }
            } catch (err) {
                console.warn('Auto-sync on reconnect warning:', err);
            }
        });

        window.addEventListener('offline', () => {
            updateNetworkUI(false);
            if (window.UI) UI.showToast('أنت الآن في وضع عدم الاتصال (Offline) 📡 يتم حفظ كافة البيانات محلياً', 'warning');
        });

        updateNetworkUI(navigator.onLine);
    },

    async init() {
        console.log(`Dawaa v${this.VERSION}: Initializing Supreme Engine...`);
        try {
            console.log("BOOT: [STEP 1] Setting Globals");
            window.App = App;
            window.UI = UI;
            const verEl = document.getElementById('app-version-tag');
            if (verEl) verEl.textContent = `v${this.VERSION}`;

            if (localStorage.getItem('dawaa_recovery_mode') === 'true') {
                return await this.initUIOnly();
            }

            console.log("BOOT: [STEP 2] DB Init");
            await DB.init();
            
            console.log("BOOT: [STEP 3] Sync Init");
            try {
                if (typeof Sync?.subscribeToAudit === 'function') {
                    Sync.subscribeToAudit((session) => {
                        this.updateAuditSession(session);
                    });
                }
            } catch (syncErr) {
                console.warn("Sync Init Non-blocking Notice:", syncErr);
            }

            console.log("BOOT: [STEP 4] Inventory Init");
            try {
                if (typeof Inventory?.subscribe === 'function') {
                    Inventory.subscribe(() => {
                        const currentView = UI.currentView;
                        if (currentView === 'audit-hub') {
                            this.renderAuditHub();
                            this.renderStructuredSessions();
                        }
                    });
                }
            } catch (invErr) {
                console.warn("Inventory Init Non-blocking Notice:", invErr);
            }

            console.log("BOOT: [STEP 5] Data Seeding & User Init");
            Users.init();
            const activeUser = Users.getActive();
            this.currentUser = activeUser;
            this.userRole = activeUser.role;
            this.userName = activeUser.name;
            this.user = { uid: activeUser.id, displayName: activeUser.name, role: activeUser.role };
            const nameEl = document.getElementById('display-user-name');
            if (nameEl) nameEl.textContent = activeUser.name;

            await Categories.seedInitialData();
            await Locations.init();
            await Audit.init();

            console.log("BOOT: [STEP 6] UI/TaskManager Init");
            UI.init();
            TaskManager.init();
            this.initNetworkMonitor();
            this.registerServiceWorker();

            console.log("BOOT: [STEP 7] Firebase Auth Monitor");
            auth.onAuthStateChanged(async (user) => {
                console.log('Auth: Auth State Change Event. User:', user ? { uid: user.uid, email: user.email } : 'None');
                
                if (user) {
                    if (!user.email || !user.uid) {
                        console.error('CRITICAL: Corrupted Auth object detected. Forcing signOut.');
                        await auth.signOut();
                        this.showLogin();
                        return;
                    }
                    await this.handleUserSession(user);
                } else {
                    console.log('Auth: No session found.');
                    this.showLogin();
                }
            });

            window.onpopstate = (event) => {
                const container = document.getElementById('modal-container');
                if (container && container.classList.contains('show')) {
                    UI.closeModal();
                    history.pushState(event.state, "", window.location.hash);
                    return;
                }
                if (event.state && event.state.viewId) {
                    UI.switchView(event.state.viewId, false);
                } else {
                    UI.switchView('view-dashboard', false);
                }
            };

            history.replaceState({ viewId: 'view-dashboard' }, "", "#dashboard");
            this.initServiceWorker();
            console.log("BOOT: [COMPLETE] Engine Running.");

        } catch (e) {
            console.error("CRITICAL BOOT FAILURE DETECTED:", e);
            console.log("Switching to EMERGENCY RECOVERY MODE...");
            await this.initUIOnly();
        }
    },

    async initUIOnly() {
        console.warn("RECOVERY: Starting Minimal UI Boot...");
        window.App = App;
        window.UI = UI;

        try {
            UI.init();
            UI.switchView('view-dashboard');
            this.user = { displayName: 'Recovery User', role: 'staff' };
            const nameEl = document.getElementById('display-user-name');
            if (nameEl) nameEl.textContent = 'نظام الاستعادة';
            this.hideLogin();
            this.attachRecoveryListeners();
            console.log("RECOVERY: [STEP 1] UI Rendered");
            this.renderDashboard();
            console.log("RECOVERY: [COMPLETE] System interactive in Safe Mode.");
            UI.showToast('النظام يعمل في وضع الاستعادة (Safe Mode) 🛡️', 'warning');
        } catch (err) {
            console.error("RECOVERY FAILED:", err);
            document.body.innerHTML = `<div style="padding: 50px; text-align: center; font-family: sans-serif;"><h1 style="color: red;">خطأ فادح في النظام</h1><p>فشل وضع الاستعادة أيضاً. يرجى مسح بيانات المتصفح.</p><button onclick="localStorage.clear(); location.reload();" style="padding: 10px 20px; background: red; color: white; border: none; border-radius: 5px;">مسح كافة البيانات وإعادة المحاولة</button></div>`;
        }
    },

    attachRecoveryListeners() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            const target = btn.dataset.target;
            btn.onclick = () => {
                console.log(`RECOVERY: Nav to ${target}`);
                UI.switchView(`view-${target}`);
                if (target === 'dashboard') this.renderDashboard();
                if (target === 'smart-inventory') this.renderSmartInventory();
            };
        });
        const profileBtn = document.querySelector('.user-profile');
        if (profileBtn) profileBtn.onclick = () => UI.switchView('view-settings');
    },

    initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('SW: Registered.');
            this.swRegistration = reg;
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('SW: Update available (Digital Silence).');
                    }
                });
            });
        });
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    },

    /**
     * The Double-Tap Update Protocol (v9.8.5)
     */
    async checkUpdate() {
        const btn = document.querySelector('.setting-card[onclick*="checkUpdate"]');
        const statusText = document.getElementById('update-status-text');
        const title = btn?.querySelector('h3');

        // Check if we are in Step 2 (Update Found)
        if (this.swRegistration && this.swRegistration.waiting) {
            UI.showToast('جاري تثبيت التحديث... يرجى الانتظار 🔄', 'info');
            this.applyUpdate();
            return;
        }

        // Step 1: Check for Updates
        if (statusText) statusText.textContent = 'جاري البحث عن إصدارات جديدة... 🔍';
        if (title) title.textContent = 'جاري الفحص...';
        
        try {
            if (this.swRegistration) {
                await this.swRegistration.update();
                
                // Allow some time for SW to detect
                setTimeout(() => {
                    if (this.swRegistration.waiting) {
                        if (statusText) statusText.textContent = 'تم العثور على إصدار جديد! اضغط مرة أخرى للتثبيت ⚡';
                        if (title) title.textContent = 'تثبيت التحديث الآن';
                        if (btn) btn.classList.add('info-accent'); // Highlight
                        UI.showToast('يوجد تحديث جاهز للتثبيت ✨', 'success');
                    } else {
                        if (statusText) statusText.textContent = 'أنت تستخدم أحدث إصدار من دواء ✅';
                        if (title) title.textContent = 'النظام محدث';
                        UI.showToast('نظامك محدث بالكامل ✅', 'success');
                    }
                }, 1500);
            }
        } catch (err) {
            console.error('Update Check Fail:', err);
            UI.showToast('فشل التحقق من التحديث', 'danger');
        }
    },

    applyUpdate() {
        // Send command to the waiting OR installing worker
        const worker = this.swRegistration?.waiting || this.swRegistration?.installing;
        if (worker) {
            worker.postMessage({ type: 'SKIP_WAITING' });
        } else {
            window.location.reload(); // Fallback
        }
    },





    async handleUserSession(user) {
        try {
            // 1. Fetch Profile from Cloud
            let profileDoc = await db.collection('users').doc(user.uid).get();
            
            // 2. Initialize new user if profile missing
            if (!profileDoc.exists) {
                const usersCount = (await db.collection('users').get()).size;
                const role = usersCount === 0 ? 'admin' : 'staff'; // First user is Admin
                
                const profile = {
                    uid: user.uid,
                    email: user.email,
                    displayName: localStorage.getItem('dawaa-temp-name') || user.email.split('@')[0],
                    role: role,
                    createdAt: (typeof firebase !== 'undefined' && firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString())
                };
                
                await db.collection('users').doc(user.uid).set(profile);
                profileDoc = await db.collection('users').doc(user.uid).get();
                localStorage.removeItem('dawaa-temp-name');
            }

            const profile = profileDoc.data();
            
            // 3. Set App Context (v9.9.0)
            this.user = profile;
            this.userRole = profile.role;

            
            document.getElementById('display-user-name').textContent = profile.displayName || profile.email;
            this.hideLogin();
            this.renderDashboard();
            this.updateAdminUI();
            
            // v10.5.1: Final UI Polish
            if (this.activeAudit) this.renderActiveAuditCard();
            
            // 5. Initial Pull (Automatic)
            // v16.3.0: Data Restructure Safety Init
            if (Sync.initV2) Sync.initV2();
            Sync.pull();
            
        } catch (err) {
            console.error('Session Error:', err);
            UI.showToast(`خطأ في تحميل ملف المستخدم (${err.code || err.message})`, 'danger');
        }
    },


    showLogin() {
        const loginView = document.getElementById('view-login');
        if (loginView) loginView.style.display = 'flex';
    },

    hideLogin() {
        const loginView = document.getElementById('view-login');
        if (loginView) loginView.style.display = 'none';
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                // v10.0.1: Cache-Busting Registration to bypass HTTP stickiness
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    console.log('SW: Sovereign Registered.');
                }).catch(err => console.error('SW: Registration Error.', err));
            });
        }
    },

    /**
     * Heavy Purge (v10.0.1 Sovereign Protocol)
     * Forces immediate cache clearance and Service Worker unregistration.
     */
    async forceUpdateSystem() {
        if (!confirm('🚨 تحذير: سيتم مسح الذاكرة المؤقتة وإعادة تحميل النظام تماماً. لن يتم حذف بياناتك المخزنة، فقط ملفات التطبيق. هل أنت متأكد؟')) return;
        
        try {
            UI.showToast('جاري تطهير النظام... 🧹', 'info');
            
            // 1. Unregister all SWs
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let reg of registrations) {
                await reg.unregister();
            }

            // 2. Clear all Caches
            const cacheKeys = await caches.keys();
            for (let key of cacheKeys) {
                await caches.delete(key);
            }

            UI.showToast('تم التطهير! جاري إعادة التشغيل... 🚀', 'success');
            setTimeout(() => window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now(), 1500);
        } catch (err) {
            console.error('Hard Reset Error:', err);
            UI.showToast('فشل التطهير الإجباري', 'danger');
        }
    },

    // Service Worker update logic moved to App.checkUpdate (v9.9.7 Architect)


    // --- View Renderers ---

    async renderDashboard() {
        try {
            const stats = await Inventory.getCurrentStockStats();
            UI.updateDashboardStats(stats);
            // v15.0.0: Render active structured tasks
            if (window.TaskManager) TaskManager.renderAssignedTaskPrompt();
        } catch (err) {
            console.error(err);
        }
    },

    async renderInventory(type = 'detailed') {
        try {
            const container = document.getElementById('inventory-items-list') || document.getElementById('inventory-list');
            if (!container) return;

            this.currentFilterType = type;
            const alertContainer = document.getElementById('inventory-filter-alert');
            if (alertContainer) {
                if (type === 'low-stock') {
                    alertContainer.style.display = 'block';
                    alertContainer.innerHTML = `
                        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--danger); padding: 8px 14px; border-radius: 12px; font-size: 13px; font-weight: 700;">
                            <span><i class='bx bx-trending-down'></i> تصفية: عرض الأرصدة الحرجة (5 أو أقل)</span>
                            <button onclick="window.App.renderInventory('detailed')" style="border: none; background: var(--surface); color: var(--text-main); padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: bold; cursor: pointer;">عرض الكل ✖</button>
                        </div>
                    `;
                } else if (type === 'expiry') {
                    alertContainer.style.display = 'block';
                    alertContainer.innerHTML = `
                        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: var(--warning); padding: 8px 14px; border-radius: 12px; font-size: 13px; font-weight: 700;">
                            <span><i class='bx bx-time-five'></i> تصفية: الأدوية التي تنتهي خلال 6 أشهر</span>
                            <button onclick="window.App.renderInventory('detailed')" style="border: none; background: var(--surface); color: var(--text-main); padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: bold; cursor: pointer;">عرض الكل ✖</button>
                        </div>
                    `;
                } else {
                    alertContainer.style.display = 'none';
                    alertContainer.innerHTML = '';
                }
            }

            this.renderCategoryChips(); // Refresh filters

            let data = await Inventory.getCurrentStockProducts();
            const masterData = await DB.getAll('medicineMaster');
            const masterMap = new Map(masterData.map(m => [m.id, m]));
            
            // 1. Initial Filtering by Type
            if (type === 'expiry') {
                const sixMonths = new Date();
                sixMonths.setMonth(sixMonths.getMonth() + 6);
                data = data.filter(i => (i.earliestExpiry || i.expiryDate) && new Date(i.earliestExpiry || i.expiryDate) <= sixMonths);
            } else if (type === 'low-stock') {
                data = data.filter(i => (i.totalQuantity || 0) <= 5);
            }

            // 2. Secondary Filtering by Category
            if (this.selectedCategoryId) {
                data = data.filter(i => {
                    const m = masterMap.get(i.medicineId || i.id);
                    return i.categoryId === this.selectedCategoryId;
                });
            }

            this.renderInventoryList(data, 'inventory-items-list', true);
        } catch (err) {
            console.error('Inventory Render Error:', err);
        }
    },


    async renderCategoryChips() {
        try {
            const cats = await Categories.getAllSorted();
            const allMeds = (await DB.getAll('medicineMaster')) || [];

            // 1. Populate Dropdown Select - Just the Category name in Arabic, no counts
            const selectEl = document.getElementById('category-dropdown-select');
            if (selectEl) {
                selectEl.innerHTML = `
                    <option value="">📦 جميع التصنيفات</option>
                    ${cats.map(c => {
                        const isSel = this.selectedCategoryId === c.id ? 'selected' : '';
                        return `<option value="${c.id}" ${isSel}>${c.nameAR}</option>`;
                    }).join('')}
                `;
            }

            // 2. Populate Chips container (if present)
            const container = document.getElementById('category-chips');
            if (container) {
                container.innerHTML = `
                    <div class="category-chip ${!this.selectedCategoryId ? 'active' : ''}" onclick="window.App.filterByCategory('')">
                        <i class='bx bx-category'></i> <span>الكل</span>
                    </div>
                    ${cats.map(c => `
                        <div class="category-chip ${this.selectedCategoryId === c.id ? 'active' : ''}" onclick="window.App.filterByCategory('${c.id}')">
                            <i class='bx ${c.icon}'></i> <span>${c.nameAR}</span>
                        </div>
                    `).join('')}
                `;
            }
        } catch (err) {
            console.error('Error rendering category filter:', err);
        }
    },

    filterByCategory(catId) {
        this.selectedCategoryId = catId || null;
        
        // Sync Dropdown Select
        const selectEl = document.getElementById('category-dropdown-select');
        if (selectEl && selectEl.value !== (catId || '')) {
            selectEl.value = catId || '';
        }

        const searchInput = document.getElementById('global-search');
        if (searchInput && searchInput.value.trim().length > 0) {
            this.handleGlobalSearch(searchInput.value);
        } else {
            this.renderInventory(this.currentFilterType || 'detailed');
        }
    },

    async renderReportData(data, container, isAggregated = false) {
        try {
            const masterData = await DB.getAll('medicineMaster');
            const masterMap = new Map(masterData.map(m => [m.id, m]));
            
            if (data.length === 0) {
                container.innerHTML = '<div class="empty-state">لا يوجد بيانات لهذا التقرير</div>';
                return;
            }

            container.innerHTML = data.map(item => {
                const med = masterMap.get(item.medicineId || item.id);
                if (!med) return '';
                
                const qty = isAggregated ? item.totalQuantity : item.quantity;
                const loc = item.location || 'تجميعي';
                const exp = isAggregated ? item.earliestExpiry : item.expiryDate;
                
                // Expiry styling
                const isExpiring = exp && new Date(exp) <= new Date(new Date().setMonth(new Date().getMonth() + 6));
                
                return `
                    <div class="report-result-card ${qty <= 5 ? 'border-danger' : ''}">
                        <div class="result-header">
                            <span class="badge ${loc === 'مخزن' ? 'bg-info' : 'bg-success'}">${loc}</span>
                            <span class="qty-badge">${qty} قطعة</span>
                        </div>
                        <div class="result-body">
                            <h3>${med.nameEN} <span class="ar-name">/ ${med.nameAR || ''}</span></h3>
                            <div class="result-meta">
                                <span><i class='bx bx-barcode'></i> كود: ${med.id}</span>
                                ${exp ? `<span class="${isExpiring ? 'text-danger fw-800' : ''}">
                                    <i class='bx bx-time-five'></i> انتهاء: ${exp}
                                </span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error(err);
        }
    },

    async renderSmartInventory() {
        try {
            this.renderCategoriesGrid();
        } catch (err) {
            console.error(err);
        }
    },

    async renderMasterData(items = null) {
        try {
            const container = document.getElementById('master-items-list');
            if (!container) return;

            const master = items || await DB.getAll('medicineMaster');
            const cats = await Categories.getAllSorted();
            const catMap = new Map(cats.map(c => [c.id, c]));

            if (master.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>لا يوجد بيانات أدوية</p></div>';
                return;
            }

            container.innerHTML = master.sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || '')).map(m => {
                const cat = catMap.get(m.categoryId) || { nameAR: m.categoryId, icon: 'bx-package', color: '#64748b' };
                const imgUrl = Categories.getMedicineImage(m);
                
                const isV2 = m.syncStatus === 'global_v2';
                const isLegacy = m.syncStatus === 'global' || m.syncStatus === 'global_legacy';
                const isAdmin = this.userRole === 'admin';
                
                return `
                    <div class="inventory-card ${isV2 ? 'status-safe' : (isLegacy ? 'status-info' : 'status-warning')}">
                        <span class="sync-badge ${isV2 ? 'v2' : (isLegacy ? 'legacy' : 'local')}" title="${isV2 ? 'V2 Optimized Sync' : (isLegacy ? 'Legacy Sync' : 'Local Only')}">
                            <i class='bx ${isV2 ? 'bx-cloud-lightning' : (isLegacy ? 'bx-cloud' : 'bx-time-five')}'></i>
                            ${isV2 ? '<small>V2</small>' : ''}
                        </span>
                        
                        <div class="card-img" style="overflow:hidden">
                            <img src="${imgUrl}" onerror="this.src='assets/icons/default-med.png'" style="width:100%; height:100%; object-fit:cover">
                        </div>
                        <div class="card-info">
                            <h3>
                                ${m.nameEN} 
                                <span class="ar-name">/ ${m.nameAR || ''}</span>
                                ${m.v ? `<span class="ver-badge">v${m.v}</span>` : ''}
                            </h3>
                            <div class="card-meta">
                                <span><i class='bx bx-barcode'></i> ${m.id}</span>
                                <span><i class='bx bx-purchase-tag-alt'></i> ${cat.nameAR}</span>
                            </div>
                        </div>
                        <div class="card-actions-float">
                            ${isAdmin && !isV2 ? `<button class="icon-btn sync-btn" onclick="window.Sync.push('${m.id}')" title="ترقية المزامنة لـ V2"><i class='bx bx-cloud-upload'></i></button>` : ''}
                            <button class="icon-btn" onclick="window.App.openEditMedicine('${m.id}')" title="تعديل"><i class='bx bx-edit-alt'></i></button>
                            ${isAdmin ? `<button class="icon-btn danger" onclick="window.App.deleteMasterMedicine('${m.id}')" title="حذف نهائي"><i class='bx bx-trash'></i></button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error(err);
        }
    },

    async renderCategoriesGrid() {
        try {
            const container = document.getElementById('category-grid');
            if (!container) return;

            const categories = await Categories.getAllSorted();
            
            container.innerHTML = categories.map(cat => {
                return `
                    <div class="category-card" onclick="window.App.openCategory('${cat.id}')">
                        <div class="category-icon" style="background: ${cat.color}"><i class='bx ${cat.icon}'></i></div>
                        <span>${cat.nameAR}</span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error(err);
        }
    },

    async renderInventoryList(items, containerId, isAggregated = false) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="bx bx-package"></i><p>لا توجد سجلات حالياً</p></div>';
            return;
        }

        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));

        container.innerHTML = items.map(item => {
            const master = isAggregated ? item : masterMap.get(item.medicineId);
            return Inventory.renderCard(item, master, isAggregated);
        }).join('');
    },


    // --- Dialogs (Standardized UI) ---

    async openCategory(catId) {
        try {
            this.selectedCategoryId = catId; // Store context for refresh
            const medicines = await Categories.getMedicinesByCategoryId(catId);
            const info = await Categories.getInfo(catId);

            UI.showModal(`
                <div class="modal-header">
                    <h2>${info.nameAR}</h2>
                    <div class="header-btns">
                        <button class="btn-primary sm-btn" onclick="window.App.openAddMedicineWithCat('${catId}')"><i class='bx bx-plus'></i> صنف جديد</button>
                        <button class="btn-ghost sm-btn" onclick="window.App.openTransferMedicine('${catId}')"><i class='bx bx-transfer'></i> نقل</button>
                    </div>
                </div>
                <div class="medicine-selection-grid">
                    ${medicines.map(m => {
                        const imgSrc = Categories.getMedicineImage(m);
                        return `
                            <div class="med-card-btn">
                                <div class="med-card-main" onclick="window.App.openEntryForm('${m.id}')">
                                    <div class="med-image">
                                        <img src="${imgSrc}" onerror="this.src='assets/icons/default-med.png'">
                                    </div>
                                    <div class="med-info-overlay">
                                        <h4>${m.nameEN} <span class="med-id-badge">#${m.id}</span></h4>
                                        <span class="med-active-sub">${m.activeIngredient || ''}</span>
                                    </div>
                                </div>
                                <div class="med-card-actions">
                                    <button class="action-btn-mini edit" onclick="window.App.openEditMedicine('${m.id}')" title="تعديل البيانات الأساسية"><i class='bx bx-edit-alt'></i></button>
                                    <button class="action-btn-mini delete" onclick="window.App.deleteMasterMedicine('${m.id}')" title="حذف الصنف نهائياً"><i class='bx bx-trash'></i></button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                ${medicines.length === 0 ? '<p class="text-center p-20">لا توجد أدوية في هذا القسم حالياً</p>' : ''}
                <div class="form-actions mt-20">
                    <button class="btn-ghost" onclick="window.UI.closeModal()">إغلاق</button>
                </div>
            `);
        } catch (err) {
            UI.showToast('فشل فتح القسم', 'danger');
        }
    },

    async openTransferMedicine(targetCatId) {
        try {
            const targetCat = await Categories.getInfo(targetCatId);
            
            UI.showModal(`
                <div class="modal-header">
                    <h2>نقل صنف إلى: ${targetCat.nameAR}</h2>
                </div>
                <div class="search-bar mb-20">
                    <i class='bx bx-search'></i>
                    <input type="text" placeholder="ابحث باسم الدواء لنقله..." oninput="window.App.handleTransferSearch(this.value, '${targetCatId}')">
                </div>
                <div id="transfer-search-results" class="items-list mini">
                    <p class="text-center p-20 text-muted">ابحث عن الدواء لنقله لهذا القسم</p>
                </div>
                <div class="form-actions mt-20">
                    <button class="btn-primary" onclick="window.App.openAddMedicineWithCat('${targetCatId}')">إضافة دواء جديد تماماً</button>
                    <button class="btn-ghost" onclick="window.UI.closeModal()">إغلاق</button>
                </div>
            `);
        } catch (err) {
            UI.showToast('فشل فتح نافذة النقل', 'danger');
        }
    },

    async handleTransferSearch(val, targetCatId) {
        if (!val) { document.getElementById('transfer-search-results').innerHTML = '<p class="text-center p-20 text-muted">ابحث عن الدواء لنقله لهذا القسم</p>'; return; }
        try {
            const results = await Categories.searchMaster(val);
            const container = document.getElementById('transfer-search-results');
            if (!container) return;

            // Filter and Sort (v6.6.2)
            const filtered = results
                .filter(m => m.categoryId !== targetCatId)
                .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || ''));
            
            container.innerHTML = filtered.slice(0, 10).map(m => `
                <div class="search-result-item" onclick="window.App.executeTransfer('${m.id}', '${targetCatId}')">
                    <i class='bx bx-transfer-alt'></i>
                    <div class="search-info">
                        <span class="search-name">${m.nameEN} (كود #${m.id})</span>
                        <span class="search-sub">من قسم: ${Categories.getCategoryNameAR(m.categoryId)}</span>
                    </div>
                    <button class="sm-btn btn-secondary">سحب للقسم</button>
                </div>
            `).join('');
            
            if (filtered.length === 0) container.innerHTML = '<p class="text-center p-20">لا توجد نتائج أو الدواء موجود بالفعل هنا</p>';
        } catch (err) {
            console.error(err);
        }
    },

    async executeTransfer(medicineId, targetCatId) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return;
            
            med.categoryId = targetCatId;
            med.lastUpdated = new Date().toISOString();
            med.syncStatus = 'local';
            
            await DB.put('medicineMaster', med);
            
            // v16.2.4: Immediate Cloud Sync for Category Transfers
            if (this.userRole === 'admin') {
                import('./core/sync.js').then(({ Sync }) => Sync.push(medicineId));
            }
            
            UI.showToast(`تم نقل ${med.nameEN} بنجاح ✅`, 'success');
            this.openCategory(targetCatId); // Refresh category view
        } catch (err) {
            UI.showToast('فشل عملية النقل ❌', 'danger');
        }
    },

    openAddMedicineWithCat(catId) {
        this.openAddMedicine();
        // Set the select value after modal renders
        setTimeout(() => {
            const sel = document.getElementById('m-category');
            if (sel) sel.value = catId;
        }, 100);
    },

    async openEntryForm(medicineId) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            const entries = await DB.getAll('inventory');
            const mEntries = entries.filter(e => e.medicineId === medicineId);
            
            // Calculate Current Balances (v10.3.0 Guardian Logic)
            const getLocQty = (loc) => mEntries.filter(e => e.location === loc).reduce((sum, e) => sum + e.quantity, 0);

            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2>إضافة جرد جديد ( Stock Entry )</h2></div>
                <div class="balance-notification clickable-locations" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; padding:12px 15px; background:var(--bg-soft); border-radius:15px; margin-bottom:15px;">
                    ${['صيدلية', 'مخزن', 'ثلاجة', 'دولاب الطوارئ', 'دولاب الاستقبال', 'إسعاف'].map(loc => `
                        <div class="loc-badge-btn" onclick="document.getElementById('entry-location-main').value='${loc}'">
                            <span class="loc-name">${loc}</span>
                            <strong class="loc-qty">${getLocQty(loc)}</strong>
                        </div>
                    `).join('')}
                </div>
                <form id="form-inventory" onsubmit="event.preventDefault(); window.App.saveEntry('${medicineId}');">
                    <div class="form-group">
                        <label class="form-label">الصنف المختبر:</label>
                        <input type="text" class="form-input" value="${med.nameEN}" readonly>
                        <button type="button" class="text-btn" style="text-align:right" onclick="window.App.openEditMedicine('${medicineId}')">⚙️ تعديل بيانات الصنف الرئيسي</button>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">مكان الجرد (إجباري):</label>
                            <select id="entry-location-main" class="form-select" required>
                                <option value="صيدلية">🏥 الصيدلية</option>
                                <option value="مخزن">📦 المخزن</option>
                                <option value="ثلاجة">❄️ الثلاجة</option>
                                <option value="دولاب الطوارئ">🚨 دولاب الطوارئ</option>
                                <option value="دولاب الاستقبال">🛋️ دولاب الاستقبال</option>
                                <option value="إسعاف">🚑 سيارة الإسعاف</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">الكمية الجديدة:</label>
                            <input type="number" id="entry-qty" class="form-input" placeholder="0" required>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">تاريخ الصلاحية (اختياري):</label>
                        <input type="month" id="entry-expiry" class="form-input">
                    </div>

                    <div class="form-actions mt-20">
                        <button type="submit" class="btn-primary">حفظ في الجرد الحالي</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            UI.showToast('خطأ في تحميل النموذج', 'danger');
        }
    },

    async saveEntry(medicineId) {
        try {
            const locEl = document.getElementById('entry-location-main');
            const qtyEl = document.getElementById('entry-qty');
            const expEl = document.getElementById('entry-expiry');

            if (!locEl || !qtyEl || !expEl) throw new Error('Form elements not found');

            const locMain = locEl.value;
            const qty = parseFloat(qtyEl.value);
            const exp = expEl.value;

            if (isNaN(qty) || qty < 0) {
                return UI.showToast('يرجى إدخال كمية صحيحة', 'warning');
            }

            const entryData = {
                medicineId: String(medicineId),
                location: locMain,
                quantity: qty,
                expiryDate: exp,
                auditId: this.activeAudit ? this.activeAudit.id : null
            };

            // Atomic Save
            await Inventory.addEntry(entryData);
            UI.showToast('تم حفظ الجرد بنجاح ✅', 'success');
            
            // v10.5.2: Async Broadcast (Don't block UI)
            if (this.activeAudit) {
                DB.get('medicineMaster', medicineId).then(med => {
                    Sync.pushAuditEntry({
                        auditId: this.activeAudit.id,
                        medicineName: med.nameEN,
                        quantity: qty
                    });
                });
            }

            UI.closeModal();
            await this.renderInventory(); if (this.renderDashboard) this.renderDashboard();
        } catch (err) {
            console.error('Save Entry Failed:', err);
            UI.showToast('فشل حفظ البيانات ❌', 'danger');
        }
    },

    async openAddMedicine() {
        try {
            const cats = await Categories.getAllSorted();
            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2>إضافة بند جديد للمستودع</h2></div>
                <form id="form-master-med" onsubmit="event.preventDefault(); window.App.saveMasterMedicine();">
                    <div class="image-upload-wrap">
                        <div class="image-preview" id="m-img-preview"><i class='bx bx-camera'></i></div>
                        <label for="m-file" class="btn-upload-label">اختر صورة الدواء</label>
                        <input type="file" id="m-file" accept="image/*" style="display:none" onchange="window.App.handleImagePreview(this, 'm-img-preview')">
                    </div>

                    <div class="form-group" style="position:relative;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="form-label" style="margin:0;">الاسم بالإنجليزية (أو ابحث في الكتالوج المصري):</label>
                            <span style="font-size:10px; color:var(--primary); font-weight:bold;">🇪🇬 اقتراح ذكي فوري</span>
                        </div>
                        <input type="text" id="m-name-en" class="form-input" placeholder="اكتب أول حرفين مثل: Panadol أو بنادول أو سرنجة..." required autocomplete="off" oninput="window.App.handleDrugCatalogSearch(this.value, 'm')">
                        <div id="m-catalog-suggestions" class="catalog-suggestions-dropdown" style="display:none;"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">الاسم بالعربية:</label>
                        <input type="text" id="m-name-ar" class="form-input" placeholder="مثلاً: بنادول إكسترا">
                    </div>
                    <div class="form-group">
                        <label class="form-label">المادة الفعالة (اختياري):</label>
                        <input type="text" id="m-active" class="form-input" placeholder="Paracetamol">
                    </div>
                    <div class="form-group">
                        <label class="form-label">فئة البند:</label>
                        <select id="m-category" class="form-select" required>
                            <option value="">اختر القسم...</option>
                            ${cats.map(c => `<option value="${c.id}">${c.nameAR}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label">نوع البند:</label>
                        <select id="m-type" class="form-select">
                            <option value="medicine">دواء عادي</option>
                            <option value="emergency">دواء طوارئ</option>
                            <option value="supply">مستلزم طبي</option>
                        </select>
                    </div>


                    <div class="form-group checkbox-group mt-10" style="display: flex; align-items: center; gap: 8px; background: var(--bg-secondary); padding: 10px; border-radius: 8px;">
                        <input type="checkbox" id="m-sync" checked style="width: 18px; height: 18px;">
                        <label for="m-sync" style="font-size: 13px; font-weight: 700; cursor: pointer;">نشر في السحابة فوراً (Cloud Push) ☁️</label>
                    </div>

 
                    <div class="form-actions mt-20">

                        <button type="submit" class="btn-primary">حفظ في المستودع</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">رجوع للجرد</button>
                    </div>
                </form>
            `);
        } catch (err) {
            UI.showToast('خطأ في النافذة', 'danger');
        }
    },

    async openEditMedicine(id) {
        try {
            const med = await DB.get('medicineMaster', id);
            const cats = await Categories.getAllSorted();
            const currentImg = Categories.getMedicineImage(med, { icon: 'bx-capsule' });
            
            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2>تعديل صنف المستودع</h2></div>
                <form id="form-edit-med" onsubmit="event.preventDefault(); window.App.updateMasterMedicine('${id}');">
                    <div class="image-upload-wrap">
                        <div class="image-preview" id="e-img-preview">
                            <img src="${currentImg}" onerror="this.src='assets/icons/default-med.png'">
                        </div>
                        <label for="e-file" class="btn-upload-label">تغيير الصورة</label>
                        <input type="file" id="e-file" accept="image/*" style="display:none" onchange="window.App.handleImagePreview(this, 'e-img-preview')">
                    </div>

                    <div class="form-group">
                        <label class="form-label">الاسم بالإنجليزية:</label>
                        <input type="text" id="e-name-en" class="form-input" value="${med.nameEN}" placeholder="e.g. Panadol" required>
                    </div>

                    <div class="form-group">
                        <label class="form-label">الاسم (العربية):</label>
                        <input type="text" id="e-name-ar" class="form-input" value="${med.nameAR || ''}">
                    </div>

                    <div class="form-group">
                        <label class="form-label">المادة الفعالة:</label>
                        <input type="text" id="e-active" class="form-input" value="${med.activeIngredient || ''}">
                    </div>

                    <div class="form-group">
                        <label class="form-label">القسم:</label>
                        <select id="e-category" class="form-select" required>
                            ${cats.map(c => `<option value="${c.id}" ${c.id === med.categoryId ? 'selected' : ''}>${c.nameAR}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label">النوع:</label>
                        <select id="e-type" class="form-select">
                            <option value="medicine" ${med.type === 'medicine' ? 'selected' : ''}>دواء عادي</option>
                            <option value="emergency" ${med.type === 'emergency' ? 'selected' : ''}>دواء طوارئ</option>
                            <option value="supply" ${med.type === 'supply' ? 'selected' : ''}>مستلزم طبي</option>
                        </select>
                    </div>


                    <div class="form-group checkbox-group mt-10" style="display: flex; align-items: center; gap: 8px; background: var(--bg-secondary); padding: 10px; border-radius: 8px;">
                        <input type="checkbox" id="e-sync" checked style="width: 18px; height: 18px;">
                        <label for="e-sync" style="font-size: 13px; font-weight: 700; cursor: pointer;">تحديث البيانات في السحابة ☁️</label>
                    </div>


                    <div class="form-actions mt-20">

                        <button type="submit" class="btn-primary">حفظ التعديلات</button>
                        <button type="button" class="btn-ghost" style="color:var(--danger)" onclick="window.App.deleteMasterMedicine('${id}')">حذف الصنف نهائياً</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            console.warn('Category Load Error:', err);
        }

    },

    handleImagePreview(input, previewId) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const container = document.getElementById(previewId);
                container.innerHTML = `<img src="${e.target.result}">`;
            };
            reader.readAsDataURL(input.files[0]);
        }
    },

    async saveMasterMedicine() {
        try {
            const fileInput = document.getElementById('m-file');
            let imgData = ''; // Local base64 for instant preview
            let file = null;

            if (fileInput.files && fileInput.files[0]) {
                file = fileInput.files[0];
                imgData = await Utils.fileToBase64(file);
            }

            const data = {
                nameEN: document.getElementById('m-name-en').value.trim(),
                nameAR: document.getElementById('m-name-ar').value.trim(),
                activeIngredient: document.getElementById('m-active').value.trim(),
                categoryId: document.getElementById('m-category').value,
                type: document.getElementById('m-type').value,
                imagePath: imgData,
                syncStatus: 'local'
            };

            const medId = await Categories.saveMedicine(data);
            UI.closeModal();
            this.renderInventory();
            this.renderDashboard();

            // Background Cloud Upload (v9.9.5 - Ironclad)
            if (file && this.userRole === 'admin') {
                UI.showToast('جاري رفع صورة الدواء للسحابة... ☁️', 'info');
                this.uploadImage(file, medId).then(async (url) => {
                    if (url) {
                        const med = await DB.get('medicineMaster', medId);
                        med.imagePath = url; // Cloud Link
                        await Categories.saveMedicine(med);
                        Sync.push(medId); // Push with URL
                        UI.showToast('تم حفظ الصورة في السحابة بنجاح ✨', 'success');
                    }
                });
            } else if (this.userRole === 'admin') {
                Sync.push(medId);
            }

        } catch (err) {
            UI.showToast('فشل حفظ الدواء', 'danger');
        }
    },



    async updateMasterMedicine(id) {
        try {
            const fileInput = document.getElementById('e-file');
            const med = await DB.get('medicineMaster', id);
            let file = null;
            
            let imgData = med.imagePath;
            if (fileInput.files && fileInput.files[0]) {
                file = fileInput.files[0];
                imgData = await Utils.fileToBase64(file);
            }

            const updated = {
                ...med,
                nameEN: document.getElementById('e-name-en').value.trim(),
                nameAR: document.getElementById('e-name-ar').value.trim(),
                activeIngredient: document.getElementById('e-active').value.trim(),
                categoryId: document.getElementById('e-category').value,
                type: document.getElementById('e-type').value,
                imagePath: imgData,
                syncStatus: 'local',
                lastUpdated: new Date().toISOString()
            };

            await Categories.saveMedicine(updated);
            UI.closeModal();
            this.renderInventory(); this.renderDashboard();

            // Background Cloud Upload (v9.9.5 - Ironclad Update)
            if (file && this.userRole === 'admin') {
                UI.showToast('جاري تحديث الصورة في السحابة... ☁️', 'info');
                this.uploadImage(file, id).then(async (url) => {
                    if (url) {
                        const m = await DB.get('medicineMaster', id);
                        m.imagePath = url;
                        await Categories.saveMedicine(m);
                        Sync.push(id);
                        UI.showToast('تم تحديث الصورة السحابية بنجاح ✨', 'success');
                    }
                });
            } else if (this.userRole === 'admin') {
                Sync.push(id);
            }
        } catch (err) {
            UI.showToast('فشل تحديث البيانات', 'danger');
        }
    },



    /**
     * Collaborative Audit Lifecycle (v10.5.1)
     */
    updateAuditSession(session) {
        // v14.0.0: High-Performance Cloud Inventory Sync
        if (session && (!this.activeAudit || this.activeAudit.id !== session.id)) {
            if (this.inventoryUnsubscribe) this.inventoryUnsubscribe();
            this.inventoryUnsubscribe = Sync.subscribeToInventory(session.id, () => {
                // Cloud Data Collision -> Notify Hub to refresh live stat counters
                Inventory.notify(); 
            });
        } else if (!session && this.inventoryUnsubscribe) {
            this.inventoryUnsubscribe();
            this.inventoryUnsubscribe = null;
        }

        this.activeAudit = session;

        if (session) {
            this.renderActiveAuditCard(); 
            if (UI.currentViewId === 'view-audit-hub') this.renderAuditHub();
            
            // Background listener without Toasts for silent operation
            if (this.isJoined || this.userRole === 'admin') {
                if (!this.feedListener) {
                    this.feedListener = Sync.subscribeToFeed(session.id, (entry) => {
                        this.pushNotification(`${entry.userName} أضاف: ${entry.medicineName} (الكمية: ${entry.quantity})`);
                        if (this.selectedCategoryId) this.openCategory(this.selectedCategoryId); 
                    });
                }
            }
        } else {
            this.activeAudit = null;
            this.isJoined = false;
            if (this.feedListener) {
                if (typeof this.feedListener === 'function') this.feedListener();
                this.feedListener = null;
            }
        }
    },

    renderActiveAuditCard() {
        // v16.2.0: Now handled by TaskManager on Dashboard
    },

    openAuditHub() {
        UI.switchView('view-audit-hub');
        this.renderAuditHub();
    },

    async renderAuditHub() {
        const container = document.getElementById('hub-session-content');
        if (!container) return;

        // Unified Session Logic (v16.2.0)
        const activeTask = TaskManager.activeTasks[TaskManager.activeTasks.length - 1]; 
        
        if (!activeTask) {
            container.innerHTML = `
                <div class="hub-idle-state text-center mt-30">
                    <div class="command-orb"><i class='bx bx-check-shield'></i></div>
                    <h2 class="text-muted">مركز الجرد <span class="badge bg-soft">وضع الاستعداد</span></h2>
                    <p class="text-muted mt-5">بانتظار بدء عملية جرد جديدة من تبويب (الإدارة)</p>
                    
                    <div class="hub-quick-actions mt-30">
                        <button class="commander-btn p-btn w-100" onclick="window.App.switchHubTab('sessions')">
                            <i class='bx bx-git-branch'></i>
                            <div class="btn-text">
                                <h3>فتح إدارة الجلسات 📡</h3>
                                <p>لإنشاء جرد فردي أو جماعي</p>
                            </div>
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Live Operational Hub for Active Individual/Group Tasks
            const stats = await Audit.getSessionStats(activeTask.session_id);
            const activities = await Inventory.getRecentAuditActivity(activeTask.session_id);

            container.innerHTML = `
                <div class="hub-active-commander">
                    <div class="command-status-header">
                        <div class="status-indicator live">عملية جارية (LIVE)</div>
                        <h1>${activeTask.location_name || 'جرد متعدد'}</h1>
                        <p class="small text-muted">ID: ${activeTask.id}</p>
                    </div>

                    <div class="stats-grid mt-20">
                        <div class="stat-box primary">
                            <span class="label">إجمالي القطع</span>
                            <span class="value counter">${stats.totalUnits}</span>
                        </div>
                        <div class="stat-box info">
                            <span class="label">أصناف فريدة</span>
                            <span class="value">${stats.uniqueCount}</span>
                        </div>
                        <div class="stat-box accent">
                            <span class="label">الحركات</span>
                            <span class="value">${stats.totalEntries}</span>
                        </div>
                    </div>

                    <div class="live-activity-section mt-25">
                         <div class="section-title">
                            <h3>نبض الميدان (Real-time Feed)</h3>
                            <span class="badge">Live</span>
                        </div>
                        <div class="command-log mt-10">
                            ${activities.length === 0 ? '<div class="log-empty">بانتظار الرصد الأول...</div>' : 
                                activities.slice(0,5).map(a => `
                                    <div class="command-log-item">
                                        <div class="item-desc" style="display:flex; justify-content:space-between; width:100%">
                                            <span><strong>+ ${a.quantity}</strong> قطعة (${a.medicineName || 'صنف'})</span>
                                            <span class="time">${new Date(a.timestamp).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</span>
                                        </div>
                                    </div>
                                `).join('')}
                        </div>
                    </div>

                    <div class="commander-controls mt-25">
                        <button class="btn-primary w-100 highlight-btn" onclick="window.App.runTask('${activeTask.id}')">
                            <i class='bx bx-play-circle'></i> استكمال الجرد (Execute)
                        </button>
                    </div>
                </div>
            `;
        }
    },

    // v15.0.0: Task Hub Tabs
    switchHubTab(tab) {
        const liveTab = document.getElementById('hub-session-content');
        const sessTab = document.getElementById('hub-structured-content');
        const btns = document.querySelectorAll('.tab-btn');
        
        btns.forEach(b => b.classList.remove('active'));
        
        if (tab === 'live') {
            liveTab.style.display = 'block';
            sessTab.style.display = 'none';
            btns[0].classList.add('active');
            this.renderAuditHub();
        } else {
            liveTab.style.display = 'none';
            sessTab.style.display = 'block';
            btns[1].classList.add('active');
            this.renderStructuredSessions();
        }
    },

    async renderStructuredSessions() {
        const container = document.getElementById('hub-structured-content');
        if (!container) return;

        const isAdmin = this.userRole === 'admin';
        
        // Fetch sessions from Firestore
        const snapshot = await db.collection('inventory_sessions').orderBy('created_at', 'desc').limit(5).get();
        const sessions = snapshot.docs.map(doc => doc.data());

        container.innerHTML = `
            ${isAdmin ? `
                <button class="commander-btn p-btn mb-20" onclick="window.App.openCreateInventory()">
                    <i class='bx bx-git-branch'></i>
                    <div class="btn-text">
                        <h3>إنشاء عملية جرد جديدة 📡</h3>
                        <p>ابدأ فوراً (فردي) أو وزع المهام (جماعي)</p>
                    </div>
                </button>
            ` : ''}

            <div class="section-title"><h3>سجل العمليات الجارية</h3></div>
            <div class="sessions-list mt-10">
                ${sessions.map(s => `
                    <div class="session-stat-card" style="background:var(--card-bg); padding:15px; border-radius:15px; border:1px solid var(--border-color); margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <h4 style="font-weight:800">${s.name}</h4>
                                <p style="font-size:11px; color:var(--text-muted)">بواسطة: ${s.created_by}</p>
                            </div>
                            <span class="badge ${s.status === 'completed' ? 'bg-success' : 'bg-primary'}">${s.status === 'completed' ? 'مكتمل' : 'جاري'}</span>
                        </div>
                    </div>
                `).join('')}
                ${sessions.length === 0 ? '<p class="text-muted text-center p-20">لا توجد جلسات مهيكلة حالياً</p>' : ''}
            </div>
        `;
    },

    // UI Helpers (v16.1.0)
    openCreateInventory() { TaskManager.openCreateInventory(); },
    uiCreateIndividual() { TaskManager.uiCreateIndividual(); },
    submitIndividualInventory() { TaskManager.submitIndividualInventory(); },
    uiCreateGroup() { TaskManager.openCreateSession(); },
    switchTaskLocation(loc) { TaskManager.switchLocation(loc); },
    toggleAllLocations(checked) {
        document.querySelectorAll('.loc-checkbox').forEach(cb => cb.checked = checked);
    },
    runTask(taskId) { TaskManager.runTask(taskId); },
    saveTaskCount(pid, qty) { TaskManager.saveTaskCount(pid, qty); },
    handleTaskSearch(val) { TaskManager.renderTaskList(val); },
    finishTask() {
        if (confirm('هل أنت متأكد من إنهاء المهمة؟')){
            UI.switchView('view-dashboard');
            UI.showToast('تم الحفظ والإغلاق بنجاح! 🎊', 'success');
        }
    },

    async exportAuditSession(auditId) {
        UI.showToast('جاري تجهيز تقرير الجرد... 📊', 'info');
        const entries = await Inventory.getEntriesByAudit(auditId);
        if (entries.length === 0) return UI.showToast('لا توجد بيانات لتصديرها لهذا الجرد', 'warning');
        
        const master = await DB.getAll('medicineMaster');
        const masterMap = new Map(master.map(m => [m.id, m]));

        const reportData = entries.map(e => ({
            'اسم الدواء AR': masterMap.get(e.medicineId)?.nameAR || 'Unknown',
            'اسم الدواء EN': masterMap.get(e.medicineId)?.nameEN || 'Unknown',
            'المكان': e.location,
            'الكمية': e.quantity,
            'تاريخ الصلاحية': e.expiryDate || 'N/A',
            'توقيت الإضافة': new Date(e.timestamp).toLocaleString('ar-EG'),
            'كود الصنف': e.medicineId
        }));

        Exporter.exportToExcel(reportData, `Audit_Report_${new Date().toISOString().split('T')[0]}`);
        UI.showToast('تم التصدير بنجاح! ✅', 'success');
    },

    // v16.2.3: Decommissioned Legacy Audit Engine (Now using Unified Task Logic)


    async deleteMasterMedicine(id) {
        if (confirm('هل أنت متأكد؟ سيتم حذف الصنف من المستودع نهائياً.')) {
            try {
                await Categories.deleteMedicine(id);
                UI.showToast('تم الحذف', 'info');
                UI.closeModal();
                this.renderInventory(); this.renderDashboard();
            } catch (err) {
                UI.showToast(err.message, 'danger');
            }
        }
    },

    // Removed legacy duplicate saveEntry block - merged logic upwards
    async deleteEntry(id) {
        if (confirm('حذف هذا السجل؟')) {
            try {
                await Inventory.deleteEntry(id);
                UI.renderCurrentView();
                UI.showToast('تم الحذف', 'info');
            } catch (err) {
                UI.showToast('فشل الحذف', 'danger');
            }
        }
    },

    // --- Search & Utils ---

    async handleGlobalSearch(query) {
        const q = (query || '').trim().toLowerCase();
        try {
            let data = await Inventory.getCurrentStockProducts();
            
            // Respect active filter type if set
            if (this.currentFilterType === 'expiry') {
                const sixMonths = new Date();
                sixMonths.setMonth(sixMonths.getMonth() + 6);
                data = data.filter(i => (i.earliestExpiry || i.expiryDate) && new Date(i.earliestExpiry || i.expiryDate) <= sixMonths);
            } else if (this.currentFilterType === 'low-stock') {
                data = data.filter(i => (i.totalQuantity || 0) <= 5);
            }

            if (this.selectedCategoryId) {
                data = data.filter(m => m.categoryId === this.selectedCategoryId);
            }

            if (q.length > 0) {
                data = data.filter(m => 
                    (m.nameEN && m.nameEN.toLowerCase().includes(q)) ||
                    (m.nameAR && m.nameAR.toLowerCase().includes(q)) ||
                    (m.categoryId && m.categoryId.toLowerCase().includes(q)) ||
                    (m.id && m.id.toLowerCase().includes(q))
                );
            }

            this.renderInventoryList(data, 'inventory-items-list', true);
        } catch (err) {
            console.error('Search error:', err);
        }
    },

    renderSearchResults(inventoryResults, masterResults, masterMap) {
        const container = document.getElementById('inventory-items-list');
        if (!container) return;


        let html = inventoryResults.map(item => {
            const med = masterMap.get(item.medicineId);
            return Inventory.renderCard(item, med);
        }).join('');

        if (masterResults.length > 0) {
            html += `
                <div class="category-chip" style="margin: 20px auto; width: fit-content; background: var(--bg-light); border-style: dashed; pointer-events: none;">
                    نتاج إضافية من المستودع
                </div>
            `;
            html += masterResults.map(m => `
                <div class="inventory-card" style="opacity: 0.8; border-style: dashed;" onclick="window.App.openEntryForm('${m.id}')">
                    <div class="card-icon"><i class='bx bx-plus-circle'></i></div>
                    <div class="card-info">
                        <h3>${m.nameEN} / ${m.nameAR || ''}</h3>
                        <div class="card-meta"><span><i class='bx bx-info-circle'></i> غير مسجل بالجرد - اضغط للإضافة</span></div>
                    </div>
                </div>
            `).join('');
        }

        container.innerHTML = html || '<div class="empty-state">لا توجد نتائج مطابقة</div>';
    },


    async handleMasterSearch(query) {
        if (!query) {
            return this.renderInventory();
        }
        try {
            const results = await Categories.searchMaster(query);
            this.renderMasterData(results);
        } catch (err) {
            console.error(err);
        }
    },

    async openQuickAdd() {
        try {
            const cats = await Categories.getAllSorted();
            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header">
                    <h2><i class='bx bx-plus-circle'></i> إضافة دواء جديد للمستودع</h2>
                </div>
                <form id="form-quick-add" onsubmit="event.preventDefault(); window.App.saveQuickAddMedicine();">
                    <div class="form-group" style="margin-bottom:12px; position:relative;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="form-label" style="margin:0;">الاسم بالإنجليزية (أو ابحث في الكتالوج المصري):</label>
                            <span style="font-size:10px; color:var(--primary); font-weight:bold;">🇪🇬 اقتراح ذكي فوري</span>
                        </div>
                        <input type="text" id="qa-name-en" class="form-input" placeholder="اكتب أول حرفين مثل: Panadol أو بنادول أو سرنجة..." required autofocus autocomplete="off" oninput="window.App.handleDrugCatalogSearch(this.value, 'qa')">
                        <div id="qa-catalog-suggestions" class="catalog-suggestions-dropdown" style="display:none;"></div>
                    </div>
                    <div class="form-group" style="margin-bottom:12px;">
                        <label class="form-label">الاسم بالعربية:</label>
                        <input type="text" id="qa-name-ar" class="form-input" placeholder="مثال: بنادول إكسترا">
                    </div>
                    <div class="form-group" style="margin-bottom:12px;">
                        <label class="form-label">القسم / التصنيف:</label>
                        <select id="qa-category" class="form-select" required>
                            <option value="">اختر القسم...</option>
                            ${cats.map(c => `<option value="${c.id}">${c.nameAR || c.id}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                        <div class="form-group">
                            <label class="form-label">الكمية المتوفرة:</label>
                            <input type="number" id="qa-qty" class="form-input" value="10" min="0" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">تاريخ الصلاحية:</label>
                            <input type="month" id="qa-expiry" class="form-input" value="2027-12" required>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:15px;">
                        <label class="form-label">مكان التخزين / الرف:</label>
                        <input type="text" id="qa-location" class="form-input" placeholder="مثال: الرف A-1">
                    </div>
                    <div class="form-actions" style="display:flex; gap:10px; margin-top:20px;">
                        <button type="submit" class="btn-primary" style="flex:1;">💾 حفظ الدواء في المستودع</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            console.error('Quick Add Error:', err);
            UI.showToast('خطأ في فتح النافذة', 'danger');
        }
    },

    // --- Egyptian Drug Catalog Auto-Complete (v18.6.0) ---
    handleDrugCatalogSearch(query, prefix = 'qa') {
        const container = document.getElementById(`${prefix}-catalog-suggestions`);
        if (!container) return;

        if (!query || query.trim().length < 2) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        const results = EgyptianDrugs.search(query, 6);
        if (results.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = results.map((item, idx) => {
            const catName = Categories.getCategoryNameAR(item.categoryId);
            return `
                <div class="catalog-suggestion-item" onclick="window.App.selectDrugFromCatalog(${idx}, '${prefix}')">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <strong style="font-size:13px; color:var(--text-main);">${item.nameEN}</strong>
                            <span style="font-size:11px; color:var(--text-muted);">(${item.nameAR})</span>
                        </div>
                        ${item.active ? `<small style="display:block; font-size:11px; color:var(--text-muted); margin-top:2px;">💊 ${item.active}</small>` : ''}
                    </div>
                    <span class="badge" style="background:rgba(59,130,246,0.1); color:var(--primary); font-size:10px; padding:2px 6px; border-radius:4px; white-space:nowrap;">
                        ${catName}
                    </span>
                </div>
            `;
        }).join('');

        this._activeCatalogResults = results;
    },

    selectDrugFromCatalog(index, prefix) {
        if (!this._activeCatalogResults || !this._activeCatalogResults[index]) return;
        const item = this._activeCatalogResults[index];

        const container = document.getElementById(`${prefix}-catalog-suggestions`);
        if (container) container.style.display = 'none';

        if (prefix === 'qa') {
            const nameEnEl = document.getElementById('qa-name-en');
            const nameArEl = document.getElementById('qa-name-ar');
            const catEl = document.getElementById('qa-category');

            if (nameEnEl) nameEnEl.value = item.nameEN;
            if (nameArEl) nameArEl.value = item.nameAR;
            if (catEl) {
                catEl.value = item.categoryId;
                if (!catEl.value) {
                    Array.from(catEl.options).forEach(opt => {
                        if (opt.value.toLowerCase() === item.categoryId.toLowerCase()) catEl.value = opt.value;
                    });
                }
            }
        } else if (prefix === 'm') {
            const nameEnEl = document.getElementById('m-name-en');
            const nameArEl = document.getElementById('m-name-ar');
            const activeEl = document.getElementById('m-active');
            const catEl = document.getElementById('m-category');
            const typeEl = document.getElementById('m-type');

            if (nameEnEl) nameEnEl.value = item.nameEN;
            if (nameArEl) nameArEl.value = item.nameAR;
            if (activeEl) activeEl.value = item.active || '';
            if (catEl) {
                catEl.value = item.categoryId;
                if (!catEl.value) {
                    Array.from(catEl.options).forEach(opt => {
                        if (opt.value.toLowerCase() === item.categoryId.toLowerCase()) catEl.value = opt.value;
                    });
                }
            }
            if (typeEl && item.type) typeEl.value = item.type;
        }

        UI.showToast(`✨ تم إدراج (${item.nameAR}) بنجاح`, 'success');
    },

    async saveQuickAddMedicine() {
        try {
            const nameEN = document.getElementById('qa-name-en').value.trim();
            const nameAR = document.getElementById('qa-name-ar').value.trim() || nameEN;
            const categoryId = document.getElementById('qa-category').value;
            const qty = Number(document.getElementById('qa-qty').value) || 0;
            const expiry = document.getElementById('qa-expiry').value || '2027-12';
            const location = document.getElementById('qa-location').value.trim() || 'المستودع الرئيسي';

            if (!nameEN || !categoryId) {
                UI.showToast('يرجى ملء الاسم والقسم', 'warning');
                return;
            }

            const medId = 'med_' + Date.now();
            const now = new Date().toISOString();

            await DB.add('medicineMaster', {
                id: medId,
                nameEN,
                nameAR,
                categoryId,
                type: 'medicine',
                imagePath: 'assets/icons/default-med.png',
                syncStatus: 'local',
                createdAt: now
            });

            await DB.add('inventory', {
                id: 'inv_' + medId,
                medicineId: medId,
                quantity: qty,
                expiryDate: expiry,
                location,
                syncStatus: 'local',
                lastUpdated: now
            });

            UI.closeModal();
            UI.showToast(`تمت إضافة «${nameEN}» برصيد ${qty} بنجاح ✨`, 'success');

            await this.renderDashboard();
            await this.renderInventory('detailed');
            window.switchView('inventory');

            if (this.userRole === 'admin') {
                Sync.push(medId);
            }
        } catch (err) {
            console.error('Save Quick Add Error:', err);
            UI.showToast('فشل حفظ الدواء', 'danger');
        }
    },

    async adjustStock(medId, delta) {
        try {
            let entries = await DB.getAll('inventory');
            let entry = entries.find(e => e.medicineId === medId);
            const now = new Date().toISOString();
            
            if (entry) {
                entry.quantity = Math.max(0, (Number(entry.quantity) || 0) + delta);
                entry.lastUpdated = now;
                await DB.put('inventory', entry);
            } else {
                const newQty = Math.max(0, 15 + delta);
                entry = {
                    id: 'inv_' + medId,
                    medicineId: medId,
                    quantity: newQty,
                    expiryDate: '2027-12-31',
                    location: 'المستودع الرئيسي',
                    lastUpdated: now
                };
                await DB.put('inventory', entry);
            }

            const countEl = document.getElementById(`stock-val-${medId}`);
            if (countEl) countEl.textContent = entry.quantity;

            if (this.userRole === 'admin') {
                Sync.push(medId);
            }

            const stats = await Inventory.getCurrentStockStats();
            UI.updateDashboardStats(stats);
            
            UI.showToast(delta > 0 ? `الرصيد: ${entry.quantity} ➕` : `الرصيد: ${entry.quantity} ➖`, 'info');
        } catch (err) {
            console.error('Adjust stock error:', err);
            UI.showToast('فشل تعديل الرصيد', 'danger');
        }
    },

    switchInventoryTab(tab) {
        this.inventoryTab = tab;
        document.querySelectorAll('.toggle-btn').forEach(b => {
            b.classList.toggle('active', b.textContent === (tab === 'detailed' ? 'تفصيلي' : 'تجميعي'));
        });
        this.renderInventory();
    },

    async export(type) {
        try {
            await Exporter.exportToExcel(type);
            UI.showToast('تم التصدير بنجاح', 'success');
        } catch (err) {
            UI.showToast('فشل التصدير', 'danger');
        }
    },

    async openManageCategories() {
        try {
            const cats = await Categories.getAllSorted();
            const allMeds = await DB.getAll('medicineMaster');
            
            UI.showModal(`
                <div class="modal-header">
                    <h2>إدارة الأقسام والتبويب</h2>
                    <button class="btn-primary sm-btn" onclick="window.App.openAddCategory()">+ قسم جديد</button>
                </div>
                <div class="items-list mini">
                    ${cats.map(c => {
                        const count = allMeds.filter(m => m.categoryId === c.id).length;
                        return `
                            <div class="cat-manage-item">
                                <div class="cat-info" onclick="window.App.openEditCategory('${c.id}')" style="cursor:pointer">
                                    <i class='bx ${c.icon}' style="color: ${c.color}; font-size: 24px;"></i>
                                    <div style="display:flex; flex-direction:column">
                                        <span style="font-weight:800">${c.nameAR}</span>
                                        <span class="text-muted" style="font-size:10px">${count} صنف عثر عليه</span>
                                    </div>
                                </div>
                                <div class="cat-actions">
                                    <button class="icon-btn" onclick="window.App.confirmDeleteCategory('${c.id}')" title="حذف القسم"><i class='bx bx-trash' style="color:var(--danger)"></i></button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <button class="btn-ghost mt-20" onclick="window.UI.closeModal()">إغلاق</button>
            `);
        } catch (err) {
            UI.showToast('خطأ في تحميل الأقسام', 'danger');
        }
    },

    openAddCategory() {
        UI.showModal(`
            <div class="modal-header"><h2>إضافة قسم جديد</h2></div>
            <form id="form-add-cat" onsubmit="event.preventDefault(); window.App.saveCategory();">
                <div class="form-group">
                    <label class="form-label">اسم القسم (بالعربية):</label>
                    <input type="text" id="cat-name" class="form-input" placeholder="مثلاً: فيتامينات" required>
                </div>
                <div class="form-group">
                    <label class="form-label">الأيقونة (Boxicons):</label>
                    <input type="text" id="cat-icon" class="form-input" value="bx-package">
                </div>
                <div class="form-group">
                    <label class="form-label">اللون مميز:</label>
                    <input type="color" id="cat-color" class="form-input" style="height:45px" value="#64748b">
                </div>
                <div class="form-actions mt-20">
                    <button type="submit" class="btn-primary">حفظ القسم</button>
                    <button type="button" class="btn-ghost" onclick="window.App.openManageCategories()">رجوع</button>
                </div>
            </form>
        `);
    },

    async openEditCategory(id) {
        try {
            const cat = await Categories.getInfo(id);
            UI.showModal(`
                <div class="modal-header"><h2>تعديل قسم: ${cat.nameAR}</h2></div>
                <form id="form-edit-cat" onsubmit="event.preventDefault(); window.App.saveCategory('${id}');">
                    <div class="form-group">
                        <label class="form-label">اسم القسم:</label>
                        <input type="text" id="cat-name" class="form-input" value="${cat.nameAR}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">الأيقونة:</label>
                        <input type="text" id="cat-icon" class="form-input" value="${cat.icon || 'bx-package'}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">اللون:</label>
                        <input type="color" id="cat-color" class="form-input" style="height:45px" value="${cat.color || '#64748b'}">
                    </div>
                    <div class="form-actions mt-20">
                        <button type="submit" class="btn-primary">تحديث</button>
                        <button type="button" class="btn-ghost" onclick="window.App.openManageCategories()">رجوع</button>
                    </div>
                </form>
            `);
        } catch (err) {
            UI.showToast('خطأ في تحميل بيانات القسم', 'danger');
        }
    },

    async saveCategory(id = null) {
        try {
            const name = document.getElementById('cat-name').value.trim();
            const icon = document.getElementById('cat-icon').value.trim();
            const color = document.getElementById('cat-color').value;
            
            if (!name) return;
            
            const cat = {
                id: id || name.toLowerCase().replace(/\s+/g, '-'),
                nameAR: name,
                icon: icon,
                color: color
            };
            
            await Categories.saveCategory(cat);
            UI.showToast('تم حفظ القسم بنجاح ✨', 'success');
            this.openManageCategories();
        } catch (err) {
            UI.showToast('فشل حفظ القسم', 'danger');
        }
    },


    async confirmDeleteCategory(catId) {
        try {
            const meds = await Categories.getMedicinesByCategoryId(catId);
            const cat = await Categories.getInfo(catId);
            
            if (meds.length === 0) {
                if (confirm(`هل أنت متأكد من حذف قسم "${cat.nameAR}"؟`)) {
                    await Categories.deleteCategory(catId);
                    UI.showToast('تم حذف القسم', 'success');
                    this.openManageCategories();
                }
                return;
            }

            UI.showModal(`
                <div class="modal-header"><h2>حذف قسم: ${cat.nameAR}</h2></div>
                <div class="info-card warning mb-20">
                    <i class='bx bx-error'></i>
                    <p>هذا القسم يحتوي على <strong>${meds.length}</strong> دواء مسجل. ماذا تريد أن تفعل بالأدوية؟</p>
                </div>
                <div style="display:flex; flex-direction:column; gap:12px">
                    <button class="btn-primary" onclick="window.App.executeDeleteCategory('${catId}', 'move')">📦 نقل الأدوية لـ "غير مصنف" ثم الحذف</button>
                    <button class="btn-secondary" style="background:#fee2e2; color:#ef4444" onclick="window.App.executeDeleteCategory('${catId}', 'delete_all')">🗑️ حذف القسم بكل ما فيه نهائياً</button>
                    <button class="btn-ghost" onclick="window.App.openManageCategories()">إلغاء</button>
                </div>
            `);
        } catch (err) {
            UI.showToast('خطأ في معالجة الحذف', 'danger');
        }
    },

    async executeDeleteCategory(catId, action) {
        try {
            const meds = await Categories.getMedicinesByCategoryId(catId);
            
            if (action === 'move') {
                // Ensure 'Uncategorized' exists or use a default
                for (const med of meds) {
                    med.categoryId = 'uncategorized';
                    await DB.put('medicineMaster', med);
                }
                UI.showToast(`تم نقل ${meds.length} دواء لـ "غير مصنف"`, 'info');
            } else if (action === 'delete_all') {
                for (const med of meds) {
                    await DB.delete('medicineMaster', med.id);
                }
                UI.showToast(`تم حذف القسم و ${meds.length} دواء`, 'warning');
            }

            await Categories.deleteCategory(catId);
            UI.closeModal();
            this.openManageCategories();
        } catch (err) {
            UI.showToast('فشل إتمام العملية', 'danger');
        }
    },
};

// Global Bindings
window.App = App;
window.UI = UI;

// Bridges
window.switchView = (id) => {
    // Standardize IDs from nav (e.g., 'dashboard' -> 'view-dashboard')
    const finalId = id.startsWith('view-') ? id : `view-${id}`;
    UI.switchView(finalId);
    if (finalId === 'view-inventory' && window.App?.renderInventory) {
        window.App.renderInventory('detailed');
    }
};
window.handleSearch = (query) => App.handleGlobalSearch(query);
window.toggleTheme = () => {
    if (typeof UI?.toggleTheme === 'function') {
        UI.toggleTheme();
    } else {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('dawaa-theme', isDark ? 'dark' : 'light');
        const icon = document.getElementById('theme-icon');
        if (icon) icon.className = isDark ? 'bx bx-sun' : 'bx bx-moon';
    }
    if (typeof UI?.updateSettingsIcons === 'function') UI.updateSettingsIcons();
};

// --- Settings Logic ---
App.handleBackup = async function() {
    try {
        UI.showToast('جاري تحضير النسخة الاحتياطية...', 'info');
        const data = {
            categories: (await DB.getAll('categories')) || [],
            medicineMaster: (await DB.getAll('medicineMaster')) || [],
            inventory: (await DB.getAll('inventory')) || [],
            locations: (await DB.getAll('locations')) || [],
            audit_sessions: (await DB.getAll('audit_sessions')) || [],
            team: (typeof Users !== 'undefined' && Users.getAll) ? Users.getAll() : [],
            exportDate: new Date().toISOString(),
            version: '18.6.2'
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dawaa_backup_${new Date().toISOString().split('T')[0]}.dawaa`;
        a.click();
        URL.revokeObjectURL(url);
        UI.showToast('تم تصدير النسخة الاحتياطية الشاملة بنجاح ✅', 'success');
    } catch (err) {
        UI.showToast('فشل التصدير: ' + err.message, 'danger');
    }
};

App.handleRestore = async function(input) {
    if (!input.files || !input.files[0]) return;
    if (!confirm('تحذير: سيتم استبدال البيانات الحالية بالنسخة الاحتياطية المرفوعة. هل تريد المتابعة؟')) return;

    try {
        UI.showToast('جاري استعادة البيانات...', 'info');
        const file = input.files[0];
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (Array.isArray(data.categories) && data.categories.length > 0) {
                    await DB.clear('categories');
                    for (const cat of data.categories) await DB.put('categories', cat);
                }
                if (Array.isArray(data.medicineMaster) && data.medicineMaster.length > 0) {
                    await DB.clear('medicineMaster');
                    for (const med of data.medicineMaster) await DB.put('medicineMaster', med);
                }
                if (Array.isArray(data.inventory)) {
                    await DB.clear('inventory');
                    for (const inv of data.inventory) await DB.put('inventory', inv);
                }
                if (Array.isArray(data.locations) && data.locations.length > 0) {
                    await DB.clear('locations');
                    for (const loc of data.locations) await DB.put('locations', loc);
                }
                if (Array.isArray(data.audit_sessions)) {
                    await DB.clear('audit_sessions');
                    for (const s of data.audit_sessions) await DB.put('audit_sessions', s);
                }
                if (Array.isArray(data.team) && data.team.length > 0) {
                    localStorage.setItem('dawaa_team_members', JSON.stringify(data.team));
                }

                UI.showToast('تمت استعادة كافة البيانات الشاملة بنجاح! ✨', 'success');
                setTimeout(() => window.location.reload(), 1200);
            } catch (err) {
                UI.showToast('فشل قراءة الملف: ' + err.message, 'danger');
            }
        };
        reader.readAsText(file);
    } catch (err) {
        UI.showToast('خطأ في العملية: ' + err.message, 'danger');
    }
};

App.fullReset = async function() {
    if (confirm('💣 تحذير نهائي: سيتم حذف كافة البيانات والبدء من الصفر. سيتم حذف صور الأدوية أيضاً. هل أنت متأكد؟')) {
        try {
            await DB.deleteDB();
            UI.showToast('تم تصفير النظام. سيتم إعادة التشغيل...', 'warning');
            setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
            UI.showToast('فشل المسح: ' + err.message, 'danger');
        }
    }
};

App.updateStatus = function(msg) {
    const el = document.getElementById('update-status-text');
    if (el) el.textContent = msg;
};

App.updateState = 'check'; // 'check' or 'ready'
App.pendingRegistration = null;

App.getRemoteVersion = async function() {
    try {
        // Fetch sw.js directly with cache-busting to read server-side version
        const response = await fetch(`./sw.js?v=${Date.now()}`, { cache: 'no-store' });
        const text = await response.text();
        const match = text.match(/CACHE_NAME = 'dawaa-cache-v([\d.]+)'/);
        return match ? match[1] : null;
    } catch (err) {
        return null;
    }
};

App.checkUpdate = async function() {
    // Stage 2: Execute Update (Second Click)
    if (this.updateState === 'ready' && this.pendingRegistration) {
        const reg = this.pendingRegistration;
        const worker = reg.waiting || reg.installing || reg.active;
        if (worker) {
            UI.showToast('جاري تثبيت التحديث وإعادة التشغيل... ⏳', 'info');
            worker.postMessage({ type: 'SKIP_WAITING' });
            // controllerchange listener from Stage 1 will handle the reload
        }
        return;
    }

    // Stage 1: Check for Updates (First Click)
    this.updateStatus('جاري فحص الإصدار بدقة... 🔍');
    if ('serviceWorker' in navigator) {
        try {
            // 1. Intelligent Check: Is there a newer version on the server?
            const remoteVer = await this.getRemoteVersion();
            console.log(`Update Check: Local=${this.VERSION}, Remote=${remoteVer}`);

            if (remoteVer && remoteVer !== this.VERSION) {
                // 2. New Version Confirmed: Trigger SW System
                const reg = await navigator.serviceWorker.register(`./sw.js?v=${remoteVer}`);
                await reg.update();

                // Monitor for Activation Sovereignty (v9.10.1)
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    window.location.reload();
                });

                const newWorker = reg.waiting || reg.installing;
                if (newWorker) {
                    this.updateStatus(`تحديث متاح (v${remoteVer})! اضغط للتثبيت 🚀`);
                    this.updateState = 'ready';
                    this.pendingRegistration = reg;
                    const btn = document.querySelector('.setting-card .bx-refresh')?.closest('.setting-card');
                    if (btn) btn.style.background = 'var(--primary-light)'; 
                    return;
                }
            }

            // 3. Up to date or no version found
            this.updateStatus(`أنت تستخدم النسخة v${this.VERSION} بنجاح ✅`);
            this.updateState = 'check';
            const btn = document.querySelector('.setting-card .bx-refresh')?.closest('.setting-card');
            if (btn) btn.style.background = ''; // Reset if it was blue
            setTimeout(() => this.updateStatus('البحث عن إصدارات جديدة متوفرة'), 4000);

        } catch (err) {
            console.error('Update Sentry Error:', err);
            this.updateStatus('فشل التحقق من التحديث ⚠️');
        }
    }
};








App.userRole = 'staff';
App.user = null;
App.SILENT_PASS = 'dawaa@2026';

App.toggleAuthMode = function() {
    // Legacy toggle removed in v9.4 - both fields are always shown
};

App.handleAuthSubmit = async function() {
    const name = document.getElementById('auth-name').value.trim();
    const payrollNo = document.getElementById('auth-email').value.trim();
    const email = `${payrollNo}@dawaa.internal`;

    if (!name || !payrollNo) {
        UI.showToast('يرجى إدخال الاسم ورقم الباي رول', 'warning');
        return;
    }

    try {
        UI.showToast('جاري التحقق من الهوية...', 'info');
        localStorage.setItem('dawaa-temp-name', name);
        
        // Match or create in local team registry
        let team = Users.getAll();
        let user = team.find(u => u.id === `user_${payrollNo}` || u.name === name);
        if (!user) {
            user = Users.addUser({
                name: name,
                title: 'صيدلي ميداني',
                role: 'staff'
            });
        }
        if (user) Users.setActive(user);

        // 1. Try to Login with Firebase
        try {
            await auth.signInWithEmailAndPassword(email, this.SILENT_PASS);
            UI.showToast(`أهلاً بك مجدداً يا ${name}!`, 'success');
        } catch (loginErr) {
            // 2. If user doesn't exist, Create Account
            if (loginErr.code === 'auth/user-not-found' || loginErr.code === 'auth/invalid-credential') {
                await auth.createUserWithEmailAndPassword(email, this.SILENT_PASS);
                UI.showToast('تم إنشاء حسابك بنجاح! ✨', 'success');
            } else if (loginErr.code === 'auth/network-request-failed' || !navigator.onLine) {
                // Local offline fallback
                const localUser = {
                    uid: `local_${payrollNo}`,
                    email: email,
                    displayName: name
                };
                await this.handleUserSession(localUser);
                UI.showToast(`دخول محلي: مرحباً ${name}`, 'success');
            } else {
                throw loginErr;
            }
        }
    } catch (err) {
        if (err.code === 'auth/network-request-failed' || !navigator.onLine) {
            const localUser = {
                uid: `local_${payrollNo}`,
                email: email,
                displayName: name
            };
            await this.handleUserSession(localUser);
            UI.showToast(`دخول محلي: مرحباً ${name}`, 'success');
            return;
        }
        console.error('Auth Error:', err);
        let msg = 'خطأ في الدخول';
        if (err.code === 'auth/operation-not-allowed') msg = 'يرجى تفعيل البريد الإلكتروني في كونسول فيربيس';
        if (err.code === 'auth/network-request-failed') msg = 'تأكد من اتصالك بالإنترنت';
        UI.showToast(`${msg} (${err.code || err.message})`, 'danger');
    }
};


App.handleLogout = async function() {
    window.App = App;
    if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
        try {
            await auth.signOut();
            // Clear local states if any
            localStorage.removeItem('dawaa-temp-name');
            window.location.reload();
        } catch (err) {
            UI.showToast('فشل في تسجيل الخروج', 'danger');
        }
    }
};

Object.assign(App, {
// --- v18.0.0: Hierarchical Audit Engine & Warehouse Hub ---
auditLevel: 'sessions', // 'sessions' | 'locations' | 'categories' | 'medicines'
    selectedAuditSessionId: null,
    selectedAuditLocationId: null,
    selectedAuditCategoryId: null,
    warehouseSegment: 'medicines', // 'medicines' | 'categories' | 'locations'

    // --- Warehouse Segment Navigation ---
    switchWarehouseSegment(segment) {
        this.warehouseSegment = segment;
        document.querySelectorAll('.segment-btn').forEach(btn => btn.classList.remove('active'));
        
        const btnMap = {
            medicines: 'seg-btn-meds',
            categories: 'seg-btn-cats',
            locations: 'seg-btn-locs'
        };
        const activeBtn = document.getElementById(btnMap[segment]);
        if (activeBtn) activeBtn.classList.add('active');

        const secMeds = document.getElementById('wh-meds-section');
        const secCats = document.getElementById('wh-cats-section');
        const secLocs = document.getElementById('wh-locs-section');

        if (secMeds) secMeds.style.display = segment === 'medicines' ? 'block' : 'none';
        if (secCats) secCats.style.display = segment === 'categories' ? 'block' : 'none';
        if (secLocs) secLocs.style.display = segment === 'locations' ? 'block' : 'none';

        if (segment === 'medicines') {
            this.renderInventory();
        } else if (segment === 'categories') {
            this.renderWarehouseCategories();
        } else if (segment === 'locations') {
            this.renderWarehouseLocations();
        }
    },

    async renderWarehouseCategories() {
        const container = document.getElementById('wh-categories-grid');
        if (!container) return;

        try {
            const cats = await Categories.getAllSorted();
            const allMeds = (await DB.getAll('medicineMaster')) || [];

            container.innerHTML = cats.map(c => {
                const count = allMeds.filter(m => m.categoryId === c.id).length;
                return `
                    <div class="square-card" onclick="window.App.openCategoryDetailModal('${c.id}')" title="استعراض وإدارة أدوية ${c.nameAR}">
                        <i class='bx ${c.icon || 'bx-category'} square-icon' style="color: ${c.color || 'var(--primary)'}"></i>
                        <h3>${c.nameAR}</h3>
                        <span class="square-meta">${count} صنف دواء</span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error rendering warehouse categories:', err);
        }
    },

    async renderWarehouseLocations() {
        const container = document.getElementById('wh-locations-grid');
        if (!container) return;

        try {
            const locs = await Locations.getAll();
            container.innerHTML = locs.map(loc => {
                return `
                    <div class="square-card" onclick="window.App.openEditLocationModal('${loc.id}')" title="تعديل ${loc.nameAR}">
                        <i class='bx ${loc.icon || 'bx-map-pin'} square-icon' style="color: ${loc.color || 'var(--primary)'}"></i>
                        <h3>${loc.nameAR}</h3>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error rendering warehouse locations:', err);
        }
    },

    // --- Interactive Category Drill-Down & Management ---
    async openCategoryDetailModal(catId) {
        try {
            const cat = await Categories.getInfo(catId);
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            const medsInCat = allMeds.filter(m => m.categoryId === catId);

            UI.showModal(`
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class='bx ${cat.icon || 'bx-category'}' style="font-size:24px; color:${cat.color || 'var(--primary)'}"></i>
                        <div>
                            <h2 style="margin:0; font-size:18px;">${cat.nameAR}</h2>
                            <small class="text-muted">${medsInCat.length} صنف مسجل في هذا القسم</small>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-primary sm-btn" onclick="window.App.openAddMedicineWithCat('${catId}')" title="إضافة دواء جديد لهذا القسم">
                            <i class='bx bx-plus'></i> دواء جديد
                        </button>
                        <button class="btn-ghost sm-btn" onclick="window.App.openEditCategoryModal('${catId}')" title="تعديل بيانات التصنيف">
                            <i class='bx bx-edit'></i>
                        </button>
                    </div>
                </div>

                <div class="category-meds-list" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">
                    ${medsInCat.map(m => {
                        const img = Categories.getMedicineImage(m);
                        return `
                            <div class="cat-med-item" style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px;">
                                <div style="width:40px; height:40px; border-radius:8px; overflow:hidden; flex-shrink:0;">
                                    <img src="${img}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                                </div>
                                <div style="flex:1; min-width:0;">
                                    <h4 style="margin:0; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.nameEN || m.nameAR}</h4>
                                    <span style="font-size:11px; color:var(--text-muted);">${m.nameAR && m.nameAR !== m.nameEN ? m.nameAR : (m.activeIngredient || 'دواء')}</span>
                                </div>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <button class="btn-ghost sm-btn" onclick="window.App.openMoveCategoryModal('${m.id}', '${catId}')" title="نقل إلى تصنيف آخر" style="font-size:11px; padding:4px 8px; border-radius:6px; border:1px solid var(--border-color);">
                                        <i class='bx bx-transfer'></i> نقل
                                    </button>
                                    <button class="icon-btn" onclick="window.App.openEditMedicine('${m.id}')" title="تعديل الدواء" style="padding:4px;">
                                        <i class='bx bx-edit-alt' style="font-size:16px;"></i>
                                    </button>
                                    <button class="icon-btn text-danger" onclick="window.App.deleteMasterMedicine('${m.id}')" title="حذف الدواء" style="padding:4px;">
                                        <i class='bx bx-trash' style="font-size:16px; color:var(--danger);"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${medsInCat.length === 0 ? `
                        <div class="empty-state" style="padding:30px; text-align:center;">
                            <i class='bx bx-capsule' style="font-size:36px; color:var(--text-muted); opacity:0.5;"></i>
                            <p class="text-muted mt-10">لا توجد أدوية مسجلة في قسم "${cat.nameAR}" حالياً</p>
                            <button class="btn-primary sm-btn mt-10" onclick="window.App.openAddMedicineWithCat('${catId}')">
                                <i class='bx bx-plus'></i> إضافة أول دواء هنا
                            </button>
                        </div>
                    ` : ''}
                </div>

                <div class="form-actions mt-15">
                    <button class="btn-ghost w-100" onclick="window.UI.closeModal()">إغلاق</button>
                </div>
            `);
        } catch (err) {
            console.error('Error opening category detail:', err);
            UI.showToast('تعذر فتح تفاصيل التصنيف', 'danger');
        }
    },

    // --- Move Medicine to Another Category ---
    async openMoveCategoryModal(medicineId, sourceCatId = null) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return;
            const cats = await Categories.getAllSorted();
            const currentCat = cats.find(c => c.id === med.categoryId);

            UI.showModal(`
                <div class="modal-header">
                    <h2>نقل الدواء إلى تصنيف آخر</h2>
                </div>
                <div style="background:var(--bg-secondary); padding:12px; border-radius:12px; margin-bottom:15px;">
                    <h3 style="margin:0; font-size:14px; font-weight:800;">${med.nameEN}</h3>
                    <p style="margin:4px 0 0 0; font-size:12px; color:var(--text-muted);">
                        التصنيف الحالي: <strong style="color:var(--primary);">${currentCat ? currentCat.nameAR : med.categoryId}</strong>
                    </p>
                </div>
                <form onsubmit="event.preventDefault(); window.App.saveMoveCategory('${medicineId}', '${sourceCatId || ''}');">
                    <div class="form-group mb-15">
                        <label class="form-label">اختر التصنيف الجديد:</label>
                        <select id="move-target-cat" class="form-select" required>
                            <option value="">-- حدد التصنيف المستهدف --</option>
                            ${cats.filter(c => c.id !== med.categoryId).map(c => `
                                <option value="${c.id}">${c.nameAR} (${c.nameEN || c.id})</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">🔄 تأكيد النقل</button>
                        <button type="button" class="btn-ghost" onclick="${sourceCatId ? `window.App.openCategoryDetailModal('${sourceCatId}')` : 'window.UI.closeModal()'}">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            console.error('Error opening move modal:', err);
            UI.showToast('تعذر فتح نافذة النقل', 'danger');
        }
    },

    async saveMoveCategory(medicineId, sourceCatId) {
        const targetCatId = document.getElementById('move-target-cat')?.value;
        if (!targetCatId) {
            UI.showToast('يرجى اختيار التصنيف المستهدف', 'warning');
            return;
        }

        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return;

            med.categoryId = targetCatId;
            await DB.put('medicineMaster', med);

            const cats = await Categories.getAllSorted();
            const newCat = cats.find(c => c.id === targetCatId);

            UI.showToast(`تم نقل ${med.nameEN || med.nameAR} إلى ${newCat?.nameAR || targetCatId} بنجاح ✅`, 'success');

            if (sourceCatId) {
                this.openCategoryDetailModal(sourceCatId);
            } else {
                UI.closeModal();
                this.renderInventory();
                this.renderWarehouseCategories();
            }
        } catch (err) {
            console.error('Error saving moved category:', err);
            UI.showToast('فشل حفظ النقل', 'danger');
        }
    },

    // --- Master Medicine Action Menu ---
    async openMasterMedicineMenu(medicineId) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return;

            UI.showModal(`
                <div class="modal-header">
                    <h2>خيارات: ${med.nameEN || med.nameAR}</h2>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin:15px 0;">
                    <button class="action-card-btn secondary" onclick="window.App.openEditMedicine('${medicineId}')" style="justify-content:flex-start; padding:12px 16px;">
                        <i class='bx bx-edit-alt' style="font-size:22px; color:var(--primary);"></i>
                        <div class="action-card-text">
                            <strong>تعديل بيانات الدواء</strong>
                            <small>تعديل الاسم، المادة الفعالة، والباركود</small>
                        </div>
                    </button>
                    <button class="action-card-btn secondary" onclick="window.App.openMoveCategoryModal('${medicineId}')" style="justify-content:flex-start; padding:12px 16px;">
                        <i class='bx bx-transfer' style="font-size:22px; color:var(--secondary);"></i>
                        <div class="action-card-text">
                            <strong>نقل إلى تصنيف علاجي آخر</strong>
                            <small>تغيير قسم الدواء في المستودع</small>
                        </div>
                    </button>
                    <button class="action-card-btn secondary" onclick="window.App.deleteMasterMedicine('${medicineId}')" style="justify-content:flex-start; padding:12px 16px; border-color:rgba(239,68,68,0.3);">
                        <i class='bx bx-trash' style="font-size:22px; color:var(--danger);"></i>
                        <div class="action-card-text">
                            <strong style="color:var(--danger);">حذف الصنف نهائياً</strong>
                            <small>إزالة الدواء من قاعدة بيانات المستودع</small>
                        </div>
                    </button>
                </div>
                <div class="form-actions">
                    <button class="btn-ghost w-100" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            `);
        } catch (err) {
            console.error('Error opening med menu:', err);
        }
    },

    // --- Locations CRUD Modals ---
    async openAddLocationModal() {
        const cats = await Categories.getAllSorted();
        UI.showModal(`
            <div class="modal-header"><h2>إضافة مكان تخزين جديد</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveLocationForm();">
                <div class="form-group mb-12">
                    <label class="form-label">اسم المكان (بالعربية):</label>
                    <input type="text" id="loc-name-ar" class="form-input" placeholder="مثال: ثلاجة 2، دولاب التخدير..." required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">الاسم بالإنجليزية (اختياري):</label>
                    <input type="text" id="loc-name-en" class="form-input" placeholder="e.g. Fridge 2">
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">أيقونة المكان (Boxicons):</label>
                    <select id="loc-icon" class="form-select">
                        <option value="bx-clinic">🏥 صيدلية (bx-clinic)</option>
                        <option value="bx-cabinet">🚪 دولاب (bx-cabinet)</option>
                        <option value="bx-fridge">❄️ ثلاجة (bx-fridge)</option>
                        <option value="bx-first-aid">🩹 طوارئ (bx-first-aid)</option>
                        <option value="bx-capsule">💊 كبسولة / استقبال (bx-capsule)</option>
                        <option value="bx-ambulance">🚑 إسعاف (bx-ambulance)</option>
                        <option value="bx-package">📦 صندوق / مخزن (bx-package)</option>
                    </select>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">التصنيفات المسموح بتواجدها في هذا المكان:</label>
                    <div style="max-height: 140px; overflow-y: auto; background: var(--bg-secondary); padding: 8px; border-radius: 8px;">
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:bold;">
                            <input type="checkbox" id="loc-cat-all" onchange="document.querySelectorAll('.loc-cat-item').forEach(cb => cb.checked = this.checked)">
                            <span>تحديد الكل (كافة الأدوية)</span>
                        </label>
                        ${cats.map(c => `
                            <label style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12px;">
                                <input type="checkbox" class="loc-cat-item" value="${c.id}">
                                <span>${c.nameAR}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">وصف المكان:</label>
                    <input type="text" id="loc-desc" class="form-input" placeholder="ملاحظات تخزينية...">
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">حفظ المكان</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async openEditLocationModal(id) {
        const loc = await Locations.get(id);
        if (!loc) return;
        const cats = await Categories.getAllSorted();
        const allowed = new Set(loc.allowedCategories || ['all']);

        UI.showModal(`
            <div class="modal-header"><h2>تعديل مكان التخزين: ${loc.nameAR}</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveLocationForm('${id}');">
                <div class="form-group mb-12">
                    <label class="form-label">اسم المكان:</label>
                    <input type="text" id="loc-name-ar" class="form-input" value="${loc.nameAR}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">أيقونة المكان:</label>
                    <select id="loc-icon" class="form-select">
                        <option value="bx-clinic" ${loc.icon === 'bx-clinic' ? 'selected' : ''}>🏥 صيدلية</option>
                        <option value="bx-cabinet" ${loc.icon === 'bx-cabinet' ? 'selected' : ''}>🚪 دولاب</option>
                        <option value="bx-fridge" ${loc.icon === 'bx-fridge' ? 'selected' : ''}>❄️ ثلاجة</option>
                        <option value="bx-first-aid" ${loc.icon === 'bx-first-aid' ? 'selected' : ''}>🩹 طوارئ</option>
                        <option value="bx-capsule" ${loc.icon === 'bx-capsule' ? 'selected' : ''}>💊 استقبال</option>
                        <option value="bx-ambulance" ${loc.icon === 'bx-ambulance' ? 'selected' : ''}>🚑 إسعاف</option>
                        <option value="bx-package" ${loc.icon === 'bx-package' ? 'selected' : ''}>📦 مخزن</option>
                    </select>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">التصنيفات المسموح بتواجدها في هذا المكان:</label>
                    <div style="max-height: 140px; overflow-y: auto; background: var(--bg-secondary); padding: 8px; border-radius: 8px;">
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:bold;">
                            <input type="checkbox" id="loc-cat-all" ${allowed.has('all') ? 'checked' : ''} onchange="document.querySelectorAll('.loc-cat-item').forEach(cb => cb.checked = this.checked)">
                            <span>كافة الأدوية (بدون قيود)</span>
                        </label>
                        ${cats.map(c => `
                            <label style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12px;">
                                <input type="checkbox" class="loc-cat-item" value="${c.id}" ${allowed.has(c.id) || allowed.has('all') ? 'checked' : ''}>
                                <span>${c.nameAR}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">الوصف:</label>
                    <input type="text" id="loc-desc" class="form-input" value="${loc.description || ''}">
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">حفظ التعديلات</button>
                    <button type="button" class="btn-ghost" style="color:var(--danger)" onclick="window.App.deleteLocationConfirm('${id}')">حذف المكان</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async saveLocationForm(id = null) {
        const isAll = document.getElementById('loc-cat-all')?.checked;
        let selectedCats = [];
        if (isAll) {
            selectedCats = ['all'];
        } else {
            document.querySelectorAll('.loc-cat-item:checked').forEach(cb => selectedCats.push(cb.value));
            if (selectedCats.length === 0) selectedCats = ['all'];
        }

        const data = {
            id: id || undefined,
            nameAR: document.getElementById('loc-name-ar').value.trim(),
            nameEN: document.getElementById('loc-name-en')?.value.trim() || '',
            icon: document.getElementById('loc-icon').value,
            allowedCategories: selectedCats,
            description: document.getElementById('loc-desc').value.trim()
        };

        await Locations.save(data);
        UI.closeModal();
        UI.showToast('تم حفظ مكان التخزين بنجاح ✨', 'success');
        this.renderWarehouseLocations();
    },

    async deleteLocationConfirm(id) {
        if (!confirm('هل أنت متأكد من حذف هذا المكان من المستودع؟')) return;
        await Locations.delete(id);
        UI.closeModal();
        UI.showToast('تم حذف المكان', 'info');
        this.renderWarehouseLocations();
    },

    // --- Categories CRUD Modals ---
    openAddCategoryModal() {
        UI.showModal(`
            <div class="modal-header"><h2>إضافة تصنيف علاجي جديد</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveCategoryForm();">
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف (بالعربية):</label>
                    <input type="text" id="cat-name-ar" class="form-input" placeholder="مثال: أدوية عيون، قطرات..." required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">أيقونة التصنيف:</label>
                    <select id="cat-icon" class="form-select">
                        <option value="bx-capsule">💊 كبسولة</option>
                        <option value="bx-plus-medical">🩺 طبي / عام</option>
                        <option value="bx-injection">💉 حقن</option>
                        <option value="bx-wind">🌬️ جهاز تنفسي</option>
                        <option value="bx-droplet">💧 قطرات / سوائل</option>
                        <option value="bx-heart">❤️ قلب وأوعية</option>
                        <option value="bx-band-aid">🩹 إسعافات</option>
                    </select>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">لون التمييز:</label>
                    <input type="color" id="cat-color" class="form-input" value="#3b82f6" style="height:40px; padding:2px;">
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">حفظ التصنيف</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async openEditCategoryModal(id) {
        const cat = await Categories.getInfo(id);
        UI.showModal(`
            <div class="modal-header"><h2>تعديل التصنيف: ${cat.nameAR}</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveCategoryForm('${id}');">
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف:</label>
                    <input type="text" id="cat-name-ar" class="form-input" value="${cat.nameAR}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">الأيقونة:</label>
                    <select id="cat-icon" class="form-select">
                        <option value="bx-capsule" ${cat.icon === 'bx-capsule' ? 'selected' : ''}>💊 كبسولة</option>
                        <option value="bx-plus-medical" ${cat.icon === 'bx-plus-medical' ? 'selected' : ''}>🩺 طبي / عام</option>
                        <option value="bx-injection" ${cat.icon === 'bx-injection' ? 'selected' : ''}>💉 حقن</option>
                        <option value="bx-wind" ${cat.icon === 'bx-wind' ? 'selected' : ''}>🌬️ تنفسي</option>
                        <option value="bx-droplet" ${cat.icon === 'bx-droplet' ? 'selected' : ''}>💧 قطرات</option>
                    </select>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">اللون:</label>
                    <input type="color" id="cat-color" class="form-input" value="${cat.color || '#3b82f6'}" style="height:40px; padding:2px;">
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">حفظ التعديلات</button>
                    <button type="button" class="btn-ghost" style="color:var(--danger)" onclick="window.App.deleteCategoryConfirm('${id}')">حذف التصنيف</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async saveCategoryForm(id = null) {
        const data = {
            id: id || Utils.generateId(),
            nameAR: document.getElementById('cat-name-ar').value.trim(),
            icon: document.getElementById('cat-icon').value,
            color: document.getElementById('cat-color').value
        };
        await Categories.saveCategory(data);
        UI.closeModal();
        UI.showToast('تم حفظ التصنيف بنجاح ✨', 'success');
        this.renderWarehouseCategories();
        this.renderCategoryChips();
    },

    async deleteCategoryConfirm(id) {
        if (!confirm('حذف هذا القسم؟ لن يتم حذف الأدوية التابعة له بل ستحتاج لإعادة تصنيفها.')) return;
        await Categories.deleteCategory(id);
        UI.closeModal();
        UI.showToast('تم حذف التصنيف', 'info');
        this.renderWarehouseCategories();
        this.renderCategoryChips();
    },

    // =========================================================================
    // --- HIERARCHICAL AUDIT WORKFLOW (v18.0.0 Dedicated Engine) ---
    // =========================================================================

    async renderAuditView() {
        const container = document.getElementById('audit-main-container');
        if (!container) return;

        // If no active session or at root level: show sessions dashboard
        if (!this.selectedAuditSessionId || this.auditLevel === 'sessions') {
            await this.renderAuditSessionsLevel(container);
            return;
        }

        const session = await Audit.getSession(this.selectedAuditSessionId);
        if (!session) {
            this.auditLevel = 'sessions';
            await this.renderAuditSessionsLevel(container);
            return;
        }

        // LEVEL 2: Locations Grid inside Session
        if (this.auditLevel === 'locations') {
            await this.renderAuditLocationsLevel(container, session);
            return;
        }

        // LEVEL 3: Categories Grid inside Location
        if (this.auditLevel === 'categories') {
            await this.renderAuditCategoriesLevel(container, session);
            return;
        }

        // LEVEL 4: Medicines Grid inside Category with Smart Sorting
        if (this.auditLevel === 'medicines') {
            await this.renderAuditMedicinesLevel(container, session);
            return;
        }
    },

    async renderAuditSessionsLevel(container) {
        const sessions = await Audit.getAllSessions();
        const activeSessions = sessions.filter(s => s.status !== 'finalized' && !s.isArchived);
        const closedSessions = sessions.filter(s => s.status === 'finalized' || s.isArchived);
        const activeUser = Users.getActive();
        const allTeam = Users.getAll();

        container.innerHTML = `
            <div class="view-header">
                <div class="header-left">
                    <h2>مركز عمليات الجرد الميداني</h2>
                    <p class="text-muted small">جرد منظم وهرمي: جلسة ⬅️ أماكن ⬅️ تصنيفات ⬅️ أدوية</p>
                </div>
                <button class="btn-primary sm-btn" onclick="window.App.openNewAuditModal()">
                    <i class='bx bx-plus'></i> بدء جرد جديد
                </button>
            </div>

            <!-- Active / On-Hold Sessions -->
            <div class="section-title mt-15 mb-10" style="display:flex; justify-content:space-between; align-items:center;">
                <h3><i class='bx bx-play-circle'></i> الجلسات الجارية والمعلقة (${activeSessions.length})</h3>
            </div>
            
            ${activeSessions.length === 0 ? `
                <div class="empty-state mb-20" style="padding: 25px; text-align: center; background: var(--surface); border-radius: 16px; border: 1px dashed var(--border-color);">
                    <i class='bx bx-clipboard' style="font-size: 38px; color: var(--primary); opacity: 0.6;"></i>
                    <h3 style="margin: 8px 0 4px 0; font-size: 15px;">لا توجد جلسة جرد جارية حالياً</h3>
                    <p class="text-muted small mb-12">ابدأ جرد جديد مستقل وحدد الأماكن لبدء العد الميداني النظيف</p>
                    <button class="btn-primary sm-btn" onclick="window.App.openNewAuditModal()">+ بدء جرد جديد الآن</button>
                </div>
            ` : `
                <div class="sessions-list mb-25" style="display: flex; flex-direction: column; gap: 12px;">
                    ${activeSessions.map(s => {
                        const isHold = s.status === 'on_hold';
                        const countKeys = Object.keys(s.counts || {}).length;
                        return `
                            <div class="card p-15" style="background: var(--surface); border-radius: 16px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="badge ${isHold ? 'bg-soft text-warning' : 'bg-primary text-white'}" style="padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;">
                                            ${isHold ? '⏸️ معلقة' : '🟢 جارية'}
                                        </span>
                                        <span class="badge ${s.type === 'group' ? 'bg-info' : 'bg-secondary'}" style="padding: 3px 8px; border-radius: 6px; font-size: 11px;">
                                            ${s.type === 'group' ? '👥 جماعي' : '👤 فردي'}
                                        </span>
                                        <h3 style="margin: 0; font-size: 15px; font-weight: 800;">${s.name}</h3>
                                    </div>
                                    <span style="font-size: 11px; color: var(--text-muted);">${new Date(s.startedAt).toLocaleDateString('ar-EG')}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; flex-wrap: wrap; gap: 8px;">
                                    <span style="font-size: 12px; font-weight: 700; color: var(--text-muted);">
                                        <i class='bx bx-check-circle' style="color: var(--secondary)"></i> تم إحصاء: <strong>${countKeys} صنف</strong>
                                    </span>
                                    <div style="display: flex; gap: 6px; align-items: center;">
                                        <button class="btn-primary sm-btn" onclick="window.App.openAuditSession('${s.id}')" title="متابعة العد">
                                            ▶️ متابعة الجرد
                                        </button>
                                        ${!isHold ? `
                                            <button class="btn-ghost sm-btn" onclick="window.App.holdAuditSession('${s.id}')" title="تعليق مؤقت">
                                                ⏸️
                                            </button>
                                        ` : `
                                            <button class="btn-ghost sm-btn" onclick="window.App.resumeAuditSession('${s.id}')" title="استئناف">
                                                ▶️
                                            </button>
                                        `}
                                        <button class="btn-ghost sm-btn text-danger" onclick="window.App.finalizeAuditSession('${s.id}')" title="إنهاء واعتماد وتحديث المستودع">
                                            🏁
                                        </button>
                                        <button class="icon-btn" onclick="window.App.openEditAuditSessionModal('${s.id}')" title="تعديل بيانات الجلسة" style="padding: 4px;">
                                            <i class='bx bx-edit-alt' style="font-size: 16px;"></i>
                                        </button>
                                        <button class="icon-btn text-warning" onclick="window.App.archiveAuditSession('${s.id}')" title="أرشفة الجلسة" style="padding: 4px;">
                                            <i class='bx bx-archive-in' style="font-size: 16px; color: var(--accent);"></i>
                                        </button>
                                        <button class="icon-btn text-danger" onclick="window.App.deleteAuditSession('${s.id}')" title="حذف الجلسة نهائياً" style="padding: 4px;">
                                            <i class='bx bx-trash' style="font-size: 16px; color: var(--danger);"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}

            <!-- Closed / Completed / Archived Sessions -->
            <div class="section-title mb-10" style="display:flex; justify-content:space-between; align-items:center;">
                <h3><i class='bx bx-archive'></i> أرشيف الجلسات المعتمدة والسابقة (${closedSessions.length})</h3>
            </div>
            ${closedSessions.length > 0 ? `
                <div class="sessions-list" style="display: flex; flex-direction: column; gap: 10px;">
                    ${closedSessions.map(s => {
                        const countKeys = Object.keys(s.counts || {}).length;
                        const isFinal = s.status === 'finalized';
                        return `
                            <div class="card p-12" style="background: var(--surface); border: 1px solid var(--border-color); border-radius: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                <div>
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span class="badge ${isFinal ? 'bg-success' : 'bg-secondary'}" style="font-size: 10px; padding: 2px 6px; border-radius: 4px;">
                                            ${isFinal ? 'معتمد 🏁' : 'مؤرشف 📦'}
                                        </span>
                                        <strong style="font-size: 14px;">${s.name}</strong>
                                    </div>
                                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: flex; gap: 8px;">
                                        <span><i class='bx bx-user'></i> ${s.host || 'النظام'}</span>
                                        <span>&bull;</span>
                                        <span><i class='bx bx-layer'></i> ${countKeys} صنف مجرود</span>
                                        <span>&bull;</span>
                                        <span><i class='bx bx-calendar'></i> ${new Date(s.finalizedAt || s.startedAt).toLocaleDateString('ar-EG')}</span>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 6px; align-items: center;">
                                    <button class="btn-ghost sm-btn" onclick="window.App.openAuditReportModal('${s.id}')" title="عرض تفاصيل الجرد">
                                        <i class='bx bx-show'></i> عرض الكشف
                                    </button>
                                    <button class="btn-ghost sm-btn" onclick="window.App.exportAuditSession('${s.id}')" title="تصدير كملف إكسيل">
                                        <i class='bx bx-download'></i> Excel
                                    </button>
                                    <button class="icon-btn text-warning" onclick="window.App.unarchiveAuditSession('${s.id}')" title="استعادة للنشط" style="padding: 4px;">
                                        <i class='bx bx-undo' style="font-size: 16px;"></i>
                                    </button>
                                    <button class="icon-btn text-danger" onclick="window.App.deleteAuditSession('${s.id}')" title="حذف نهائياً" style="padding: 4px;">
                                        <i class='bx bx-trash' style="font-size: 16px; color: var(--danger);"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `
                <p class="text-muted small" style="text-align: center; padding: 15px;">لا توجد جلسات مؤرشفة أو معتمدة سابقة حتى الآن</p>
            `}
        `;
    },

    // --- Session CRUD & Management Handlers ---
    async openEditAuditSessionModal(sessionId) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session) return;
            const allLocs = (await Locations.getAll()) || [];
            const sessionLocSet = new Set(session.locationIds || []);

            UI.showModal(`
                <div class="modal-header">
                    <h2>تعديل جلسة الجرد</h2>
                </div>
                <form onsubmit="event.preventDefault(); window.App.saveEditAuditSession('${sessionId}');">
                    <div class="form-group mb-12">
                        <label class="form-label">اسم الجلسة:</label>
                        <input type="text" id="edit-session-name" class="form-input" value="${session.name}" required>
                    </div>
                    <div class="form-group mb-12">
                        <label class="form-label">نوع الجرد:</label>
                        <select id="edit-session-type" class="form-select">
                            <option value="individual" ${session.type === 'individual' ? 'selected' : ''}>👤 فردي (Express)</option>
                            <option value="group" ${session.type === 'group' ? 'selected' : ''}>👥 جماعي (Team / Cloud Sync)</option>
                        </select>
                    </div>
                    <div class="form-group mb-15">
                        <label class="form-label">الأماكن المشمولة في هذه الجلسة:</label>
                        <div style="display:flex; flex-direction:column; gap:6px; max-height:160px; overflow-y:auto; padding:4px; border:1px solid var(--border-color); border-radius:8px;">
                            ${allLocs.map(loc => `
                                <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">
                                    <input type="checkbox" class="edit-session-loc-cb" value="${loc.id}" ${sessionLocSet.has(loc.id) ? 'checked' : ''}>
                                    <span>${loc.nameAR}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn-primary">💾 حفظ التعديلات</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            console.error('Error editing audit session:', err);
            UI.showToast('تعذر فتح نافذة التعديل', 'danger');
        }
    },

    async saveEditAuditSession(sessionId) {
        const name = document.getElementById('edit-session-name')?.value.trim();
        const type = document.getElementById('edit-session-type')?.value;
        const cbs = document.querySelectorAll('.edit-session-loc-cb:checked');
        const locationIds = Array.from(cbs).map(cb => cb.value);

        if (!name) {
            UI.showToast('يرجى إدخال اسم الجلسة', 'warning');
            return;
        }

        if (locationIds.length === 0) {
            UI.showToast('يرجى تحديد مكان واحد على الأقل', 'warning');
            return;
        }

        await Audit.updateSession(sessionId, { name, type, locationIds });
        UI.closeModal();
        UI.showToast('تم تحديث بيانات الجلسة بنجاح ✅', 'success');
        this.renderAuditView();
    },

    async deleteAuditSession(sessionId) {
        const session = await Audit.getSession(sessionId);
        const sName = session?.name || 'هذه الجلسة';

        if (!confirm(`تحذير: هل أنت متأكد من حذف "${sName}" نهائياً؟\nسيتم مسح كافة سجلات العد المرتبطة بها ولن يمكن استعادتها.`)) {
            return;
        }

        await Audit.deleteSession(sessionId);
        UI.showToast('تم حذف الجلسة وسجلاتها نهائياً 🗑️', 'info');
        this.renderAuditView();
    },

    async archiveAuditSession(sessionId) {
        await Audit.archiveSession(sessionId);
        UI.showToast('تم نقل الجلسة إلى الأرشيف بنجاح 📦', 'success');
        this.renderAuditView();
    },

    async unarchiveAuditSession(sessionId) {
        await Audit.unarchiveSession(sessionId);
        UI.showToast('تمت استعادة الجلسة من الأرشيف ↩️', 'success');
        this.renderAuditView();
    },

    async openAuditReportModal(sessionId) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session) return;
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const locs = (await Locations.getAll()) || [];
            const locMap = new Map(locs.map(l => [l.id, l.nameAR]));

            const counts = session.counts || {};
            const items = [];
            for (const [key, record] of Object.entries(counts)) {
                const [locId, medId] = key.split('___');
                const med = masterMap.get(medId) || { nameEN: 'Unknown', nameAR: 'غير معروف' };
                const loc = locMap.get(locId) || 'المستودع';
                const batches = (record.batches && record.batches.length > 0)
                    ? record.batches
                    : [{ quantity: record.quantity, expiryDate: record.expiryDate }];
                for (const b of batches) {
                    items.push({
                        medName: med.nameEN || med.nameAR,
                        medAR: med.nameAR,
                        location: loc,
                        quantity: b.quantity,
                        expiryDate: b.expiryDate || '2027-12',
                        countedBy: record.userName || session.host
                    });
                }
            }

            const totalQty = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);

            UI.showModal(`
                <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:12px;">
                    <div>
                        <h2 style="margin:0; font-size:16px;">📋 كشف تفاصيل: ${session.name}</h2>
                        <small class="text-muted">تاريخ الاعتماد: ${new Date(session.finalizedAt || session.startedAt).toLocaleDateString('ar-EG')} | القائم بالجرد: ${session.host || 'خالد'}</small>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(59,130,246,0.08); border-radius:8px; margin-bottom:12px;">
                    <span style="font-size:12px; font-weight:bold;">إجمالي الأصناف: ${Object.keys(counts).length} صنف</span>
                    <span style="font-size:12px; font-weight:800; color:var(--primary);">مجموع الوحدات: ${totalQty} وحدة</span>
                </div>

                <div style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                    ${items.map(item => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--bg-secondary); border-radius:8px; font-size:12px;">
                            <div>
                                <strong style="display:block;">${item.medName}</strong>
                                <small class="text-muted"><i class='bx bx-map-pin'></i> ${item.location} &bull; الصلاحية: ${item.expiryDate}</small>
                            </div>
                            <span class="badge bg-primary text-white" style="font-size:12px; padding:3px 8px; border-radius:6px; font-weight:800;">
                                ${item.quantity} وحدة
                            </span>
                        </div>
                    `).join('')}
                    ${items.length === 0 ? '<p class="text-center p-20 text-muted">لم يتم تسجيل كميات في هذه الجلسة</p>' : ''}
                </div>

                <div class="form-actions mt-15" style="display:flex; gap:8px;">
                    <button class="btn-primary sm-btn" onclick="window.App.exportAuditSession('${sessionId}')" style="flex:1;">
                        <i class='bx bx-download'></i> تصدير إكسيل (Excel)
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.UI.closeModal()" style="flex:0.6;">إغلاق</button>
                </div>
            `);
        } catch (err) {
            console.error('Error opening audit report:', err);
            UI.showToast('تعذر عرض كشف الجلسة', 'danger');
        }
    },

    async exportAuditSession(sessionId) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session) return;
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const locs = (await Locations.getAll()) || [];
            const locMap = new Map(locs.map(l => [l.id, l.nameAR]));

            const counts = session.counts || {};
            const exportRows = [];

            for (const [key, record] of Object.entries(counts)) {
                const [locId, medId] = key.split('___');
                const med = masterMap.get(medId) || { nameEN: 'Unknown', nameAR: 'غير معروف' };
                const loc = locMap.get(locId) || 'المستودع';
                const batches = (record.batches && record.batches.length > 0)
                    ? record.batches
                    : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

                for (const b of batches) {
                    exportRows.push({
                        'اسم الدواء (EN)': med.nameEN || '',
                        'اسم الدواء (AR)': med.nameAR || '',
                        'مكان التخزين': loc,
                        'الكمية المحصورة': b.quantity,
                        'تاريخ الصلاحية': b.expiryDate,
                        'المسؤول عن العد': record.userName || session.host,
                        'تاريخ التسجيل': new Date(record.countedAt || session.startedAt).toLocaleString('ar-EG')
                    });
                }
            }

            if (exportRows.length === 0) {
                UI.showToast('لا توجد بيانات لتصديرها في هذه الجلسة', 'warning');
                return;
            }

            if (window.XLSX) {
                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "تقرير الجرد");
                XLSX.writeFile(wb, `جرد_${session.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}.xlsx`);
                UI.showToast('تم تصدير ملف الإكسيل بنجاح ✅', 'success');
            } else {
                UI.showToast('مكتبة تصدير Excel غير متوفرة', 'danger');
            }
        } catch (err) {
            console.error('Export session error:', err);
            UI.showToast('فشل تصدير الإكسيل', 'danger');
        }
    },

    async renderAuditLocationsLevel(container, session) {
        const allLocs = await Locations.getAll();
        const sessionLocIds = new Set(session.locationIds || []);
        const activeLocations = allLocs.filter(l => sessionLocIds.has(l.id));

        container.innerHTML = `
            <!-- Breadcrumbs Bar -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditBackToSessions()" title="العودة للجلسات">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToSessions()" style="cursor:pointer">الجلسات</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">${session.name}</span>
                </div>
            </div>

            <!-- Session Control Bar -->
            <div class="session-control-bar">
                <div class="ctrl-info">
                    <h3>${session.name}</h3>
                    <span style="font-size: 11px; color: var(--text-muted);">
                        الحالة: ${session.status === 'on_hold' ? '⏸️ معلقة' : '🟢 جارية'} | النمط: ${session.type === 'group' ? '👥 جماعي' : '👤 فردي'}
                    </span>
                </div>
                <div class="ctrl-actions">
                    ${session.status !== 'on_hold' ? `
                        <button class="btn-ghost sm-btn" onclick="window.App.holdAuditSession('${session.id}')">
                            <i class='bx bx-pause'></i> تعليق
                        </button>
                    ` : `
                        <button class="btn-ghost sm-btn" onclick="window.App.resumeAuditSession('${session.id}')">
                            <i class='bx bx-play'></i> استئناف
                        </button>
                    `}
                    <button class="btn-primary sm-btn" onclick="window.App.finalizeAuditSession('${session.id}')">
                        <i class='bx bx-check'></i> إنهاء واعتماد
                    </button>
                </div>
            </div>

            <div class="section-title mb-12">
                <h3><i class='bx bx-map-pin'></i> اختر المكان لبدء الجرد الميداني:</h3>
            </div>

            <!-- Square Locations Grid -->
            <div class="audit-square-grid">
                ${await Promise.all(activeLocations.map(async (loc) => {
                    const stats = await Audit.getLocationStats(session.id, loc.id);
                    return `
                        <div class="square-card" onclick="window.App.openAuditLocation('${loc.id}')">
                            <i class='bx ${loc.icon || 'bx-map-pin'} square-icon' style="color: ${loc.color || 'var(--primary)'}"></i>
                            <h3>${loc.nameAR}</h3>
                            <span class="square-meta">${stats.counted} / ${stats.total} تم جردها</span>
                            <div style="width: 80%; height: 4px; background: var(--border-color); border-radius: 2px; margin-top: 8px; overflow: hidden;">
                                <div style="width: ${stats.progress}%; height: 100%; background: #10b981; border-radius: 2px;"></div>
                            </div>
                        </div>
                    `;
                })).then(cards => cards.join(''))}
            </div>
        `;
    },

    async renderAuditCategoriesLevel(container, session) {
        const loc = await Locations.get(this.selectedAuditLocationId);
        if (!loc) return this.auditBackToLocations();

        const categories = await Locations.getCategoriesForLocation(loc.id);

        container.innerHTML = `
            <!-- Breadcrumbs Bar -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditBackToLocations()" title="العودة للأماكن">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToSessions()" style="cursor:pointer">الجلسات</span>
                    <i class='bx bx-chevron-left'></i>
                    <span onclick="window.App.auditBackToLocations()" style="cursor:pointer">${loc.nameAR}</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">التصنيفات</span>
                </div>
            </div>

            <div class="section-title mb-12">
                <h3><i class='bx ${loc.icon || 'bx-map-pin'}'></i> أقسام الأدوية في "${loc.nameAR}":</h3>
                <p class="text-muted small">اختر القسم لاستعراض الأدوية وتسجيل الأرصدة</p>
            </div>

            <!-- Square Categories Grid -->
            <div class="audit-square-grid">
                ${await Promise.all(categories.map(async (cat) => {
                    const meds = await Locations.getMedicinesForLocation(loc.id, cat.id);
                    return `
                        <div class="square-card" onclick="window.App.openAuditCategory('${cat.id}')">
                            <i class='bx ${cat.icon || 'bx-category'} square-icon' style="color: ${cat.color || 'var(--primary)'}"></i>
                            <h3>${cat.nameAR}</h3>
                            <span class="square-meta">${meds.length} صنف دواء</span>
                        </div>
                    `;
                })).then(cards => cards.join(''))}
            </div>
        `;
    },

    
    // --- User & Team Management Handlers (v18.4.0) ---
    
    // =========================================================================
    // --- USER MANAGEMENT & SETTINGS (v18.5.0 Centralized in Settings) ---
    // =========================================================================

    openUserSettingsManager() {
        const team = Users.getAll();
        const active = Users.getActive();

        UI.showModal(`
            <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h2 style="font-size:18px; margin:0; display:flex; align-items:center; gap:8px;">
                        <i class='bx bx-group' style="color:var(--primary);"></i> إدارة فريق العمل والمستخدمين
                    </h2>
                    <p class="text-muted small" style="margin:4px 0 0 0;">إدارة الحسابات، الصلاحيات، تعيين المستخدم النشط، وإضافة أو حذف الأعضاء</p>
                </div>
                <button type="button" class="btn-primary sm-btn" onclick="window.App.openAddUserModal()" style="font-size:12px; font-weight:bold; background:#10b981; display:flex; align-items:center; gap:4px;">
                    <i class='bx bx-user-plus'></i> ➕ إضافة مستخدم جديد
                </button>
            </div>

            <!-- Active User Spotlight Banner -->
            <div class="card p-12 mb-15" style="background: rgba(59,130,246,0.06); border: 1.5px solid var(--primary); border-radius: 12px; display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:42px; height:42px; border-radius:10px; background:var(--primary); color:white; display:flex; align-items:center; justify-content:center; font-size:22px;">
                        <i class='bx bx-user-check'></i>
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:bold; color:var(--text-muted);">المستخدم النشط حالياً بالنظام:</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <strong style="font-size:15px; color:var(--text-main);">${active.name}</strong>
                            <span class="badge ${active.role === 'admin' ? 'bg-primary text-white' : 'bg-secondary'}" style="font-size:10px; padding:2px 6px; border-radius:4px;">
                                ${active.role === 'admin' ? 'مدير 🛡️' : 'صيدلي 💊'}
                            </span>
                        </div>
                        <small style="color:var(--text-muted); font-size:11px;">${active.title || 'مسؤول الصيدلية'}</small>
                    </div>
                </div>
                <span class="badge" style="background:#10b981; color:white; font-size:11px; padding:4px 8px; border-radius:6px; font-weight:bold;">
                    <i class='bx bx-check'></i> نشط الآن
                </span>
            </div>

            <!-- Users List -->
            <div style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto; margin-bottom:16px; padding:2px;">
                ${team.map(member => {
                    const isActive = member.id === active.id;
                    return `
                        <div class="card p-10" style="display:flex; align-items:center; justify-content:space-between; border-radius:12px; background:var(--surface); border:1px solid ${isActive ? 'var(--primary)' : 'var(--border-color)'}; transition:all 0.2s ease;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:38px; height:38px; border-radius:10px; background:${member.color || 'var(--primary)'}22; color:${member.color || 'var(--primary)'}; display:flex; align-items:center; justify-content:center; font-size:18px;">
                                    <i class='bx ${member.icon || 'bx-user'}'></i>
                                </div>
                                <div>
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        <strong style="font-size:14px;">${member.name}</strong>
                                        <span class="badge ${member.role === 'admin' ? 'bg-primary text-white' : 'bg-secondary'}" style="font-size:10px; padding:1px 5px; border-radius:4px;">
                                            ${member.role === 'admin' ? 'مدير 🛡️' : 'صيدلي 💊'}
                                        </span>
                                    </div>
                                    <small style="color:var(--text-muted); font-size:11px;">${member.title || 'عضو فريق'}</small>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                ${!isActive ? `
                                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.setActiveUserFromSettings('${member.id}')" style="font-size:11px; padding:4px 8px;" title="تسجيل الدخول والتعيين كنشط">
                                        <i class='bx bx-check'></i> تعيين
                                    </button>
                                ` : ''}
                                <button type="button" class="icon-btn" onclick="window.App.openEditUserModal('${member.id}')" title="تعديل البيانات والصلاحيات" style="padding:5px;">
                                    <i class='bx bx-edit-alt' style="font-size:16px;"></i>
                                </button>
                                <button type="button" class="icon-btn text-danger" onclick="window.App.deleteUserFromSettings('${member.id}')" title="حذف المستخدم" ${isActive ? 'disabled style="opacity:0.3; cursor:not-allowed; padding:5px;"' : 'style="padding:5px;"'}>
                                    <i class='bx bx-trash' style="font-size:16px; color:${isActive ? 'var(--text-muted)' : 'var(--danger)'};"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="form-actions">
                <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إغلاق</button>
            </div>
        `);
    },

    openAddUserModal() {
        UI.showModal(`
            <div class="modal-header">
                <h2><i class='bx bx-user-plus' style="color:var(--primary);"></i> إضافة مستخدم / صيدلي جديد</h2>
            </div>
            <form onsubmit="event.preventDefault(); window.App.saveNewUserFromSettings();">
                <div class="form-group mb-12">
                    <label class="form-label">الاسم الكامل:</label>
                    <input type="text" id="setting-user-name" class="form-input" placeholder="مثال: د. حسام" required autofocus>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">المسمى الوظيفي / التخصص:</label>
                    <input type="text" id="setting-user-title" class="form-input" placeholder="مثال: صيدلي مستودع / صيدلي استقبال" value="صيدلي أول">
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">الصلاحيات في النظام:</label>
                    <select id="setting-user-role" class="form-select">
                        <option value="staff" selected>صيدلي (Staff - تسجيل عد وجرد)</option>
                        <option value="admin">مدير مسؤول (Admin - كامل الصلاحيات والاعتماد)</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">💾 إضافة المستخدم</button>
                    <button type="button" class="btn-ghost" onclick="window.App.openUserSettingsManager()">إلغاء والعودة</button>
                </div>
            </form>
        `);
    },

    saveNewUserFromSettings() {
        const nameEl = document.getElementById('setting-user-name');
        const titleEl = document.getElementById('setting-user-title');
        const roleEl = document.getElementById('setting-user-role');
        if (!nameEl || !nameEl.value.trim()) return;

        Users.addUser({
            name: nameEl.value.trim(),
            title: titleEl?.value.trim() || '',
            role: roleEl?.value || 'staff'
        });

        this.openUserSettingsManager();
    },

    openEditUserModal(userId) {
        const team = Users.getAll();
        const user = team.find(u => u.id === userId);
        if (!user) return;

        UI.showModal(`
            <div class="modal-header">
                <h2><i class='bx bx-edit' style="color:var(--primary);"></i> تعديل بيانات المستخدم</h2>
            </div>
            <form onsubmit="event.preventDefault(); window.App.saveEditUserFromSettings('${user.id}');">
                <div class="form-group mb-12">
                    <label class="form-label">الاسم:</label>
                    <input type="text" id="edit-user-name" class="form-input" value="${user.name}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">المسمى الوظيفي:</label>
                    <input type="text" id="edit-user-title" class="form-input" value="${user.title || ''}">
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">الصلاحيات:</label>
                    <select id="edit-user-role" class="form-select">
                        <option value="staff" ${user.role !== 'admin' ? 'selected' : ''}>صيدلي (Staff)</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>مدير مسؤول (Admin)</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">💾 حفظ التعديلات</button>
                    <button type="button" class="btn-ghost" onclick="window.App.openUserSettingsManager()">إلغاء</button>
                </div>
            </form>
        `);
    },

    saveEditUserFromSettings(userId) {
        const nameEl = document.getElementById('edit-user-name');
        const titleEl = document.getElementById('edit-user-title');
        const roleEl = document.getElementById('edit-user-role');
        if (!nameEl || !nameEl.value.trim()) return;

        Users.updateUser(userId, {
            name: nameEl.value.trim(),
            title: titleEl?.value.trim() || '',
            role: roleEl?.value || 'staff'
        });

        const active = Users.getActive();
        if (active.id === userId) {
            this.currentUser = active;
            this.userName = active.name;
            this.userRole = active.role;
            this.user = { uid: active.id, displayName: active.name, role: active.role };
        }

        this.openUserSettingsManager();
    },

    deleteUserFromSettings(userId) {
        const team = Users.getAll();
        const user = team.find(u => u.id === userId);
        if (!user) return;

        if (!confirm(`هل أنت متأكد من حذف المستخدم "${user.name}" من النظام؟`)) return;
        const res = Users.deleteUser(userId);
        if (res) {
            this.openUserSettingsManager();
        }
    },

    setActiveUserFromSettings(userId) {
        const team = Users.getAll();
        const user = team.find(u => u.id === userId);
        if (user) {
            Users.setActive(user);
            this.currentUser = user;
            this.userName = user.name;
            this.userRole = user.role;
            this.user = { uid: user.id, displayName: user.name, role: user.role };
            if (UI.currentView === 'dashboard') this.renderDashboard();
            this.openUserSettingsManager();
        }
    },

    openUserSwitcherModal() {
        this.openUserSettingsManager();
    },

    getActiveUserName() {
        return (typeof Users !== 'undefined' && Users.getActive()) ? Users.getActive().name : (this.userName || 'خالد');
    },

    async joinGroupAuditSession(sessionId) {
        const active = Users.getActive();
        await Audit.joinSession(sessionId, active.name);
        this.renderAuditView();
    },

    async recordZeroCountModal(medicineId) {
        if (!confirm('هل تريد تسجيل هذا الصنف كغير متوفر (رصيد صفر) في هذا المكان؟')) return;
        await Audit.recordCount(this.selectedAuditSessionId, this.selectedAuditLocationId, medicineId, {
            batches: [{ quantity: 0, expiryDate: '2027-12' }]
        });
        UI.closeModal();
        UI.showToast('تم تسجيل رصيد الصنف كـ صفر (0) بنجاح ✅', 'info');
        this.renderAuditView();
    },

    setAuditFilter(filterType) {
        this.auditMedFilter = filterType;
        this.renderAuditView();
    },

    handleAuditMedSearch(query) {
        this.auditMedSearch = query;
        this.renderAuditView();
    },

    async renderAuditMedicinesLevel(container, session) {
        const loc = await Locations.get(this.selectedAuditLocationId);
        const cat = await Categories.getInfo(this.selectedAuditCategoryId);
        if (!loc || !cat) return this.auditBackToCategories();

        const allMedicines = await Audit.getMedicinesWithAuditStatus(session.id, loc.id, cat.id);
        const totalCount = allMedicines.length;
        const uncountedCount = allMedicines.filter(m => !m.isCounted).length;
        const countedCount = allMedicines.filter(m => m.isCounted).length;
        const progressPct = totalCount > 0 ? Math.round((countedCount / totalCount) * 100) : 0;

        // Apply Live Filters & Search
        const currentFilter = this.auditMedFilter || 'all';
        const currentSearch = (this.auditMedSearch || '').trim().toLowerCase();

        let filteredMedicines = allMedicines;
        if (currentFilter === 'uncounted') {
            filteredMedicines = filteredMedicines.filter(m => !m.isCounted);
        } else if (currentFilter === 'counted') {
            filteredMedicines = filteredMedicines.filter(m => m.isCounted);
        }

        if (currentSearch) {
            filteredMedicines = filteredMedicines.filter(m =>
                (m.nameEN && m.nameEN.toLowerCase().includes(currentSearch)) ||
                (m.nameAR && m.nameAR.includes(currentSearch)) ||
                (m.id && m.id.toLowerCase().includes(currentSearch))
            );
        }

        const activeUser = Users.getActive();

        container.innerHTML = `
            <!-- Breadcrumbs Bar -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditBackToCategories()" title="العودة للتصنيفات">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToLocations()" style="cursor:pointer">${loc.nameAR}</span>
                    <i class='bx bx-chevron-left'></i>
                    <span onclick="window.App.auditBackToCategories()" style="cursor:pointer">${cat.nameAR}</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">الأدوية (${totalCount})</span>
                </div>
            </div>

            <!-- Active User & Progress Banner -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted);">
                    <i class='bx bx-user-check' style="color:var(--primary); font-size:15px;"></i>
                    <span>الصيدلي القائم بالعد: <strong style="color:var(--text-main);">${activeUser.name}</strong></span>
                </div>

                <div style="font-size:11px; font-weight:700; color:var(--text-muted); display:flex; align-items:center; gap:8px;">
                    <span>إنجاز القسم: <strong>${progressPct}%</strong></span>
                    <div style="width:70px; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                        <div style="width:${progressPct}%; height:100%; background:#10b981; border-radius:3px;"></div>
                    </div>
                </div>
            </div>

            <!-- Group Session Collaborative Participants Bar -->
            ${session.type === 'group' ? `
                <div class="audit-team-banner">
                    <div style="display:flex; align-items:center; gap:6px; font-size:12px;">
                        <strong style="color:#0284c7;"><i class='bx bx-group'></i> الفريق المشارك:</strong>
                        <div style="display:flex; gap:4px; flex-wrap:wrap;">
                            ${(session.participants || []).map(p => `
                                <span class="badge bg-info" style="font-size:10px; padding:2px 6px; border-radius:4px;">${p}</span>
                            `).join('')}
                        </div>
                    </div>
                    ${!(session.participants || []).includes(activeUser.name) ? `
                        <button class="btn-ghost sm-btn" onclick="window.App.joinGroupAuditSession('${session.id}')" style="font-size:11px; padding:2px 8px;">
                            <i class='bx bx-user-plus'></i> انضمام للفريق
                        </button>
                    ` : ''}
                </div>
            ` : ''}

            <!-- Toolbar: Quick Search & Filter Chips -->
            <div class="audit-toolbar">
                <div class="audit-search-wrapper">
                    <i class='bx bx-search'></i>
                    <input type="text" id="audit-med-search" class="audit-search-input" placeholder="بحث سريع باسم الدواء الإنجليزي أو العربي..." value="${this.auditMedSearch || ''}" oninput="window.App.handleAuditMedSearch(this.value)">
                </div>
                <div class="audit-filters-row">
                    <button type="button" class="audit-filter-chip ${currentFilter === 'all' ? 'active' : ''}" onclick="window.App.setAuditFilter('all')">
                        الكل (${totalCount})
                    </button>
                    <button type="button" class="audit-filter-chip ${currentFilter === 'uncounted' ? 'active' : ''}" onclick="window.App.setAuditFilter('uncounted')">
                        ⏳ بانتظار العد (${uncountedCount})
                    </button>
                    <button type="button" class="audit-filter-chip ${currentFilter === 'counted' ? 'active' : ''}" onclick="window.App.setAuditFilter('counted')">
                        ✅ تم العد (${countedCount})
                    </button>
                </div>
            </div>

            <!-- Square Medicines Grid with Smart Sorting -->
            ${filteredMedicines.length === 0 ? `
                <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                    <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة لبحثك أو الفلتر المحدد</p>
                </div>
            ` : `
                <div class="audit-square-grid">
                    ${filteredMedicines.map(med => {
                        const imgUrl = Categories.getMedicineImage(med);
                        if (med.isCounted) {
                            const batchesHtml = (med.batches && med.batches.length > 0)
                                ? med.batches.map(b => {
                                    const badge = window.App.calcExpiryBadge(b.expiryDate);
                                    return `
                                        <span class="batch-exterior-pill" style="display:inline-flex; align-items:center; justify-content:center; gap:2px; font-size:9px; font-weight:bold; padding:1px 5px; border-radius:4px; background:${badge.bg}; color:${badge.color}; border:1px solid ${badge.color}33; white-space:nowrap;">
                                            <i class='bx ${badge.icon}' style="font-size:10px;"></i>
                                            <span>${b.quantity} &times; ${b.expiryDate}</span>
                                        </span>
                                    `;
                                }).join('')
                                : `<small style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${med.countedExpiry || ''}</small>`;

                            return `
                                <div class="square-card counted" onclick="window.App.openCountModal('${med.id}')" title="انقر لتعديل العد">
                                    <span class="badge-done">
                                        <i class='bx bx-check'></i> تم
                                    </span>
                                    <div style="width: 34px; height: 34px; border-radius: 6px; overflow: hidden; margin-bottom: 3px; flex-shrink: 0;">
                                        <img src="${imgUrl}" onerror="this.src='assets/icons/default-med.png'" style="width:100%; height:100%; object-fit:cover;">
                                    </div>
                                    <h3 style="font-size: 11px; font-weight: 800; margin: 0 0 3px 0; line-height: 1.2; word-break: break-word;">${med.nameEN || med.nameAR}</h3>
                                    <div class="counted-qty-tag" style="font-size: 11px; font-weight: 800; background: rgba(16,185,129,0.15); color: var(--secondary); padding: 2px 8px; border-radius: 6px; margin: 2px 0;">
                                        إجمالي: ${med.countedQty}
                                    </div>
                                    <div class="card-batches-breakdown" style="display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: 2px;">
                                        ${batchesHtml}
                                    </div>
                                    <small style="font-size:9px; color:var(--text-muted); margin-top:auto; padding-top:2px; display:flex; align-items:center; gap:2px;">
                                        <i class='bx bx-user'></i> ${med.countedBy || 'صيدلي'}
                                    </small>
                                </div>
                            `;
                        } else {
                            return `
                                <div class="square-card" onclick="window.App.openCountModal('${med.id}')" title="انقر لتسجيل العد">
                                    <div style="width: 34px; height: 34px; border-radius: 6px; overflow: hidden; margin-bottom: 4px; background: rgba(59,130,246,0.06); display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
                                        <img src="${imgUrl}" onerror="this.src='assets/icons/default-med.png'" style="width:100%; height:100%; object-fit:cover;">
                                    </div>
                                    <h3 style="font-size: 11px; font-weight: 800; margin: 0 0 4px 0; line-height: 1.2; word-break: break-word;">${med.nameEN || med.nameAR}</h3>
                                    <span class="square-meta" style="color: var(--primary); font-size: 10px; margin-top: auto;">بانتظار العد ⏳</span>
                                </div>
                            `;
                        }
                    }).join('')}
                </div>
            `}
        `;
    },

    // --- Audit Navigation Handlers ---
    openAuditSession(id) {
        this.selectedAuditSessionId = id;
        Audit.currentSessionId = id;
        this.auditLevel = 'locations';
        this.renderAuditView();
    },

    openAuditLocation(locId) {
        this.selectedAuditLocationId = locId;
        Audit.currentLocationId = locId;
        this.auditLevel = 'categories';
        this.renderAuditView();
    },

    openAuditCategory(catId) {
        this.selectedAuditCategoryId = catId;
        Audit.currentCategoryId = catId;
        this.auditLevel = 'medicines';
        this.renderAuditView();
    },

    auditBackToSessions() {
        this.auditLevel = 'sessions';
        this.selectedAuditSessionId = null;
        this.renderAuditView();
    },

    auditBackToLocations() {
        this.auditLevel = 'locations';
        this.selectedAuditLocationId = null;
        this.renderAuditView();
    },

    auditBackToCategories() {
        this.auditLevel = 'categories';
        this.selectedAuditCategoryId = null;
        this.renderAuditView();
    },

    async holdAuditSession(id) {
        await Audit.holdSession(id);
        this.renderAuditView();
    },

    async resumeAuditSession(id) {
        await Audit.resumeSession(id);
        this.renderAuditView();
    },

    async finalizeAuditSession(id) {
        const ok = await Audit.finalizeSession(id);
        if (ok) {
            this.auditLevel = 'sessions';
            this.selectedAuditSessionId = null;
            this.renderAuditView();
            this.renderDashboard();
        }
    },

    // --- Audit Creation Modal ---
    async openNewAuditModal() {
        const locs = await Locations.getAll();
        UI.showModal(`
            <div class="modal-header"><h2>بدء جلسة جرد ميداني جديدة</h2></div>
            <form onsubmit="event.preventDefault(); window.App.startNewAuditFromModal();">
                <div class="form-group mb-12">
                    <label class="form-label">اسم الجلسة:</label>
                    <input type="text" id="audit-session-name" class="form-input" value="جرد ${new Date().toLocaleDateString('ar-EG')}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">نمط الجرد:</label>
                    <div style="display: flex; gap: 10px;">
                        <label style="flex:1; display:flex; align-items:center; gap:8px; padding:10px; border-radius:10px; background:var(--bg-secondary); cursor:pointer;">
                            <input type="radio" name="audit-mode" value="individual" checked>
                            <div>
                                <strong style="display:block; font-size:13px;">👤 جرد فردي</strong>
                                <small style="color:var(--text-muted); font-size:11px;">عد سريع لجهازك</small>
                            </div>
                        </label>
                        <label style="flex:1; display:flex; align-items:center; gap:8px; padding:10px; border-radius:10px; background:var(--bg-secondary); cursor:pointer;">
                            <input type="radio" name="audit-mode" value="group">
                            <div>
                                <strong style="display:block; font-size:13px;">👥 جرد جماعي</strong>
                                <small style="color:var(--text-muted); font-size:11px;">مشاركة الفريق وسحابي</small>
                            </div>
                        </label>
                    </div>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">حدد الأماكن المشمولة في الجرد:</label>
                    <div style="max-height: 160px; overflow-y: auto; background: var(--bg-secondary); padding: 8px; border-radius: 8px;">
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-weight:bold;">
                            <input type="checkbox" id="audit-loc-all" checked onchange="document.querySelectorAll('.audit-loc-item').forEach(cb => cb.checked = this.checked)">
                            <span>تحديد كافة الأماكن</span>
                        </label>
                        ${locs.map(l => `
                            <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:12px;">
                                <input type="checkbox" class="audit-loc-item" value="${l.id}" checked>
                                <span>${l.nameAR}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">🚀 بدء الجلسة الآن</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async startNewAuditFromModal() {
        const name = document.getElementById('audit-session-name').value.trim();
        const type = document.querySelector('input[name="audit-mode"]:checked')?.value || 'individual';
        const locationIds = [];
        document.querySelectorAll('.audit-loc-item:checked').forEach(cb => locationIds.push(cb.value));

        if (locationIds.length === 0) {
            return UI.showToast('يرجى تحديد مكان واحد على الأقل للجرد', 'warning');
        }

        const session = await Audit.createSession({ name, type, locationIds });
        if (session) {
            UI.closeModal();
            this.selectedAuditSessionId = session.id;
            this.auditLevel = 'locations';
            UI.switchView('view-audit');
            this.renderAuditView();
        }
    },

    // --- Helper: Dynamic Expiry Status & Visual Badge (Item #2) ---
    calcExpiryBadge(expiryStr) {
        if (!expiryStr) return { text: 'غير محدد', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', icon: 'bx-help-circle', status: 'unknown' };
        const parts = expiryStr.trim().split('-');
        const year = parseInt(parts[0], 10);
        const month = parts[1] ? parseInt(parts[1], 10) : 1;
        if (isNaN(year)) return { text: 'صيغة غير صحيحة', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', icon: 'bx-error', status: 'critical' };

        const target = new Date(year, month - 1, 1);
        const now = new Date();
        const current = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthsDiff = (target.getFullYear() - current.getFullYear()) * 12 + (target.getMonth() - current.getMonth());

        if (monthsDiff <= 0) {
            return { text: 'منتهي الصلاحية ⛔', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', icon: 'bx-x-circle', status: 'critical' };
        } else if (monthsDiff <= 3) {
            return { text: `حرج (${monthsDiff} شهر) 🔴`, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', icon: 'bx-error-circle', status: 'critical' };
        } else if (monthsDiff <= 6) {
            return { text: `تنبيه (${monthsDiff} شهر) 🟡`, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', icon: 'bx-time-five', status: 'warning' };
        } else {
            return { text: `صالح (${monthsDiff} شهر) 🟢`, color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981', icon: 'bx-check-circle', status: 'good' };
        }
    },

    // --- Fast Multi-Batch Count Modal (Level 5) with Dedicated Add Box & Calendar ---
    async openCountModal(medicineId) {
        const med = await DB.get('medicineMaster', medicineId);
        if (!med) return;
        const loc = await Locations.get(this.selectedAuditLocationId);
        const session = await Audit.getSession(this.selectedAuditSessionId);
        const countKey = `${this.selectedAuditLocationId}___${medicineId}`;
        const existingCount = (session?.counts && session.counts[countKey]) || null;
        const imgUrl = Categories.getMedicineImage(med);

        // Clean slate for session: if not counted in this session, start completely empty!
        let initialBatches = [];
        if (existingCount && Array.isArray(existingCount.batches) && existingCount.batches.length > 0) {
            initialBatches = existingCount.batches.map(b => ({ ...b }));
        } else if (existingCount && existingCount.quantity !== undefined) {
            initialBatches = [{ quantity: existingCount.quantity, expiryDate: existingCount.expiryDate || '2027-12' }];
        } else {
            initialBatches = []; // Clean slate: no previous quantities lingering!
        }

        this._modalMedicineId = medicineId;
        this._modalBatches = initialBatches;

        const defaultYear = new Date().getFullYear() + 2;
        const defaultExpiry = `${defaultYear}-12`;
        const initialBadge = this.calcExpiryBadge(defaultExpiry);

        UI.showModal(`
            <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 12px;">
                <h2 style="font-size:16px; margin:0;"><i class='bx bx-barcode-reader' style="color:var(--primary);"></i> تسجيل الجرد الفعلي والدفعات</h2>
            </div>
            
            <!-- Responsible Pharmacist Ribbon in Modal -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--bg-secondary); border-radius:8px; margin-bottom:10px; font-size:11px;">
                <span>👤 الصيدلي المسؤول عن العد: <strong style="color:var(--text-main);">${Users.getActive().name}</strong></span>
                <span class="badge ${Users.getActive().role === 'admin' ? 'bg-primary text-white' : 'bg-secondary'}" style="font-size:10px; padding:2px 6px; border-radius:4px;">${Users.getActive().role === 'admin' ? 'مدير 🛡️' : 'صيدلي 💊'}</span>
            </div>
            
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px; background:var(--bg-secondary); border-radius:12px;">
                <div style="width:46px; height:46px; border-radius:10px; overflow:hidden; flex-shrink:0;">
                    <img src="${imgUrl}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div style="flex:1; min-width:0;">
                    <h3 style="margin:0; font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${med.nameEN || med.nameAR}</h3>
                    <p style="margin:2px 0 0 0; font-size:11px; color:var(--text-muted);"><i class='bx bx-map-pin'></i> المكان: <strong style="color:var(--text-main);">${loc?.nameAR || 'المستودع'}</strong></p>
                </div>
            </div>

            <!-- 1. Registered Batches List -->
            <div style="margin-bottom: 12px;">
                <label class="form-label" style="font-size:12px; font-weight:bold; margin-bottom:6px; display:block;">الدفعات المسجلة حالياً:</label>
                <div id="modal-batches-list-container" style="display:flex; flex-direction:column; gap:8px; max-height:160px; overflow-y:auto; padding:2px;">
                    ${this.renderModalBatchesHtml()}
                </div>
            </div>

            <!-- 2. Dedicated Add Batch Box (صندوق إضافة دفعة جديدة) -->
            <div class="add-batch-box" style="background: rgba(59,130,246,0.04); border: 1.5px dashed var(--primary); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                    <strong style="font-size: 12px; color: var(--primary); display:flex; align-items:center; gap: 4px;">
                        <i class='bx bx-plus-circle'></i> صندوق إضافة دفعة جديدة
                    </strong>
                    <span id="new-batch-badge-preview" style="font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 6px; background: ${initialBadge.bg}; color: ${initialBadge.color};">
                        ${initialBadge.text}
                    </span>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin-bottom: 10px;">
                    <div>
                        <label class="form-label" style="font-size: 11px; margin-bottom:3px;">الكمية (العدد):</label>
                        <input type="number" id="new-batch-qty" class="form-input" min="1" step="1" placeholder="مثال: 15" style="font-size: 16px; font-weight: 800; text-align: center; padding: 6px;">
                    </div>
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                            <label class="form-label" style="font-size: 11px; margin:0;">تاريخ الصلاحية (تقويم):</label>
                            <div style="display:flex; gap: 3px;">
                                <button type="button" class="btn-ghost" style="padding: 1px 5px; font-size: 9px; border-radius: 4px;" onclick="window.App.quickSetNewBatchExpiry(1)">+1سنة</button>
                                <button type="button" class="btn-ghost" style="padding: 1px 5px; font-size: 9px; border-radius: 4px;" onclick="window.App.quickSetNewBatchExpiry(2)">+2سنة</button>
                            </div>
                        </div>
                        <input type="month" id="new-batch-expiry" class="form-input" value="${defaultExpiry}" onchange="window.App.updateNewBatchBadgePreview()" style="font-size: 13px; font-weight: bold; cursor: pointer; padding: 6px;">
                    </div>
                </div>

                <button type="button" class="btn-primary sm-btn w-100" onclick="window.App.addNewBatchFromBox()" style="display:flex; align-items:center; justify-content:center; gap: 6px; padding: 7px; font-size: 12px;">
                    <i class='bx bx-plus'></i> إضافة هذه الدفعة للقائمة
                </button>
            </div>

            <!-- Cumulative Live Total -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(59,130,246,0.08); border-radius:10px; border:1px solid rgba(59,130,246,0.2); margin-bottom:12px;">
                <span style="font-size:12px; font-weight:bold; color:var(--text-main);">إجمالي الكمية المسجلة:</span>
                <strong id="modal-batch-total-qty" style="font-size:18px; font-weight:800; color:var(--primary);">${this.calcModalBatchesTotal()} وحدة</strong>
            </div>

            <!-- Zero-Count Fast Action -->
            <div style="display:flex; justify-content:center; margin-bottom:10px;">
                <button type="button" class="btn-ghost sm-btn text-warning" onclick="window.App.recordZeroCountModal('${medicineId}')" style="font-size:11px; width:100%; border:1px dashed var(--accent); padding:8px; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <i class='bx bx-x-circle' style="font-size:15px;"></i> تسجيل الصنف كغير متوفر في هذا المكان (رصيد: 0)
                </button>
            </div>

            <div class="form-actions" style="display:flex; gap:8px;">
                <button type="button" class="btn-primary" onclick="window.App.saveCountFromModal('${medicineId}')" style="flex:1;">💾 حفظ واعتماد العد</button>
                <button type="button" class="btn-ghost" onclick="window.UI.closeModal()" style="flex:0.6;">إلغاء</button>
            </div>
        `);
    },

    renderModalBatchesHtml() {
        if (!this._modalBatches || this._modalBatches.length === 0) {
            return `
                <div style="text-align:center; padding:15px; color:var(--text-muted); font-size:11px; background:var(--bg-secondary); border-radius:8px;">
                    <i class='bx bx-info-circle'></i> لا توجد دفعات مضافة بعد. أدخل الكمية والتاريخ في الصندوق أدناه ثم اضغط "إضافة".
                </div>
            `;
        }

        return this._modalBatches.map((b, idx) => {
            const badge = this.calcExpiryBadge(b.expiryDate);
            return `
                <div class="modal-batch-card" style="display:flex; align-items:center; justify-content:space-between; background:var(--surface); border:1px solid var(--border-color); border-radius:8px; padding:6px 12px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="font-size:14px; color:var(--primary);">${b.quantity} وحدة</strong>
                        <span style="color:var(--text-muted); font-size:12px;">&bull;</span>
                        <span style="font-weight:bold; font-size:12px; color:var(--text-main); display:inline-flex; align-items:center; gap:3px;">
                            <i class='bx bx-calendar'></i> ${b.expiryDate}
                        </span>
                        <span style="display:inline-flex; align-items:center; gap:2px; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:4px; background:${badge.bg}; color:${badge.color};">
                            <i class='bx ${badge.icon}'></i> ${badge.text}
                        </span>
                        ${b.isSuggested ? `<span style="font-size:9px; background:rgba(59,130,246,0.1); color:var(--primary); padding:1px 4px; border-radius:3px;">سابق 📋</span>` : ''}
                    </div>
                    <button type="button" class="icon-btn text-danger" onclick="window.App.removeModalBatch(${idx})" title="حذف هذه الدفعة" style="padding:4px;">
                        <i class='bx bx-trash' style="font-size:16px; color:var(--danger);"></i>
                    </button>
                </div>
            `;
        }).join('');
    },

    calcModalBatchesTotal() {
        if (!this._modalBatches) return 0;
        return this._modalBatches.reduce((s, b) => s + (parseFloat(b.quantity) || 0), 0);
    },

    addNewBatchFromBox() {
        const qtyEl = document.getElementById('new-batch-qty');
        const expEl = document.getElementById('new-batch-expiry');
        if (!qtyEl || !expEl) return;

        const qty = parseFloat(qtyEl.value);
        const exp = expEl.value ? expEl.value.trim() : '';

        if (!qty || qty <= 0) {
            UI.showToast('يرجى إدخال كمية صحيحة أكبر من صفر', 'warning');
            qtyEl.focus();
            return;
        }

        if (!exp) {
            UI.showToast('يرجى اختيار تاريخ الصلاحية من التقويم', 'warning');
            expEl.focus();
            return;
        }

        if (!this._modalBatches) this._modalBatches = [];
        this._modalBatches.push({ quantity: qty, expiryDate: exp });

        // Reset Box Inputs
        qtyEl.value = '';
        qtyEl.focus();

        // Refresh List & Total
        const listContainer = document.getElementById('modal-batches-list-container');
        if (listContainer) listContainer.innerHTML = this.renderModalBatchesHtml();

        const totalEl = document.getElementById('modal-batch-total-qty');
        if (totalEl) totalEl.textContent = `${this.calcModalBatchesTotal()} وحدة`;
    },

    removeModalBatch(index) {
        if (!this._modalBatches) return;
        this._modalBatches.splice(index, 1);

        const listContainer = document.getElementById('modal-batches-list-container');
        if (listContainer) listContainer.innerHTML = this.renderModalBatchesHtml();

        const totalEl = document.getElementById('modal-batch-total-qty');
        if (totalEl) totalEl.textContent = `${this.calcModalBatchesTotal()} وحدة`;
    },

    quickSetNewBatchExpiry(yearsToAdd) {
        const expEl = document.getElementById('new-batch-expiry');
        if (!expEl) return;
        const now = new Date();
        const year = now.getFullYear() + yearsToAdd;
        const month = String(now.getMonth() + 1).padStart(2, '0');
        expEl.value = `${year}-${month}`;
        this.updateNewBatchBadgePreview();
    },

    updateNewBatchBadgePreview() {
        const expEl = document.getElementById('new-batch-expiry');
        const badgeContainer = document.getElementById('new-batch-badge-preview');
        if (!expEl || !badgeContainer) return;

        const badge = this.calcExpiryBadge(expEl.value);
        badgeContainer.style.background = badge.bg;
        badgeContainer.style.color = badge.color;
        badgeContainer.innerHTML = badge.text;
    },

    async saveCountFromModal(medicineId) {
        // Auto-include uncommitted input from the Add Batch Box if filled
        const qtyEl = document.getElementById('new-batch-qty');
        const expEl = document.getElementById('new-batch-expiry');
        if (qtyEl && expEl && parseFloat(qtyEl.value) > 0 && expEl.value) {
            if (!this._modalBatches) this._modalBatches = [];
            this._modalBatches.push({
                quantity: parseFloat(qtyEl.value),
                expiryDate: expEl.value.trim()
            });
        }

        if (!this._modalBatches || this._modalBatches.length === 0) {
            if (confirm('لم تُضف أي دفعات بعد. هل ترغب في تسجيل هذا الصنف كغير متوفر (رصيد صفر 0) في هذا المكان؟')) {
                return this.recordZeroCountModal(medicineId);
            }
            return;
        }

        await Audit.recordCount(this.selectedAuditSessionId, this.selectedAuditLocationId, medicineId, {
            batches: this._modalBatches
        });

        UI.closeModal();
        UI.showToast('تم حفظ واعتماد دُفعات الجرد بنجاح ✅', 'success');
        this.renderAuditView();
    },

    // --- Dedicated Expiry Monitor with Audit Reference & Session Selector ---
    async openExpiryMonitorModal() {
        try {
            const sessions = (await Audit.getAllSessions()) || [];
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const locs = (await Locations.getAll()) || [];
            const locMap = new Map(locs.map(l => [l.id, l.nameAR]));

            const currentSource = this._selectedExpirySourceId || 'live';
            let items = [];
            let sourceMeta = { name: 'المخزون الحالي المعتمد', date: 'الرصيد النشط', host: 'النظام', statusText: 'معتمد 🏁' };

            if (currentSource === 'live') {
                const inventory = (await DB.getAll('inventory')) || [];
                const lastFinalized = sessions.find(s => s.status === 'finalized');
                if (lastFinalized) {
                    sourceMeta = {
                        name: lastFinalized.name,
                        date: new Date(lastFinalized.finalizedAt || lastFinalized.updatedAt).toLocaleDateString('ar-EG'),
                        host: lastFinalized.host || 'خالد',
                        statusText: 'آخر جرد معتمد 🏁'
                    };
                }
                items = inventory.map(item => {
                    const med = masterMap.get(item.medicineId) || { nameEN: 'Unknown', nameAR: 'غير معروف' };
                    const locName = item.location || locMap.get(item.locationId) || 'المستودع الرئيسي';
                    const badge = this.calcExpiryBadge(item.expiryDate);
                    return {
                        id: item.id,
                        medicineId: item.medicineId,
                        nameEN: med.nameEN || med.nameAR,
                        nameAR: med.nameAR || med.nameEN,
                        imagePath: med.imagePath,
                        location: locName,
                        quantity: item.quantity,
                        expiryDate: item.expiryDate || '2027-12',
                        badge: badge
                    };
                });
            } else {
                const targetSession = sessions.find(s => s.id === currentSource);
                if (targetSession) {
                    sourceMeta = {
                        name: targetSession.name,
                        date: new Date(targetSession.startedAt).toLocaleDateString('ar-EG'),
                        host: targetSession.host || 'خالد',
                        statusText: targetSession.status === 'finalized' ? 'معتمد 🏁' : (targetSession.status === 'active' ? 'جاري 🟢' : 'معلق ⏸️')
                    };
                    const counts = targetSession.counts || {};
                    for (const [key, record] of Object.entries(counts)) {
                        const [locId, medId] = key.split('___');
                        const med = masterMap.get(medId) || { nameEN: 'Unknown', nameAR: 'غير معروف' };
                        const locName = locMap.get(locId) || 'المستودع';
                        const batches = (record.batches && record.batches.length > 0)
                            ? record.batches
                            : [{ quantity: record.quantity, expiryDate: record.expiryDate }];
                        for (const b of batches) {
                            items.push({
                                medicineId: medId,
                                nameEN: med.nameEN || med.nameAR,
                                nameAR: med.nameAR || med.nameEN,
                                imagePath: med.imagePath,
                                location: locName,
                                quantity: b.quantity,
                                expiryDate: b.expiryDate || '2027-12',
                                badge: this.calcExpiryBadge(b.expiryDate)
                            });
                        }
                    }
                }
            }

            // Sort by earliest expiration date ascending
            items.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));

            const criticalCount = items.filter(i => i.badge.status === 'critical').length;
            const warningCount = items.filter(i => i.badge.status === 'warning').length;
            const goodCount = items.filter(i => i.badge.status === 'good').length;

            UI.showModal(`
                <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:12px;">
                    <div>
                        <h2 style="margin:0; font-size:18px;"><i class='bx bx-calendar-event' style="color:var(--primary);"></i> شاشة متابعة تواريخ الصلاحية الشاملة</h2>
                        <small class="text-muted">مراقبة تواريخ الصلاحية لجميع الأدوية والمواقع بحسب الجلسة المحددة</small>
                    </div>
                </div>

                <!-- Audit Origin Reference Box (ارتكاز الجلسة) -->
                <div class="expiry-audit-reference-box" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:10px 14px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-size:12px; font-weight:bold; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                            <i class='bx bx-git-commit' style="color:var(--primary); font-size:18px;"></i> الجلسة المرتكز عليها:
                        </span>
                        <span style="font-size:11px; padding:2px 8px; border-radius:6px; background:rgba(59,130,246,0.12); color:var(--primary); font-weight:bold;">
                            ${sourceMeta.statusText}
                        </span>
                    </div>
                    <select id="expiry-source-select" class="form-select" style="font-size:12px; font-weight:bold; padding:6px 10px; margin-bottom:6px;" onchange="window.App.switchExpiryMonitorSource(this.value)">
                        <option value="live" ${currentSource === 'live' ? 'selected' : ''}>📌 المخزون العام الحالي (حسب آخر جرد معتمد)</option>
                        ${sessions.map(s => `
                            <option value="${s.id}" ${currentSource === s.id ? 'selected' : ''}>
                                📋 ${s.name} (${s.status === 'finalized' ? 'معتمد 🏁' : (s.status === 'active' ? 'جاري 🟢' : 'معلق ⏸️')}) — ${new Date(s.startedAt).toLocaleDateString('ar-EG')}
                            </option>
                        `).join('')}
                    </select>
                    <div style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:10px;">
                        <span><i class='bx bx-user'></i> المسؤول: <strong style="color:var(--text-main);">${sourceMeta.host}</strong></span>
                        <span>&bull;</span>
                        <span><i class='bx bx-time'></i> التاريخ: <strong style="color:var(--text-main);">${sourceMeta.date}</strong></span>
                        <span>&bull;</span>
                        <span><i class='bx bx-layer'></i> إجمالي الأصناف: <strong style="color:var(--text-main);">${items.length}</strong></span>
                    </div>
                </div>

                <!-- KPI Status Bar -->
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:12px;">
                    <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:10px; padding:8px; text-align:center;">
                        <span style="font-size:10px; color:var(--danger); font-weight:bold; display:block;">حرجة / منتهية (&le; 3 شهور)</span>
                        <strong style="font-size:18px; color:var(--danger);">${criticalCount}</strong>
                    </div>
                    <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.25); border-radius:10px; padding:8px; text-align:center;">
                        <span style="font-size:10px; color:var(--accent); font-weight:bold; display:block;">تنبيه (&le; 6 شهور)</span>
                        <strong style="font-size:18px; color:var(--accent);">${warningCount}</strong>
                    </div>
                    <div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:8px; text-align:center;">
                        <span style="font-size:10px; color:var(--secondary); font-weight:bold; display:block;">صالحة ومستقرة (&gt; 6 شهور)</span>
                        <strong style="font-size:18px; color:var(--secondary);">${goodCount}</strong>
                    </div>
                </div>

                <!-- Search & Filter Controls -->
                <div style="margin-bottom:12px;">
                    <div class="search-bar" style="margin-bottom:8px;">
                        <i class='bx bx-search'></i>
                        <input type="text" id="expiry-monitor-search" placeholder="بحث باسم الدواء أو الموقع..." oninput="window.App.filterExpiryMonitorList(this.value)">
                    </div>
                    <div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:4px;">
                        <button class="btn-ghost sm-btn active" id="filter-exp-all" onclick="window.App.setExpiryFilter('all')" style="border-radius:20px; font-size:11px; padding:3px 10px;">الكل (${items.length})</button>
                        <button class="btn-ghost sm-btn" id="filter-exp-critical" onclick="window.App.setExpiryFilter('critical')" style="border-radius:20px; font-size:11px; padding:3px 10px; color:var(--danger);">حرجة (${criticalCount})</button>
                        <button class="btn-ghost sm-btn" id="filter-exp-warning" onclick="window.App.setExpiryFilter('warning')" style="border-radius:20px; font-size:11px; padding:3px 10px; color:var(--accent);">تنبيه (${warningCount})</button>
                        <button class="btn-ghost sm-btn" id="filter-exp-good" onclick="window.App.setExpiryFilter('good')" style="border-radius:20px; font-size:11px; padding:3px 10px; color:var(--secondary);">صالحة (${goodCount})</button>
                    </div>
                </div>

                <!-- Expiry Items List -->
                <div id="expiry-monitor-items" style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
                    ${this.renderExpiryMonitorItemsHtml(items)}
                </div>

                <div class="form-actions mt-15" style="display:flex; gap:10px;">
                    <button class="btn-primary sm-btn" onclick="window.App.export('expiring')" style="flex:1;">
                        <i class='bx bx-download'></i> تصدير إكسيل
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.UI.closeModal()" style="flex:1;">إغلاق</button>
                </div>
            `);

            this._cachedExpiryItems = items;
            this._currentExpiryStatusFilter = 'all';
        } catch (err) {
            console.error('Error opening expiry monitor:', err);
            UI.showToast('تعذر فتح شاشة الصلاحية', 'danger');
        }
    },

    switchExpiryMonitorSource(sourceId) {
        this._selectedExpirySourceId = sourceId;
        this.openExpiryMonitorModal();
    },

    renderExpiryMonitorItemsHtml(items) {
        if (!items || items.length === 0) {
            return '<div class="empty-state" style="padding:25px; text-align:center;"><p class="text-muted">لا توجد سجلات تطابق الفلتر الحالي</p></div>';
        }

        return items.map(item => {
            const img = item.imagePath ? item.imagePath : 'assets/icons/default-med.png';
            return `
                <div class="expiry-monitor-card" style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px;">
                    <div style="width:40px; height:40px; border-radius:8px; overflow:hidden; flex-shrink:0;">
                        <img src="${img}" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="flex:1; min-width:0;">
                        <h4 style="margin:0; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.nameEN}</h4>
                        <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-muted); margin-top:2px;">
                            <span><i class='bx bx-map-pin'></i> ${item.location}</span>
                            <span>&bull;</span>
                            <strong style="color:var(--text-main);">${item.quantity} وحدة</strong>
                        </div>
                    </div>
                    <div style="text-align:left; flex-shrink:0;">
                        <span style="display:block; font-size:12px; font-weight:800; color:var(--text-main);">${item.expiryDate}</span>
                        <span style="display:inline-flex; align-items:center; gap:3px; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:6px; background:${item.badge.bg}; color:${item.badge.color}; margin-top:2px;">
                            <i class='bx ${item.badge.icon}'></i> ${item.badge.text}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    },

    setExpiryFilter(status) {
        this._currentExpiryStatusFilter = status;
        ['all', 'critical', 'warning', 'good'].forEach(st => {
            const btn = document.getElementById(`filter-exp-${st}`);
            if (btn) {
                if (st === status) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        });
        const query = document.getElementById('expiry-monitor-search')?.value || '';
        this.filterExpiryMonitorList(query);
    },

    filterExpiryMonitorList(query = '') {
        if (!this._cachedExpiryItems) return;
        const q = (query || '').toLowerCase().trim();
        const status = this._currentExpiryStatusFilter || 'all';

        const filtered = this._cachedExpiryItems.filter(item => {
            const matchesQuery = !q || (item.nameEN && item.nameEN.toLowerCase().includes(q)) || 
                                      (item.nameAR && item.nameAR.toLowerCase().includes(q)) || 
                                      (item.location && item.location.toLowerCase().includes(q));
            const matchesStatus = status === 'all' || item.badge.status === status;
            return matchesQuery && matchesStatus;
        });

        const container = document.getElementById('expiry-monitor-items');
        if (container) {
            container.innerHTML = this.renderExpiryMonitorItemsHtml(filtered);
        }
    }
});

/**
 * Recovery Reset Mechanism (v17.2.0)
 * Clears all local caches and signs out to fix corrupted states.
 */
App.recoveryReset = async function() {
    console.log('Recovery: Initiating full reset...');
    try {
        // 1. Clear LocalStorage
        localStorage.clear();
        
        // 2. Clear IndexedDB
        if (window.indexedDB) {
            const dbs = await window.indexedDB.databases();
            for (let dbInfo of dbs) {
                window.indexedDB.deleteDatabase(dbInfo.name);
                console.log('Recovery: Deleted DB:', dbInfo.name);
            }
        }

        // 3. Unregister SWs
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let reg of regs) {
                await reg.unregister();
                console.log('Recovery: Unregistered SW');
            }
        }

        // 4. Auth SignOut
        await auth.signOut();
        
        UI.showToast('تم مسح البيانات بنجاح. سيتم إعادة تشغيل النظام.', 'success');
        setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
        console.error('Recovery Failed:', err);
        alert('فشل المسح التلقائي. يرجى مسح بيانات المتصفح يدوياً.');
    }
};

App.updateAdminUI = function() {
    const isAdmin = this.userRole === 'admin';
    const statusText = document.getElementById('admin-status-text');
    const icon = document.getElementById('admin-icon');
    const hubCard = document.getElementById('admin-audit-hub-card');
    
    if (statusText) statusText.textContent = isAdmin ? 'وضع المدير (مفعل)' : 'صلاحيات الموظف (مفعلة)';
    if (icon) icon.className = isAdmin ? 'bx bxs-shield-check' : 'bx bx-user';
    if (hubCard) {
        hubCard.style.display = 'flex';
        hubCard.onclick = () => window.App.openAuditHub();
        hubCard.querySelector('h3').textContent = 'مركز إدارة الجرد (Audit Hub)';
        hubCard.querySelector('p').textContent = 'إدارة الجلسات الحالية، الانضمام، أو البدء';
    }
    
    if (window.UI && (UI.currentView === 'master' || UI.currentView === 'inventory')) {
        this.renderInventory();
    }
    if (window.UI && UI.currentView === 'dashboard') {
        this.renderDashboard();
    }
};

App.deleteMasterMedicine = async function(id) {
    if (!confirm('🚨 تحذير: حذف الصنف سيحذف كافة بيانات الجرد المرتبطة به من المستودع. هل أنت متأكد؟')) return;
    try {
        UI.showToast('جاري حذف الصنف... 🗑️', 'info');
        await DB.delete('medicineMaster', id);
        const entries = await DB.getAll('inventory');
        for (let entry of entries) {
            if (entry.medicineId === id) await DB.delete('inventory', entry.id);
        }
        UI.showToast('تم حذف الصنف والجرد بالكامل 🗑️', 'warning');
        if (this.selectedCategoryId) this.openCategory(this.selectedCategoryId);
    } catch (err) {
        UI.showToast('فشل الحذف', 'danger');
    }
};

App.toggleNotifications = function() {
    const overlay = document.getElementById('notification-center');
    if (overlay) overlay.classList.toggle('show');
};

App.clearNotifications = function() {
    this.notifications = [];
    this.unreadCount = 0;
    const list = document.getElementById('notif-list');
    if (list) {
        list.innerHTML = `
            <div class="notif-empty">
                <i class='bx bx-sleepy'></i>
                <p>لا توجد حركات حديثة في الجرد الحالي</p>
            </div>
        `;
    }
    const badge = document.getElementById('notif-badge');
    if (badge) {
        badge.textContent = '0';
        badge.style.display = 'none';
    }
};

App.openProfile = function() {
    this.openUserSettingsManager();
};

App.showLowStock = function() {
    this.selectedCategoryId = null;
    if (window.UI) UI.switchView('view-inventory');
    this.renderInventory('low-stock');
};

App.showExpiring = function() {
    this.openExpiryMonitorModal();
};

App.startAudit = async function() {
    if (!this.user) {
        if (window.UI) UI.showToast('يرجى تسجيل الدخول أولاً', 'warning');
        return;
    }
    this.openAuditHub();
};

App.handleAdminUnlock = async function() {
    const storedPin = localStorage.getItem('dawaa_admin_pin') || 'dawaa2026';
    const pass = prompt('أدخل رمز مرور المسؤول (Admin PIN):');
    if (!pass) return;
    if (pass === storedPin || pass === 'dawaa@2026') {
        this.userRole = 'admin';
        localStorage.setItem('user_role', 'admin');
        this.updateAdminUI();
        if (window.UI) UI.showToast('تم تفعيل صلاحيات المسؤول بنجاح ✅', 'success');
    } else {
        if (window.UI) UI.showToast('رمز المرور غير صحيح ❌', 'danger');
    }
};

window.onerror = (msg, url, line, col, error) => {
    console.error('Dawaa Global Catch:', { msg, url, line, error });
    return false; // allow standard error logging
};

const _boot = async () => {
    window.App = App;
    window.UI = UI;
    await App.init();
    
    const bindSearch = (id, fn, delay = 300) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.bound) return;
        el.dataset.bound = '1';
        let _t;
        el.addEventListener('input', (e) => {
            clearTimeout(_t);
            _t = setTimeout(() => fn(e.target.value), delay);
        });
    };

    const authForm = document.getElementById('auth-form');
    if (authForm && !authForm.dataset.bound) {
        authForm.dataset.bound = '1';
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            App.handleAuthSubmit();
        });
    }

    bindSearch('global-search', (v) => App.handleGlobalSearch?.(v));
    bindSearch('master-search', (v) => App.handleMasterSearch?.(v));
    bindSearch('tr-search',     (v) => App.handleTaskSearch?.(v));

    document.querySelectorAll('.nav-item[data-target]').forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const id = target.startsWith('view-') ? target : 'view-' + target;
            if (window.UI?.switchView) {
                window.UI.switchView(id);
                if (id === 'view-inventory' && window.App?.renderInventory) {
                    window.App.renderInventory('detailed');
                } else if (id === 'view-audit' && window.App?.renderAuditView) {
                    window.App.renderAuditView();
                }
            }
        });
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
} else {
    _boot();
}

console.log('%c[DAWAA] Recovery Mode: localStorage.setItem("dawaa_recovery_mode", "true"); location.reload();', 'color: blue; font-weight: bold;');

export { App };
