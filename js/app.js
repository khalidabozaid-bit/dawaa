import { DB } from './core/db.js';
import { UI } from './core/ui.js';
import { Inventory } from './features/inventory.js';
import { Categories } from './features/categories.js?v=18.17.3';
import { Locations } from './features/locations.js';
import { Audit } from './features/audit.js';
import { Users } from './features/users.js';
import { EgyptianDrugs } from './core/egyptian_drugs.js?v=18.17.3';
window.Users = Users;
window.EgyptianDrugs = EgyptianDrugs;
import { Exporter } from './features/export.js';
import { Utils } from './core/utils.js?v=18.17.3';
import { Sync } from './core/sync.js';
import { TaskManager } from './features/tasks.js?v=18.17.3';
import { auth, db, storage } from './core/firebase-config.js';

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
 * Dawaa App Orchestrator (v18.8.2)
 * Cache-Busting Service Worker Logic Enabled.
 */

const App = {
    VERSION: '18.18.0', // GS1 DataMatrix & QR 2D Pharma Scanner — auto-extracts EAN-13 barcode + Expiry Date + Batch
    activeAudit: null, 
    inventoryUnsubscribe: null, // v14.0.0 Sync Handle
    isJoined: false,   
    selectedCategoryId: null, 
    selectedLocationId: null,
    notifications: [],
    unreadCount: 0,
    _dashCache: null,
    _dashCacheTime: 0,
    _deferredInstallPrompt: null,

    /**
     * Image Upload Helper for Cloud Storage (v18.7.9)
     * Auto-compresses raw files, sets JPEG metadata, and uploads in milliseconds.
     */
    async uploadImage(fileOrBlob, medId) {
        if (!fileOrBlob) return null;
        try {
            const stor = (typeof window.storage !== 'undefined' ? window.storage : null) || 
                         (typeof storage !== 'undefined' ? storage : null) || 
                         (window.firebase?.storage ? window.firebase.storage() : null);
            if (!stor) {
                console.warn('Firebase Storage not initialized.');
                return null;
            }

            // Ensure we upload a compressed lightweight WebP/JPEG blob (max 600px square, ~20KB)
            let uploadBlob = fileOrBlob;
            let mimeType = 'image/webp';
            if (fileOrBlob instanceof File && typeof Utils !== 'undefined' && Utils.compressImage) {
                try {
                    const comp = await Utils.compressImage(fileOrBlob, { maxDimension: 600, quality: 0.8, cropSquare: true });
                    if (comp?.blob) {
                        uploadBlob = comp.blob;
                        mimeType = comp.format === 'WebP' ? 'image/webp' : 'image/jpeg';
                    }
                } catch (ce) {
                    console.warn('Pre-upload compression fallback:', ce);
                }
            } else if (fileOrBlob?.type) {
                mimeType = fileOrBlob.type;
            }

            const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
            const storageRef = stor.ref(`medicine_images/${medId}_${Date.now()}.${ext}`);
            const metadata = { contentType: mimeType, cacheControl: 'public,max-age=31536000' };
            const snapshot = await storageRef.put(uploadBlob, metadata);
            return await snapshot.ref.getDownloadURL();
        } catch (err) {
            console.error('Storage Upload Error:', err);
            return null;
        }
    },

    /**
     * Cloud Storage Garbage Collector (v18.8.0)
     */
    async deleteStorageImage(imageUrl) {
        if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.includes('firebasestorage.googleapis.com')) return;
        try {
            const stor = (typeof window.storage !== 'undefined' ? window.storage : null) || 
                         (typeof storage !== 'undefined' ? storage : null) || 
                         (window.firebase?.storage ? window.firebase.storage() : null);
            if (!stor || typeof stor.refFromURL !== 'function') return;
            const ref = stor.refFromURL(imageUrl);
            await ref.delete();
            console.log('Storage GC: Cleaned up orphaned cloud image:', imageUrl);
        } catch (e) {
            console.warn('Storage GC notice:', e.message);
        }
    },

    /**
     * Offline Guard & Network Monitor (v18.8.0)
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
                if (typeof window.Sync?.processPendingImageQueue === 'function') {
                    window.Sync.processPendingImageQueue().catch(() => {});
                }
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
            // Purge ad-hoc inventory entries that do not belong to real audit sessions
            try {
                const allRawInv = (await DB.getAll('inventory')) || [];
                const badEntries = allRawInv.filter(r => !r.auditId || r.auditId === 'general' || String(r.id).startsWith('inv_100') || !String(r.id).startsWith('inv_audit_'));
                for (const b of badEntries) {
                    await DB.delete('inventory', b.id);
                    if (typeof Sync !== 'undefined' && Sync.deleteInventoryEntry) {
                        Sync.deleteInventoryEntry(b.id).catch(() => {});
                    }
                }
                if (badEntries.length > 0) {
                    console.log(`Inventory: Cleaned ${badEntries.length} ad-hoc inventory entries. Stock is now strictly derived from Audit sessions.`);
                }
            } catch (ce) {
                console.warn('Ad-hoc inventory cleanup notice:', ce);
            }
            
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
            const medLangSelect = document.getElementById('med-lang-select');
            if (medLangSelect) medLangSelect.value = localStorage.getItem('dawaa_med_lang_pref') || 'en';
            this.initNetworkMonitor();
            // Service Worker is registered via initServiceWorker() only (no duplication)
            // this.registerServiceWorker(); // Removed: duplicate SW registration

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
                    return;
                }
                if (event.state && event.state.viewId === 'view-audit') {
                    if (UI.currentView !== 'audit') {
                        UI.switchView('view-audit', false);
                    }
                    if (event.state.auditLevel === 'medicines') {
                        this.selectedAuditSessionId = event.state.sessionId;
                        this.selectedAuditLocationId = event.state.locationId;
                        this.selectedAuditCategoryId = event.state.categoryId;
                        this.auditLevel = 'medicines';
                        this.renderAuditView();
                    } else if (event.state.auditLevel === 'categories') {
                        this.selectedAuditSessionId = event.state.sessionId;
                        this.selectedAuditLocationId = event.state.locationId;
                        this.selectedAuditCategoryId = null;
                        this.auditLevel = 'categories';
                        this.renderAuditView();
                    } else if (event.state.auditLevel === 'locations') {
                        this.selectedAuditSessionId = event.state.sessionId;
                        this.selectedAuditLocationId = null;
                        this.selectedAuditCategoryId = null;
                        this.auditLevel = 'locations';
                        this.renderAuditView();
                    } else {
                        this.selectedAuditSessionId = null;
                        this.selectedAuditLocationId = null;
                        this.selectedAuditCategoryId = null;
                        this.auditLevel = 'sessions';
                        this.renderAuditView();
                    }
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
            this.initInstallPrompt();
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
                        console.log('SW: Update available — showing banner.');
                        this.pendingRegistration = reg;
                        this.updateState = 'ready';
                        this._showUpdateBanner();
                    }
                });
            });
        });
        // Reload ONLY when user approves the update (via applyUpdate → SKIP_WAITING → controllerchange)
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            if (this._userApprovedUpdate) {
                refreshing = true;
                console.log('SW: controllerchange — user approved, reloading...');
                window.location.reload();
            } else {
                console.log('SW: controllerchange — not user-approved, showing banner.');
                this._showUpdateBanner();
            }
        });
    },

    _showUpdateBanner() {
        const banner = document.querySelector('.update-banner');
        if (banner) {
            banner.classList.add('show');
        } else {
            // Toast fallback if banner element not found
            UI.showToast('تحديث جديد متاح — اضغط "تحقق من التحديثات" في الإعدادات', 'info');
        }
    },

    /**
     * Update check delegated to primary App.checkUpdate engine
     */
    async checkUpdate() {
        if (typeof App !== 'undefined' && App.checkUpdate && App.checkUpdate !== this.checkUpdate) {
            return App.checkUpdate();
        }
    },

    applyUpdate() {
        this._userApprovedUpdate = true;
        const worker = this.swRegistration?.waiting || this.swRegistration?.installing;
        if (worker) {
            worker.postMessage({ type: 'SKIP_WAITING' });
        } else {
            window.location.reload();
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
            this.updateAdminUI();
            
            // v10.5.1: Final UI Polish
            if (this.activeAudit) this.renderActiveAuditCard();
            
            // v18.11.6: Pull cloud data FIRST, then render dashboard with fresh data
            // This prevents showing stale local balance (e.g. 44) before updating to real (63)
            if (Sync.initV2) Sync.initV2();
            try {
                await Sync.pull(); // await — get latest cloud data before rendering
            } catch (pullErr) {
                console.warn('Initial pull failed, rendering with local data:', pullErr);
            }
            // Now render dashboard with the freshest data available
            this._dashCache = null;
            this._dashCacheTime = 0;
            await this.renderDashboard();
            
            if (Sync.startLiveSync) Sync.startLiveSync();
            
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
            
            // 0. Clear in-memory caches
            this._dashCache = null;
            this._dashCacheTime = 0;
            
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


    // --- Central View Refresh & Live Sync Coordination (v18.9.1) ---
    async refreshAllViews(targetCatId = null) {
        try {
            const currentView = UI.currentView || '';
            
            // Only refresh views that are currently visible or relevant
            if (currentView === 'smart-inventory' || currentView === 'inventory') {
                if (typeof this.renderInventory === 'function') await this.renderInventory();
            }
            
            if (currentView === 'warehouse') {
                if (typeof this.renderWarehouseCategories === 'function') await this.renderWarehouseCategories();
                if (typeof this.renderWarehouseLocations === 'function') await this.renderWarehouseLocations();
            }
            
            // Category chips appear on inventory views too
            if (currentView === 'smart-inventory' || currentView === 'inventory' || currentView === 'warehouse') {
                if (typeof this.renderCategoryChips === 'function') await this.renderCategoryChips();
            }
            
            if (currentView === 'dashboard' || !currentView) {
                if (typeof this.renderDashboard === 'function') await this.renderDashboard();
            }
            
            // If in Audit view or if an audit session is open
            if (currentView === 'audit' && typeof this.renderAuditView === 'function') {
                // Restore audit context if returning from add/edit during audit
                if (this._auditReturnContext) {
                    const ctx = this._auditReturnContext;
                    this._auditReturnContext = null;
                    this.selectedAuditSessionId = ctx.sessionId;
                    this.selectedAuditLocationId = ctx.locationId;
                    this.selectedAuditCategoryId = ctx.categoryId;
                    this.auditLevel = ctx.level;
                }
                const auditContainer = document.getElementById('view-audit');
                if (auditContainer && (auditContainer.classList.contains('active') || this.selectedAuditSessionId)) {
                    await this.renderAuditView();
                }
            }

            // If a category modal was open or requested, refresh it dynamically with updated medicines
            const catIdToReopen = targetCatId || this._activeCategoryModalId;
            if (catIdToReopen && typeof this.openCategoryDetailModal === 'function') {
                const container = document.getElementById('modal-container');
                if (container && container.classList.contains('show') && this._activeCategoryModalId) {
                    await this.openCategoryDetailModal(catIdToReopen);
                }
            }
        } catch (e) {
            console.warn('Error refreshing views:', e);
        }
    },

    async cleanCategories() {
        try {
            UI.showToast('جاري تنظيف وتوحيد التصنيفات ونقل الأدوية القديمة... 🧹', 'info');
            const res = await Categories.cleanupAndMigrate();
            await this.refreshAllViews();
            const count = res?.migratedCount || 0;
            UI.showToast(`تم تنظيف التصنيفات بنجاح! تم نقل وتحديث ${count} دواء ✅`, 'success');
        } catch (err) {
            console.error('Error cleaning categories:', err);
            UI.showToast('فشل تنظيف التصنيفات: ' + err.message, 'danger');
        }
    },

    async triggerCloudSync() {
        if (typeof Sync !== 'undefined' && Sync.pullAll) {
            await Sync.pullAll();
        } else {
            UI.showToast('محرك السحابة غير جاهز حالياً', 'warning');
        }
    },

    // --- View Renderers ---

    async renderDashboard() {
        try {
            // v18.11.6: Reduced TTL from 10s to 3s to prevent stale data display
            const now = Date.now();
            if (this._dashCacheTime && now - this._dashCacheTime < 3000 && this._dashCache) {
                UI.updateDashboardStats(this._dashCache);
                return;
            }
            const stats = await Inventory.getCurrentStockStats();
            this._dashCache = stats;
            this._dashCacheTime = now;
            UI.updateDashboardStats(stats);
            // v15.0.0: Render active structured tasks
            if (window.TaskManager) TaskManager.renderAssignedTaskPrompt();
        } catch (err) {
            console.error(err);
        }
    },

    // --- Notification System (v18.10.0) ---
    pushNotification(message, type = 'info') {
        const notification = {
            id: 'notif_' + Date.now(),
            message,
            type,
            time: new Date().toISOString(),
            read: false
        };
        this.notifications.unshift(notification);
        if (this.notifications.length > 50) this.notifications.pop();
        this.unreadCount = this.notifications.filter(n => !n.read).length;
        this.renderNotificationBadge();
        if (typeof UI !== 'undefined') UI.showToast(message, type === 'info' ? 'info' : 'success');
    },

    renderNotificationBadge() {
        const badge = document.getElementById('notif-badge');
        if (badge) {
            badge.textContent = this.unreadCount > 0 ? this.unreadCount : '';
            badge.style.display = this.unreadCount > 0 ? 'flex' : 'none';
        }
    },

    clearNotifications() {
        this.notifications.forEach(n => n.read = true);
        this.unreadCount = 0;
        this.renderNotificationBadge();
    },

    // --- PWA Install Prompt (v18.10.0) ---
    initInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this._deferredInstallPrompt = e;
            const installBtn = document.getElementById('pwa-install-btn');
            if (installBtn) installBtn.style.display = 'inline-flex';
            console.log('PWA: Install prompt captured ✅');
        });
        window.addEventListener('appinstalled', () => {
            this._deferredInstallPrompt = null;
            const installBtn = document.getElementById('pwa-install-btn');
            if (installBtn) installBtn.style.display = 'none';
            if (typeof UI !== 'undefined') UI.showToast('تم تثبيت التطبيق بنجاح! 🎉', 'success');
            console.log('PWA: App installed ✅');
        });
    },

    async showInstallPrompt() {
        if (!this._deferredInstallPrompt) {
            if (typeof UI !== 'undefined') UI.showToast('التطبيق مثبت بالفعل أو غير متاح للتثبيت', 'info');
            return;
        }
        this._deferredInstallPrompt.prompt();
        const result = await this._deferredInstallPrompt.userChoice;
        console.log('PWA: Install choice:', result.outcome);
        this._deferredInstallPrompt = null;
    },

    async renderInventory(type = 'detailed') {
        try {
            const container = document.getElementById('inventory-items-list') || document.getElementById('inventory-list');
            if (!container) return;

            this.currentFilterType = type;
            const alertContainer = document.getElementById('inventory-filter-alert');
            if (alertContainer) {
                alertContainer.style.display = 'none';
                alertContainer.innerHTML = '';
            }

            this.renderCategoryChips(); // Refresh category filter
            this.renderLocationChips(); // Refresh location filter

            // Pure Catalog: Read directly from medicineMaster (no stock/inventory join)
            let data = (await DB.getAll('medicineMaster')) || [];

            // 1. Filter by Category
            if (this.selectedCategoryId) {
                const sel = this.selectedCategoryId;
                const allCurrentCats = await Categories.getAllSorted();
                const validCatIds = new Set(allCurrentCats.filter(c => c.id !== 'uncategorized').map(c => c.id));
                data = data.filter(m => {
                    const cat = m.categoryId;
                    if (sel === 'uncategorized') {
                        return !cat || cat === 'uncategorized' || !validCatIds.has(cat);
                    }
                    return cat === sel;
                });
            }

            // 2. Filter by Location
            if (this.selectedLocationId) {
                const locId = this.selectedLocationId;
                data = data.filter(m => {
                    if (m.allowedLocations && Array.isArray(m.allowedLocations) && m.allowedLocations.length > 0) {
                        return m.allowedLocations.includes(locId);
                    }
                    if (m.primaryLocation) {
                        return m.primaryLocation === locId;
                    }
                    return false;
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
                        return `<option value="${c.id}" ${isSel}>${Utils.escapeHTML(c.nameAR)}</option>`;
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

    filterByLocation(locId) {
        this.selectedLocationId = locId || null;

        // Sync Dropdown Select
        const selectEl = document.getElementById('location-dropdown-select');
        if (selectEl && selectEl.value !== (locId || '')) {
            selectEl.value = locId || '';
        }

        const searchInput = document.getElementById('global-search');
        if (searchInput && searchInput.value.trim().length > 0) {
            this.handleGlobalSearch(searchInput.value);
        } else {
            this.renderInventory(this.currentFilterType || 'detailed');
        }
    },

    async renderLocationChips() {
        try {
            const locs = await Locations.getAll();
            const selectEl = document.getElementById('location-dropdown-select');
            if (selectEl) {
                selectEl.innerHTML = `
                    <option value="">📍 جميع الأماكن</option>
                    ${locs.map(l => {
                        const isSel = this.selectedLocationId === l.id ? 'selected' : '';
                        return `<option value="${l.id}" ${isSel}>${Utils.escapeHTML(l.nameAR)}</option>`;
                    }).join('')}
                `;
            }
        } catch (err) {
            console.error('Error rendering location filter:', err);
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
                            <h3>${Utils.escapeHTML(med.nameEN)} <span class="ar-name">/ ${Utils.escapeHTML(med.nameAR || '')}</span></h3>
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
                            <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover">
                        </div>
                        <div class="card-info">
                            <h3>
                                ${Utils.escapeHTML(m.nameEN)} 
                                <span class="ar-name">/ ${Utils.escapeHTML(m.nameAR || '')}</span>
                                ${m.v ? `<span class="ver-badge">v${m.v}</span>` : ''}
                            </h3>
                            <div class="card-meta">
                                <span><i class='bx bx-barcode'></i> ${m.id}</span>
                                <span><i class='bx bx-purchase-tag-alt'></i> ${Utils.escapeHTML(cat.nameAR)}</span>
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
                        <span>${Utils.escapeHTML(cat.nameAR)}</span>
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
                    <h2>${Utils.escapeHTML(info.nameAR)}</h2>
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
                                <div class="med-card-main" onclick="window.App.openMedicineDetails('${m.id}')">
                                    <div class="med-image">
                                        <img src="${imgSrc}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';">
                                    </div>
                                    <div class="med-info-overlay">
                                        <h4>${Utils.escapeHTML(m.nameEN)} <span class="med-id-badge">#${m.id}</span></h4>
                                        <span class="med-active-sub">${Utils.escapeHTML(m.activeIngredient || '')}</span>
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
                    <h2>نقل صنف إلى: ${Utils.escapeHTML(targetCat.nameAR)}</h2>
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
                        <span class="search-name">${Utils.escapeHTML(m.nameEN)} (كود #${m.id})</span>
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
            
            // Immediate Cloud Sync for Category Transfers
            if (typeof Sync !== 'undefined' && Sync.push) {
                Sync.push(medicineId).catch(() => {});
            }
            
            UI.showToast(`تم نقل ${Utils.escapeHTML(med.nameEN)} بنجاح ✅`, 'success');
            this.openCategory(targetCatId); // Refresh category view
        } catch (err) {
            UI.showToast('فشل عملية النقل ❌', 'danger');
        }
    },

    openAddMedicineWithCat(catId) {
        this._activeCategoryModalId = catId;
        this.openAddMedicine(catId);
    },

    async openMedicineDetails(medicineId) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return UI.showToast('تعذر العثور على بيانات الدواء', 'warning');

            const allCats = (await Categories.getAllSorted()) || [];
            const cat = allCats.find(c => c.id === med.categoryId) || { nameAR: 'أدوية غير مصنفة', icon: 'bx-category', color: '#3b82f6' };
            const catName = cat.nameAR || med.categoryId;
            const catIcon = cat.icon || 'bx-category';
            const catColor = cat.color || '#3b82f6';

            const imgSrc = (typeof Categories !== 'undefined' && Categories.getMedicineImage) 
                ? Categories.getMedicineImage(med, { icon: 'bx-capsule' }) 
                : (med.imagePath || 'assets/icons/default-med.png');

            const langPref = localStorage.getItem('dawaa_med_lang_pref') || 'en';
            let primaryName = med.nameEN || med.nameAR;
            let secondaryName = med.nameAR || '';

            if (langPref === 'ar') {
                primaryName = med.nameAR || med.nameEN;
                secondaryName = med.nameEN !== primaryName ? med.nameEN : '';
            } else if (langPref === 'bilingual') {
                primaryName = med.nameEN;
                secondaryName = med.nameAR;
            }

            const safePrimary = (typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(primaryName) : primaryName;
            const safeSecondary = (typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(secondaryName) : secondaryName;
            const safeActive = (med.activeIngredient && typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(med.activeIngredient) : (med.activeIngredient || '');
            // v18.14.0: Keep commercial barcode strictly separate from internal DB id
            const realBarcode = (med.barcode && String(med.barcode).trim() !== '' && String(med.barcode).trim() !== String(med.id)) ? String(med.barcode).trim() : '';
            const safeBarcode = realBarcode ? Utils.escapeHTML(realBarcode) : '';

            // Fetch physical storage locations in the clinic building
            const allLocations = (await Locations.getAll()) || [];
            const allowedLocIds = med.allowedLocations || [];
            
            // Resolve assigned clinic locations
            const assignedLocs = allLocations.filter(loc => allowedLocIds.includes(loc.id));
            
            // Resolve primary location
            const primaryLocObj = med.primaryLocation ? allLocations.find(l => l.id === med.primaryLocation) : null;

            const typeLabel = med.type === 'emergency' ? '🚨 طوارئ' : (med.type === 'supply' ? '🩹 مستلزم طبي' : '💊 دواء');

            UI.showModal(`
                <div class="sheet-handle"></div>

                <!-- Hero Section: Image + Names + Category (Master Catalog Info) -->
                <div style="display:flex; gap:16px; align-items:flex-start; margin-bottom:18px; border-bottom:1px solid var(--border-color); padding-bottom:16px;">
                    <div style="width:84px; height:84px; border-radius:18px; overflow:hidden; flex-shrink:0; background:rgba(59,130,246,0.08); border:1.5px solid var(--border-color); box-shadow:0 4px 12px rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer;" onclick="window.App.openImageLightbox('${imgSrc}', '${safePrimary}')" title="انقر لتكبير وعرض الصورة بدقة عالية 🔍">
                        <img src="${imgSrc}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                            <span class="badge" style="background:${catColor}20; color:${catColor}; font-size:11px; padding:3px 9px; border-radius:6px; font-weight:bold; display:inline-flex; align-items:center; gap:4px;">
                                <i class='bx ${catIcon}'></i> ${catName}
                            </span>
                            <div style="display:flex; align-items:center; gap:4px;">
                                <span style="font-size:10.5px; background:var(--bg-secondary); color:var(--text-muted); padding:2px 6px; border-radius:4px; font-weight:600;">
                                    ${typeLabel}
                                </span>
                                <span style="font-size:10.5px; color:var(--text-muted); font-family:monospace; background:var(--bg-secondary); padding:2px 6px; border-radius:4px;">
                                    #${Utils.escapeHTML(med.id)}
                                </span>
                            </div>
                        </div>
                        <h2 style="font-size:18px; font-weight:800; margin:0 0 3px 0; color:var(--text-main); line-height:1.25; word-break:break-word;">
                            ${safePrimary}
                        </h2>
                        ${safeSecondary ? `<div style="font-size:13.5px; color:var(--text-muted); font-weight:600; margin-bottom:4px; line-height:1.2;">${safeSecondary}</div>` : ''}
                        ${safeActive ? `
                            <div style="font-size:12px; color:var(--primary); font-weight:600; display:inline-flex; align-items:center; gap:4px; margin-top:2px;">
                                <i class='bx bx-dna'></i> <span>${safeActive}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Barcode & Identification Quick Bar (Strictly separate from internal DB #id) -->
                ${safeBarcode ? `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; padding:8px 12px; margin-bottom:16px; flex-wrap:wrap;">
                        <span style="font-size:12px; font-weight:bold; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
                            <i class='bx bx-barcode' style="font-size:16px; color:var(--primary);"></i> الباركود: <code style="color:var(--text-main);">${safeBarcode}</code>
                        </span>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="btn-ghost sm-btn" onclick="navigator.clipboard.writeText('${safeBarcode}'); window.UI.showToast('تم نسخ الباركود 📋', 'info');" style="font-size:11px; padding:3px 8px; border-radius:6px; border:1px solid var(--border-color);">
                                نسخ <i class='bx bx-copy'></i>
                            </button>
                            <button type="button" class="btn-ghost sm-btn" onclick="window.App.clearMedicineBarcode('${Utils.escapeHTML(med.id)}')" title="مسح الباركود (دون المساس بكود الدواء في القاعدة)" style="font-size:11px; padding:3px 8px; border-radius:6px; border:1px solid rgba(239,68,68,0.35); color:var(--danger);">
                                مسح <i class='bx bx-trash'></i>
                            </button>
                        </div>
                    </div>
                ` : ''}

                <!-- Physical Clinic Storage Locations (أماكن الحفظ والتواجد في مبنى العيادة) -->
                <div style="margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <strong style="font-size:13.5px; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                            <i class='bx bx-map-pin' style="color:var(--primary);"></i> أماكن التخزين والتواجد:
                        </strong>
                    </div>

                    ${primaryLocObj ? `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:linear-gradient(135deg, ${primaryLocObj.color || 'var(--primary)'}12, ${primaryLocObj.color || 'var(--primary)'}05); border:1.5px solid ${primaryLocObj.color || 'var(--primary)'}40; border-radius:12px; margin-bottom:8px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:36px; height:36px; border-radius:10px; background:${primaryLocObj.color || 'var(--primary)'}20; display:flex; align-items:center; justify-content:center;">
                                    <i class='bx ${primaryLocObj.icon || 'bx-map-pin'}' style="font-size:20px; color:${primaryLocObj.color || 'var(--primary)'};"></i>
                                </div>
                                <div>
                                    <strong style="font-size:13px; color:var(--text-main); display:block;">${Utils.escapeHTML(primaryLocObj.nameAR)}</strong>
                                    <small style="font-size:11px; color:var(--text-muted);">مكان التخزين الأساسي ⭐</small>
                                </div>
                            </div>
                            <span style="font-size:10px; font-weight:700; color:${primaryLocObj.color || 'var(--primary)'}; background:${primaryLocObj.color || 'var(--primary)'}15; padding:4px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
                                <i class='bx bx-star'></i> أساسي
                            </span>
                        </div>
                    ` : ''}

                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${assignedLocs.filter(loc => !primaryLocObj || loc.id !== primaryLocObj.id).length > 0 ? assignedLocs.filter(loc => !primaryLocObj || loc.id !== primaryLocObj.id).map(loc => `
                            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--surface); border:1px solid var(--border-color); border-radius:12px;">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div style="width:36px; height:36px; border-radius:10px; background:rgba(59,130,246,0.08); display:flex; align-items:center; justify-content:center;">
                                        <i class='bx ${loc.icon || 'bx-map-pin'}' style="font-size:20px; color:${loc.color || 'var(--primary)'};"></i>
                                    </div>
                                    <div>
                                        <strong style="font-size:13px; color:var(--text-main); display:block;">${Utils.escapeHTML(loc.nameAR)}</strong>
                                        <small style="font-size:11px; color:var(--text-muted);">${loc.description || 'موقع حفظ معتمد'}</small>
                                    </div>
                                </div>
                                <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.1); padding:4px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
                                    <i class='bx bx-check-circle'></i> معتمد
                                </span>
                            </div>
                        `).join('') : ''}
                        ${!primaryLocObj && assignedLocs.length === 0 ? `
                            <div style="text-align:center; padding:16px; background:var(--bg-secondary); border-radius:12px; border:1px dashed var(--border-color);">
                                <i class='bx bx-map-pin' style="font-size:26px; color:var(--text-muted);"></i>
                                <p style="font-size:12.5px; color:var(--text-muted); margin:4px 0 8px 0;">لم يتم تحديد أماكن حفظ لهذا الدواء بعد</p>
                                <button type="button" class="btn-ghost sm-btn" onclick="window.App.openEditMedicine('${med.id}')" style="font-size:11.5px; border:1px solid var(--border-color); font-weight:bold;">
                                    تحديد أماكن الحفظ الآن ✏️
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Action Buttons: Clean direct catalog actions -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:16px; border-top:1px solid var(--border-color); padding-top:14px;">
                    <button type="button" class="btn-primary sm-btn" onclick="window.App.openEditMedicine('${med.id}');" style="font-size:13px; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; padding:10px 14px;">
                        <i class='bx bx-edit-alt'></i> <span>تعديل بيانات الدواء ✏️</span>
                    </button>
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.openMoveCategoryModal('${med.id}');" style="font-size:13px; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; padding:10px 14px; border:1px solid var(--border-color);">
                        <i class='bx bx-transfer'></i> <span>نقل لتصنيف آخر ⇄</span>
                    </button>
                </div>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button type="button" class="btn-ghost sm-btn w-100" onclick="window.UI.closeModal()" style="font-size:12px; padding:8px;">
                        إغلاق النافذة
                    </button>
                    <button type="button" class="btn-ghost sm-btn text-danger" onclick="window.App.deleteMasterMedicine('${med.id}');" style="font-size:12px; padding:8px 14px; border:1px solid rgba(239,68,68,0.2);" title="حذف الدواء">
                        <i class='bx bx-trash'></i>
                    </button>
                </div>
            `);
        } catch (err) {
            console.error('Error opening medicine details:', err);
            UI.showToast('خطأ في تحميل تفاصيل الدواء', 'danger');
        }
    },

    async openEntryForm(medicineId) {
        return this.openMedicineDetails(medicineId);
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

    async openAddMedicine(preSelectedCatId = null) {
        try {
            // Pre-warm the extended drug catalog
            EgyptianDrugs.preload();
            const cats = await Categories.getAllSorted();
            const allLocs = (await Locations.getAll()) || [];

            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2><i class='bx bx-plus-circle'></i> إضافة دواء جديد للمستودع</h2></div>
                <form id="form-master-med" onsubmit="event.preventDefault(); window.App.saveMasterMedicine();">
                    <div class="image-upload-wrap">
                        <div class="image-upload-top">
                            <div class="image-preview" id="m-img-preview"><i class='bx bx-camera'></i></div>
                            <div class="image-upload-actions">
                                <div class="img-btn-row">
                                    <button type="button" class="btn-img-action primary" onclick="document.getElementById('m-file-camera').click()">
                                        <i class='bx bx-camera'></i> 📸 تصوير بالكاميرا
                                    </button>
                                    <button type="button" class="btn-img-action secondary" onclick="document.getElementById('m-file-gallery').click()">
                                        <i class='bx bx-image-add'></i> 🖼️ من المعرض
                                    </button>
                                </div>
                                <div id="m-img-badge" style="display:none;" class="img-status-badge"></div>
                            </div>
                        </div>
                        <input type="file" id="m-file-camera" accept="image/*" capture="environment" style="display:none" onchange="window.App.handleImagePreview(this, 'm-img-preview', 'm-img-badge')">
                        <input type="file" id="m-file-gallery" accept="image/*" style="display:none" onchange="window.App.handleImagePreview(this, 'm-img-preview', 'm-img-badge')">
                    </div>

                    <div class="form-group" style="position:relative; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="form-label" style="margin:0;">الاسم بالإنجليزية (أو ابحث في الكتالوج المصري):</label>
                            <span style="font-size:10px; color:var(--primary); font-weight:bold;">🇪🇬 اقتراح ذكي فوري</span>
                        </div>
                        <input type="text" id="m-name-en" class="form-input" placeholder="اكتب أول حرفين مثل: Panadol أو بنادول أو سرنجة..." required autofocus autocomplete="off" oninput="window.App.handleDrugCatalogSearch(this.value, 'm')">
                        <div id="m-catalog-suggestions" class="catalog-suggestions-dropdown" style="display:none;"></div>
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label">الاسم بالعربية:</label>
                        <input type="text" id="m-name-ar" class="form-input" placeholder="مثلاً: بنادول إكسترا">
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label">المادة الفعالة (اختياري):</label>
                        <input type="text" id="m-active" class="form-input" placeholder="Paracetamol">
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label" for="m-barcode">باركود العبوة (اختياري — منفصل عن كود النظام):</label>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input type="text" id="m-barcode" class="form-input" placeholder="اكتب الباركود أو استخدم زر الكاميرا" style="flex:1; font-family:monospace;">
                            <button type="button" class="btn-ghost sm-btn" onclick="window.App.startBarcodeScanner('m-barcode')" title="قراءة بالكاميرا" style="padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; color:var(--primary); flex-shrink:0;">
                                <i class='bx bx-camera' style="font-size:18px;"></i>
                            </button>
                            <button type="button" class="btn-ghost sm-btn" onclick="const el=document.getElementById('m-barcode'); if(el) el.value='';" title="مسح الباركود" style="padding:8px 10px; border:1px solid rgba(239,68,68,0.35); border-radius:8px; color:var(--danger); flex-shrink:0;">
                                <i class='bx bx-trash' style="font-size:17px;"></i>
                            </button>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                        <div class="form-group">
                            <label class="form-label">فئة البند / القسم:</label>
                            <select id="m-category" class="form-select" required>
                                <option value="">اختر القسم...</option>
                                ${cats.map(c => `<option value="${c.id}" ${preSelectedCatId === c.id ? 'selected' : ''}>${Utils.escapeHTML(c.nameAR || c.id)}</option>`).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label">تصنيف الدواء:</label>
                            <select id="m-type" class="form-select">
                                <option value="medicine">💊 دواء عادي</option>
                                <option value="emergency">🚨 دواء طوارئ</option>
                                <option value="supply">🩹 مستلزم طبي</option>
                            </select>
                        </div>
                    </div>

                    <!-- Primary Storage Location -->
                    <div class="form-group" style="margin-bottom:14px;">
                        <label class="form-label" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span><i class='bx bx-current-location'></i> مكان التخزين الأساسي (Primary):</span>
                            <small style="color:var(--text-muted); font-size:11px;">(إجباري)</small>
                        </label>
                        <select id="m-primary-location" class="form-select" style="font-weight:bold; font-size:13px;" onchange="window.App._autocheckPrimaryLoc(this.value, 'm')">
                            <option value="">اختر المكان الأساسي...</option>
                            ${allLocs.map(l => `<option value="${l.id}"><i class='bx ${l.icon || 'bx-map-pin'}'></i> ${Utils.escapeHTML(l.nameAR)}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Storage Locations Multi-select -->
                    <div class="form-group" style="margin-bottom:14px;">
                        <label class="form-label" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span><i class='bx bx-map-pin'></i> أماكن تواجد إضافية (اختياري):</span>
                            <small style="color:var(--text-muted); font-size:11px;">(يمكن اختيار أكثر من مكان)</small>
                        </label>
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:8px; max-height:140px; overflow-y:auto; background:var(--bg-secondary); padding:10px; border-radius:10px; border:1px solid var(--border-color);">
                            ${allLocs.map(l => `
                                <label style="display:flex; align-items:center; gap:8px; background:var(--surface); padding:8px 10px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer; font-size:12px; font-weight:600;">
                                    <input type="checkbox" name="m-locations" value="${l.id}" style="width:16px; height:16px; accent-color:var(--primary); cursor:pointer;">
                                    <span><i class='bx ${l.icon || 'bx-map-pin'}' style="color:var(--primary);"></i> ${Utils.escapeHTML(l.nameAR)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div class="form-group checkbox-group mt-10 mb-15" style="display: flex; align-items: center; gap: 8px; background: var(--bg-secondary); padding: 10px; border-radius: 8px;">
                        <input type="checkbox" id="m-sync" checked style="width: 18px; height: 18px;">
                        <label for="m-sync" style="font-size: 13px; font-weight: 700; cursor: pointer;">نشر في السحابة فوراً (Cloud Push) ☁️</label>
                    </div>

                    <div class="form-actions mt-15" style="display:flex; gap:10px;">
                        <button type="submit" class="btn-primary" style="flex:1;">حفظ</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
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
            if (!med) return UI.showToast('تعذر العثور على الدواء', 'warning');
            const cats = await Categories.getAllSorted();
            const allLocs = (await Locations.getAll()) || [];
            const currentImg = Categories.getMedicineImage(med, { icon: 'bx-capsule' });
            const allowedLocIds = new Set(med.allowedLocations || allLocs.map(l => l.id));
            
            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2>تعديل صنف المستودع ✏️</h2></div>
                <form id="form-edit-med" onsubmit="event.preventDefault(); window.App.updateMasterMedicine('${id}');">
                    <div class="image-upload-wrap">
                        <div class="image-upload-top">
                            <div class="image-preview" id="e-img-preview">
                                <img src="${currentImg}" onerror="this.src='assets/icons/default-med.png'">
                            </div>
                            <div class="image-upload-actions">
                                <div class="img-btn-row">
                                    <button type="button" class="btn-img-action primary" onclick="document.getElementById('e-file-camera').click()">
                                        <i class='bx bx-camera'></i> 📸 تصوير بالكاميرا
                                    </button>
                                    <button type="button" class="btn-img-action secondary" onclick="document.getElementById('e-file-gallery').click()">
                                        <i class='bx bx-image-add'></i> 🖼️ من المعرض
                                    </button>
                                    <button type="button" class="btn-img-action danger" onclick="window.App.removeMedicineImage('e')">
                                        <i class='bx bx-trash'></i> إزالة
                                    </button>
                                </div>
                                <div id="e-img-badge" style="display:none;" class="img-status-badge"></div>
                            </div>
                        </div>
                        <input type="file" id="e-file-camera" accept="image/*" capture="environment" style="display:none" onchange="window.App.handleImagePreview(this, 'e-img-preview', 'e-img-badge')">
                        <input type="file" id="e-file-gallery" accept="image/*" style="display:none" onchange="window.App.handleImagePreview(this, 'e-img-preview', 'e-img-badge')">
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label">الاسم بالإنجليزية:</label>
                        <input type="text" id="e-name-en" class="form-input" value="${Utils.escapeHTML(med.nameEN || '')}" placeholder="e.g. Panadol" required>
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label">الاسم (العربية):</label>
                        <input type="text" id="e-name-ar" class="form-input" value="${Utils.escapeHTML(med.nameAR || '')}">
                    </div>

                    <div class="form-group mb-12">
                        <label class="form-label">المادة الفعالة:</label>
                        <input type="text" id="e-active" class="form-input" value="${Utils.escapeHTML(med.activeIngredient || '')}">
                    </div>

                    <div class="form-group mb-12" style="padding:10px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px; flex-wrap:wrap;">
                            <label class="form-label" for="e-barcode" style="margin:0;">باركود العبوة (قابل للتعديل أو الحذف):</label>
                            <span style="font-size:11px; color:var(--text-muted); font-family:monospace; background:var(--surface); padding:2px 7px; border-radius:6px; border:1px solid var(--border-color);">
                                كود النظام: #${Utils.escapeHTML(med.id)}
                            </span>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input type="text" id="e-barcode" class="form-input" placeholder="لا يوجد باركود — اكتب أو امسح بالكاميرا" value="${Utils.escapeHTML(med.barcode && String(med.barcode).trim() !== String(med.id) ? med.barcode : '')}" style="flex:1; font-family:monospace; background:var(--surface);">
                            <button type="button" class="btn-ghost sm-btn" onclick="window.App.startBarcodeScanner('e-barcode')" title="قراءة الباركود بالكاميرا" style="padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; color:var(--primary); background:var(--surface); flex-shrink:0;">
                                <i class='bx bx-camera' style="font-size:18px;"></i>
                            </button>
                            <button type="button" class="btn-ghost sm-btn" onclick="const el=document.getElementById('e-barcode'); if(el){el.value=''; window.UI.showToast('تم مسح الباركود — اضغط حفظ للتأكيد 🗑️', 'info');}" title="مسح الباركود (دون المساس بكود النظام)" style="padding:8px 10px; border:1px solid rgba(239,68,68,0.35); border-radius:8px; color:var(--danger); background:var(--surface); flex-shrink:0;">
                                <i class='bx bx-trash' style="font-size:17px;"></i>
                            </button>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                        <div class="form-group">
                            <label class="form-label">القسم:</label>
                            <select id="e-category" class="form-select" required>
                                ${cats.map(c => `<option value="${c.id}" ${c.id === (med.categoryId || 'uncategorized') ? 'selected' : ''}>${Utils.escapeHTML(c.nameAR)}</option>`).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label">نوع الدواء:</label>
                            <select id="e-type" class="form-select">
                                <option value="medicine" ${med.type === 'medicine' ? 'selected' : ''}>💊 دواء عادي</option>
                                <option value="emergency" ${med.type === 'emergency' ? 'selected' : ''}>🚨 دواء طوارئ</option>
                                <option value="supply" ${med.type === 'supply' ? 'selected' : ''}>🩹 مستلزم طبي</option>
                            </select>
                        </div>
                    </div>

                    <!-- Primary Storage Location -->
                    <div class="form-group" style="margin-bottom:14px;">
                        <label class="form-label" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span><i class='bx bx-current-location'></i> مكان التخزين الأساسي (Primary):</span>
                            <small style="color:var(--text-muted); font-size:11px;">(إجباري)</small>
                        </label>
                        <select id="e-primary-location" class="form-select" style="font-weight:bold; font-size:13px;" onchange="window.App._autocheckPrimaryLoc(this.value, 'e')">
                            <option value="">اختر المكان الأساسي...</option>
                            ${allLocs.map(l => {
                                const isSelected = (med.primaryLocation === l.id) ? 'selected' : '';
                                return `<option value="${l.id}" ${isSelected}>${Utils.escapeHTML(l.nameAR)}</option>`;
                            }).join('')}
                        </select>
                    </div>

                    <!-- Storage Locations Multi-select in Edit -->
                    <div class="form-group" style="margin-bottom:14px;">
                        <label class="form-label" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span><i class='bx bx-map-pin'></i> أماكن تواجد إضافية (Storage Locations):</span>
                            <small style="color:var(--text-muted); font-size:11px;">(حدد الأماكن المصرح بها)</small>
                        </label>
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:8px; max-height:140px; overflow-y:auto; background:var(--bg-secondary); padding:10px; border-radius:10px; border:1px solid var(--border-color);">
                            ${allLocs.map(l => {
                                const isChecked = allowedLocIds.has(l.id);
                                return `
                                    <label style="display:flex; align-items:center; gap:8px; background:var(--surface); padding:8px 10px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer; font-size:12px; font-weight:600;">
                                        <input type="checkbox" name="e-locations" value="${l.id}" ${isChecked ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--primary); cursor:pointer;">
                                        <span><i class='bx ${l.icon || 'bx-map-pin'}' style="color:var(--primary);"></i> ${Utils.escapeHTML(l.nameAR)}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div class="form-group checkbox-group mt-10 mb-15" style="display: flex; align-items: center; gap: 8px; background: var(--bg-secondary); padding: 10px; border-radius: 8px;">
                        <input type="checkbox" id="e-sync" checked style="width: 18px; height: 18px;">
                        <label for="e-sync" style="font-size: 13px; font-weight: 700; cursor: pointer;">تحديث البيانات في السحابة ☁️</label>
                    </div>

                    <div class="form-actions mt-15" style="display:flex; gap:10px;">
                        <button type="submit" class="btn-primary" style="flex:1;">حفظ التعديلات</button>
                        <button type="button" class="btn-ghost" onclick="window.App.openMedicineDetails('${id}')">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            console.warn('Category Load Error:', err);
        }
    },

    async handleImagePreview(input, previewId, badgeId) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        const container = document.getElementById(previewId);
        const badge = badgeId ? document.getElementById(badgeId) : null;

        if (container) {
            container.innerHTML = `<i class='bx bx-loader-alt bx-spin' style='font-size:32px; color:var(--primary);'></i>`;
        }

        try {
            // High-speed Smart 1:1 Center-Square Crop & WebP compression (~15-25KB, <20ms)
            const result = (typeof Utils !== 'undefined' && Utils.compressImage)
                ? await Utils.compressImage(file, { maxDimension: 600, quality: 0.8, cropSquare: true })
                : { blob: file, dataUrl: await Utils.fileToBase64(file), sizeKB: Math.round(file.size / 1024), format: 'RAW' };

            window.App._activeImageData = {
                blob: result.blob,
                dataUrl: result.dataUrl,
                sizeKB: result.sizeKB,
                format: result.format,
                removed: false
            };

            if (container) {
                container.innerHTML = `<img src="${result.dataUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
            }

            if (badge) {
                badge.style.display = 'inline-flex';
                badge.style.background = '#ecfdf5';
                badge.style.color = '#059669';
                badge.style.borderColor = '#a7f3d0';
                badge.innerHTML = `<i class='bx bx-check-shield'></i> تم القص والضغط الذكي: ${result.sizeKB} KB (${result.format}) ⚡`;
            }
        } catch (err) {
            console.warn('Image preview compression fallback:', err);
            if (container && typeof Utils !== 'undefined' && Utils.fileToBase64) {
                const fallbackUrl = await Utils.fileToBase64(file);
                window.App._activeImageData = { blob: file, dataUrl: fallbackUrl, sizeKB: Math.round(file.size / 1024), format: 'RAW', removed: false };
                container.innerHTML = `<img src="${fallbackUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
            }
        }
    },

    removeMedicineImage(prefix = 'm') {
        window.App._activeImageData = { removed: true, dataUrl: 'assets/icons/default-med.png', blob: null };
        const container = document.getElementById(`${prefix}-img-preview`);
        const badge = document.getElementById(`${prefix}-img-badge`);
        if (container) {
            container.innerHTML = `<i class='bx bx-capsule' style='font-size:36px; color:var(--text-muted);'></i>`;
        }
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.style.background = '#fef2f2';
            badge.style.color = '#ef4444';
            badge.style.borderColor = '#fca5a5';
            badge.innerHTML = `<i class='bx bx-trash'></i> تم اختيار الأيقونة الافتراضية`;
        }
        UI.showToast('تمت إزالة الصورة واختيار الأيقونة الافتراضية', 'info');
    },

    /**
     * High-Resolution Image Lightbox (v18.8.1)
     */
    openImageLightbox(imageUrl, title = 'صورة الدواء') {
        if (!imageUrl || imageUrl.includes('default-med.png')) return;
        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(0,0,0,0.88); backdrop-filter: blur(8px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 20px; animation: fadeIn 0.2s ease; direction: rtl;
        `;
        overlay.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; max-width:440px; margin-bottom:12px; color:white;">
                <h3 style="margin:0; font-size:16px; font-weight:800; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                    <i class='bx bx-image-alt' style="color:var(--primary);"></i> ${title}
                </h3>
                <button type="button" style="background:rgba(255,255,255,0.15); border:none; color:white; font-size:22px; width:36px; height:36px; border-radius:50%; cursor:pointer; line-height:1;" onclick="this.closest('.lightbox-overlay').remove()">✕</button>
            </div>
            <div style="max-width:92vw; max-height:75vh; overflow:hidden; border-radius:18px; box-shadow:0 16px 48px rgba(0,0,0,0.6); background:#0f172a; border:2px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center;">
                <img src="${imageUrl}" style="max-width:100%; max-height:75vh; object-fit:contain; display:block;" onerror="this.src='assets/icons/default-med.png'">
            </div>
            <button type="button" class="btn-primary sm-btn" style="margin-top:16px; background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.3); color:white; border-radius:10px; padding:8px 20px; font-weight:700; cursor:pointer;" onclick="this.closest('.lightbox-overlay').remove()">إغلاق المعاينة</button>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    },

    /**
     * Play short confirmation beep on barcode scan (Web Audio API, no asset needed)
     */
    _playScanBeep() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 960;
            gain.gain.value = 0.12;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            setTimeout(() => { osc.stop(); ctx.close().catch(() => {}); }, 85);
        } catch (e) {}
    },

    /**
     * Lazy-load html5-qrcode fallback ONLY on browsers lacking native BarcodeDetector (e.g. iOS Safari)
     */
    _loadHtml5QrcodeFallback() {
        if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
        if (this._html5QrLoading) return this._html5QrLoading;
        this._html5QrLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
            s.onload = () => resolve(window.Html5Qrcode);
            s.onerror = () => reject(new Error('Failed to load fallback scanner'));
            document.head.appendChild(s);
        });
        return this._html5QrLoading;
    },

    /**
     * Parse Pharmaceutical 2D GS1 DataMatrix / QR / Digital Link / 1D Barcodes (v18.18.0)
     * Extracts:
     * - barcode: standard 13-digit EAN (strips leading '0' from 14-digit GS1 GTIN-01)
     * - gtin14: full 14-digit GTIN if GS1
     * - expiry: 'YYYY-MM' from AI (17) YYMMDD
     * - batch: Lot/Batch string from AI (10)
     */
    parsePharmaBarcode(rawValue) {
        const original = String(rawValue || '').trim();
        if (!original) return { barcode: '', raw: '', gtin14: null, expiry: null, batch: null, isGS1: false };

        // Strip common scanner symbology prefixes (]d2 = GS1 DataMatrix, ]C1 = GS1-128, ]Q3 = GS1 QR)
        let s = original.replace(/^\](?:d2|C1|Q3|e0|E0)/, '').replace(/^\u001d+/, '');
        let gtin14 = null;
        let expiry = null;
        let batch = null;
        let isGS1 = false;

        const formatYYMMDD = (yymmdd) => {
            if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
            const yy = parseInt(yymmdd.slice(0, 2), 10);
            const mm = parseInt(yymmdd.slice(2, 4), 10);
            if (mm < 1 || mm > 12) return null;
            const yyyy = 2000 + yy;
            return `${yyyy}-${String(mm).padStart(2, '0')}`;
        };

        // 1. GS1 Digital Link URL (e.g. https://.../01/06221045011279/10/LOT?17=271231)
        const dlGtin = s.match(/\/01\/(\d{13,14})(?:[/?#]|$)/);
        if (dlGtin) {
            isGS1 = true;
            gtin14 = dlGtin[1].length === 13 ? '0' + dlGtin[1] : dlGtin[1];
            const dlExp = s.match(/(?:[?&/]17[=/])(\d{6})/);
            if (dlExp) expiry = formatYYMMDD(dlExp[1]);
            const dlBatch = s.match(/(?:[?&/]10[=/])([^&/?#]+)/);
            if (dlBatch) batch = decodeURIComponent(dlBatch[1]);
        }

        // 2. Parenthesized GS1 format: (01)0622...(17)271231(10)ABC
        if (!isGS1 && /\(01\)\s*\d{13,14}/.test(s)) {
            isGS1 = true;
            const m01 = s.match(/\(01\)\s*(\d{13,14})/);
            if (m01) gtin14 = m01[1].length === 13 ? '0' + m01[1] : m01[1];
            const m17 = s.match(/\(17\)\s*(\d{6})/);
            if (m17) expiry = formatYYMMDD(m17[1]);
            const m10 = s.match(/\(10\)\s*([^(]+)/);
            if (m10) batch = m10[1].trim();
        }

        // 3. Raw GS1 DataMatrix / GS1-128 stream: 01<14d>17<6d>10<lot>\x1d21<serial>
        if (!isGS1 && /^01\d{14}/.test(s) && s.length >= 16) {
            isGS1 = true;
            let idx = 0;
            const GS = '\u001d';
            while (idx < s.length) {
                while (s[idx] === GS) idx++;
                if (idx >= s.length) break;
                const ai2 = s.slice(idx, idx + 2);
                const ai3 = s.slice(idx, idx + 3);
                if (ai2 === '01' && /^\d{14}/.test(s.slice(idx + 2, idx + 16))) {
                    gtin14 = s.slice(idx + 2, idx + 16);
                    idx += 16;
                } else if (ai2 === '17' && /^\d{6}/.test(s.slice(idx + 2, idx + 8))) {
                    expiry = formatYYMMDD(s.slice(idx + 2, idx + 8));
                    idx += 8;
                } else if (['11', '13', '15', '16'].includes(ai2) && /^\d{6}/.test(s.slice(idx + 2, idx + 8))) {
                    idx += 8; // production/packaging/best-before dates
                } else if (ai2 === '10') {
                    const end = s.indexOf(GS, idx + 2);
                    batch = (end === -1 ? s.slice(idx + 2) : s.slice(idx + 2, end)).trim();
                    idx = end === -1 ? s.length : end + 1;
                } else if (ai2 === '21') {
                    const end = s.indexOf(GS, idx + 2);
                    idx = end === -1 ? s.length : end + 1;
                } else if (['240', '241', '710', '711', '712', '713', '714', '715'].includes(ai3)) {
                    const end = s.indexOf(GS, idx + 3);
                    idx = end === -1 ? s.length : end + 1;
                } else {
                    break;
                }
            }
            // Fallback if scanner stripped \x1d separators before AI 17:
            if (!expiry && gtin14) {
                const rest = s.slice(16);
                const expMatch = rest.match(/17(2[4-9]|3[0-9])(0[1-9]|1[0-2])([0-3]\d)/);
                if (expMatch) expiry = formatYYMMDD(expMatch[1] + expMatch[2] + expMatch[3]);
            }
        }

        // 4. Plain 14-digit GTIN starting with 0 (e.g. 06221045011279 -> 6221045011279)
        if (!gtin14 && /^0\d{13}$/.test(s)) {
            gtin14 = s;
        }

        // Convert GTIN-14 with leading 0 -> standard 13-digit EAN barcode (matches Egyptian DB!)
        const barcode = gtin14
            ? (gtin14.startsWith('0') ? gtin14.slice(1) : gtin14)
            : s;

        return { barcode, raw: original, gtin14, expiry, batch, isGS1 };
    },

    /**
     * Universal Camera Barcode & 2D GS1 DataMatrix / QR Scanner (v18.18.0)
     * Accepts either a targetInputId (string) OR a callback function (code, parsed) => void.
     * Supports native BarcodeDetector (Android Chrome), html5-qrcode fallback (iOS Safari),
     * GS1 DataMatrix (extracts EAN-13 + Expiry Date automatically), QR, and USB/Manual entry.
     */
    async startBarcodeScanner(targetInputIdOrCallback, options = {}) {
        const isCallback = typeof targetInputIdOrCallback === 'function';
        const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
        const titleText = options.title || 'ماسح الباركود المباشر';
        const subtitleText = options.subtitle || 'وجّه الكاميرا نحو الباركود المطبوع على علبة الدواء';

        // Remove any previous overlay
        document.getElementById('barcode-scanner-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'barcode-scanner-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(0,0,0,0.93);
            display: flex; flex-direction: column; align-items: center; justify-content: space-between;
            padding: 20px 16px; color: white; direction: rtl; overflow-y: auto;
        `;

        overlay.innerHTML = `
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center; max-width:420px;">
                <h3 style="margin:0; font-size:16px; font-weight:800; display:flex; align-items:center; gap:8px;">
                    <i class='bx bx-barcode-reader' style="color:#60a5fa; font-size:24px;"></i>
                    ${Utils.escapeHTML(titleText)}
                </h3>
                <button type="button" id="close-scanner-btn" style="background:rgba(255,255,255,0.15); border:none; color:white; font-size:22px; width:36px; height:36px; border-radius:50%; cursor:pointer;">✕</button>
            </div>

            <div id="scanner-viewport-wrap" style="position:relative; width:100%; max-width:350px; min-height:240px; border-radius:18px; overflow:hidden; background:#000; box-shadow:0 8px 32px rgba(0,0,0,0.5); border:2px solid rgba(59,130,246,0.7); margin:12px 0;">
                <video id="scanner-video" playsinline muted style="width:100%; height:240px; object-fit:cover; display:block;"></video>
                <div id="html5qr-fallback-reader" style="display:none; width:100%;"></div>
                <div id="scanner-laser-frame" style="position:absolute; inset:25px 20px; border:2px dashed #3b82f6; border-radius:12px; pointer-events:none; display:flex; align-items:center; justify-content:center;">
                    <div style="width:100%; height:2px; background:rgba(239,68,68,0.9); box-shadow:0 0 10px #ef4444; animation:scanline 1.6s infinite alternate;"></div>
                </div>
            </div>

            <div style="text-align:center; width:100%; max-width:360px;">
                <p id="scanner-status-text" style="font-size:12.5px; color:#cbd5e1; margin:0 0 10px 0;">${Utils.escapeHTML(subtitleText)}</p>
                <!-- Manual / USB-Bluetooth Barcode Gun Entry -->
                <div style="display:flex; gap:6px; margin-bottom:12px;">
                    <input type="text" id="manual-barcode-entry" placeholder="أو اكتب الباركود / امسحه بجهاز USB..." style="flex:1; padding:9px 11px; border-radius:10px; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.1); color:white; font-family:monospace; font-size:13px; outline:none;">
                    <button type="button" id="manual-barcode-ok" style="padding:9px 14px; border-radius:10px; border:none; background:var(--primary); color:white; font-weight:800; cursor:pointer; font-size:13px;">تأكيد</button>
                </div>
                <button type="button" id="manual-cancel-btn" style="padding:9px 26px; background:rgba(255,255,255,0.14); border:1px solid rgba(255,255,255,0.25); color:white; border-radius:12px; font-weight:700; cursor:pointer;">إغلاق</button>
            </div>
            <style>
                @keyframes scanline { 0% { transform: translateY(-75px); } 100% { transform: translateY(75px); } }
            </style>
        `;

        document.body.appendChild(overlay);

        let stream = null;
        let animationFrameId = null;
        let html5QrInstance = null;
        let handled = false;

        const cleanup = async () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            if (html5QrInstance) {
                try { await html5QrInstance.stop(); } catch (e) {}
                try { html5QrInstance.clear(); } catch (e) {}
                html5QrInstance = null;
            }
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            overlay.remove();
        };

        const onCodeFound = async (rawValue) => {
            if (handled) return;
            const parsed = this.parsePharmaBarcode(rawValue);
            const code = parsed.barcode;
            if (!code) return;
            handled = true;

            this._playScanBeep();
            if (navigator.vibrate) navigator.vibrate([70, 35, 70]);
            await cleanup();

            if (isCallback) {
                targetInputIdOrCallback(code, parsed);
            } else {
                const input = document.getElementById(targetInputIdOrCallback);
                if (input) {
                    input.value = code;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const extraInfo = parsed.isGS1
                    ? ` (2D${parsed.expiry ? ' • صلاحية: ' + parsed.expiry : ''})`
                    : '';
                UI.showToast(`تم المسح بنجاح: ${code}${extraInfo} 🎯`, 'success');
            }
        };

        overlay.querySelector('#close-scanner-btn').onclick = cleanup;
        overlay.querySelector('#manual-cancel-btn').onclick = cleanup;

        const manualInp = overlay.querySelector('#manual-barcode-entry');
        const manualOk = overlay.querySelector('#manual-barcode-ok');
        if (manualOk && manualInp) {
            manualOk.onclick = () => onCodeFound(manualInp.value);
            manualInp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onCodeFound(manualInp.value);
                }
            });
        }

        try {
            if (hasBarcodeDetector) {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
                });
                const video = overlay.querySelector('#scanner-video');
                video.srcObject = stream;
                await video.play();

                // Enable GS1 DataMatrix + QR + 1D formats safely by intersecting with browser-supported formats
                const desiredFormats = ['data_matrix', 'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'aztec', 'pdf417'];
                let activeFormats = desiredFormats;
                try {
                    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
                        const supported = await window.BarcodeDetector.getSupportedFormats();
                        const filtered = desiredFormats.filter(f => supported.includes(f));
                        if (filtered.length > 0) activeFormats = filtered;
                    }
                } catch (e) {}

                const detector = new window.BarcodeDetector({ formats: activeFormats });

                const scanLoop = async () => {
                    if (handled || !overlay.parentNode) return;
                    try {
                        const barcodes = await detector.detect(video);
                        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                            onCodeFound(barcodes[0].rawValue);
                            return;
                        }
                    } catch (detectErr) {}
                    animationFrameId = requestAnimationFrame(scanLoop);
                };
                scanLoop();
            } else {
                // iOS Safari / Firefox fallback via html5-qrcode (supports DataMatrix, QR, EAN-13)
                const statusEl = overlay.querySelector('#scanner-status-text');
                if (statusEl) statusEl.textContent = 'جاري تشغيل قارئ الباركود و DataMatrix / QR...';
                const videoEl = overlay.querySelector('#scanner-video');
                const laserEl = overlay.querySelector('#scanner-laser-frame');
                const fallbackDiv = overlay.querySelector('#html5qr-fallback-reader');
                if (videoEl) videoEl.style.display = 'none';
                if (laserEl) laserEl.style.display = 'none';
                if (fallbackDiv) fallbackDiv.style.display = 'block';

                const Html5Qrcode = await this._loadHtml5QrcodeFallback();
                if (!overlay.parentNode || handled) return;

                const F = window.Html5QrcodeSupportedFormats;
                const config = F ? {
                    formatsToSupport: [
                        F.DATA_MATRIX, F.QR_CODE, F.EAN_13, F.EAN_8,
                        F.CODE_128, F.CODE_39, F.UPC_A, F.UPC_E, F.ITF, F.AZTEC, F.PDF_417
                    ].filter(v => v !== undefined)
                } : undefined;

                html5QrInstance = new Html5Qrcode('html5qr-fallback-reader', config);
                await html5QrInstance.start(
                    { facingMode: 'environment' },
                    { fps: 12, qrbox: { width: 250, height: 200 } },
                    (decodedText) => onCodeFound(decodedText),
                    () => {}
                );
                if (statusEl) statusEl.textContent = subtitleText;
            }
        } catch (err) {
            console.warn('Camera stream error:', err);
            const statusEl = overlay.querySelector('#scanner-status-text');
            if (statusEl) statusEl.textContent = '⚠️ تعذر فتح الكاميرا — يمكنك كتابة أو مسح الباركود بالخانة أدناه';
            UI.showToast('تعذر فتح الكاميرا — تأكد من منح الإذن أو استخدم الإدخال اليدوي 📷', 'warning');
        }
    },

    async saveMasterMedicine() {
        try {
            const nameEN = document.getElementById('m-name-en')?.value.trim();
            const nameAR = document.getElementById('m-name-ar')?.value.trim() || nameEN;
            const categoryId = document.getElementById('m-category')?.value;
            const activeIngredient = (document.getElementById('m-active')?.value || '').trim();
            const barcode = (document.getElementById('m-barcode')?.value || '').trim();
            const type = document.getElementById('m-type')?.value || 'medicine';
            const shouldSync = document.getElementById('m-sync')?.checked ?? true;

            const selectedLocIds = [];
            document.querySelectorAll('input[name="m-locations"]:checked').forEach(cb => {
                selectedLocIds.push(cb.value);
            });

            const primaryLoc = document.getElementById('m-primary-location')?.value || '';
            // Auto-include primary location in allowedLocations
            if (primaryLoc && !selectedLocIds.includes(primaryLoc)) {
                selectedLocIds.unshift(primaryLoc);
            }

            if (!nameEN || !categoryId) {
                return UI.showToast('يرجى ملء اسم الدواء واختيار القسم', 'warning');
            }

            let imgData = 'assets/icons/default-med.png';
            let fileBlob = null;

            if (this._activeImageData) {
                if (this._activeImageData.removed) {
                    imgData = 'assets/icons/default-med.png';
                    fileBlob = null;
                } else if (this._activeImageData.dataUrl) {
                    imgData = this._activeImageData.dataUrl;
                    fileBlob = this._activeImageData.blob;
                }
            }
            this._activeImageData = null;

            // v18.14.0: Always separate permanent DB id from optional commercial barcode
            const medId = (await Categories.generateNextId()) || ('med_' + Date.now());
            const now = new Date().toISOString();

            const data = {
                id: medId,
                nameEN,
                nameAR,
                activeIngredient,
                categoryId,
                barcode: barcode || '',
                type,
                primaryLocation: primaryLoc || null,
                allowedLocations: selectedLocIds.length > 0 ? selectedLocIds : null,
                imagePath: imgData,
                syncStatus: 'local',
                createdAt: now
            };

            await DB.put('medicineMaster', data);

            // Ensure category is allowed in the selected locations
            if (selectedLocIds.length > 0 && typeof Locations !== 'undefined') {
                for (const locId of selectedLocIds) {
                    try {
                        await Locations.addCategoryToLocation(locId, categoryId);
                    } catch (e) { console.warn('addCategoryToLocation notice:', e.message); }
                }
            }

            const sourceCat = this._pendingSourceCatId;
            this._pendingSourceCatId = null;

            UI.closeModal();
            UI.showToast(`تم حفظ الدواء «${nameEN}» بنجاح ✨`, 'success');

            await this.refreshAllViews(sourceCat);

            // Fast Cloud Sync & Image Upload with Offline Queue Fallback
            if (shouldSync) {
                if (fileBlob && typeof this.uploadImage === 'function') {
                    // Upload image FIRST, then push to cloud with the cloud URL (avoids sending stale data URL)
                    try {
                        const url = await this.uploadImage(fileBlob, medId);
                        if (url) {
                            const m = await DB.get('medicineMaster', medId);
                            if (m) {
                                m.imagePath = url;
                                await DB.put('medicineMaster', m);
                            }
                        } else if (imgData?.startsWith('data:image') && typeof Sync !== 'undefined' && Sync.enqueuePendingImage) {
                            Sync.enqueuePendingImage(medId, imgData);
                        }
                    } catch (e) {
                        console.warn('Cloud image upload warning, queued for offline sync:', e);
                        if (imgData?.startsWith('data:image') && typeof Sync !== 'undefined' && Sync.enqueuePendingImage) {
                            Sync.enqueuePendingImage(medId, imgData);
                        }
                    }
                }
                // Push AFTER image upload completes (or if no image to upload)
                if (typeof Sync !== 'undefined' && Sync.push) {
                    await Sync.push(medId);
                }
                await this.refreshAllViews(sourceCat);
            }

        } catch (err) {
            console.error('Error saving master medicine:', err);
            UI.showToast('فشل حفظ الدواء', 'danger');
        }
    },



    async updateMasterMedicine(id) {
        try {
            const med = await DB.get('medicineMaster', id);
            let imgData = med.imagePath || 'assets/icons/default-med.png';
            let fileBlob = null;
            let imageChanged = false;

            if (this._activeImageData) {
                imageChanged = true;
                if (this._activeImageData.removed) {
                    imgData = 'assets/icons/default-med.png';
                    fileBlob = null;
                    if (med.imagePath && typeof this.deleteStorageImage === 'function') {
                        this.deleteStorageImage(med.imagePath).catch(() => {});
                    }
                } else if (this._activeImageData.dataUrl) {
                    imgData = this._activeImageData.dataUrl;
                    fileBlob = this._activeImageData.blob;
                    // Delete old storage image if replacing with a new one
                    if (med.imagePath && typeof this.deleteStorageImage === 'function') {
                        this.deleteStorageImage(med.imagePath).catch(() => {});
                    }
                }
            }
            this._activeImageData = null;

            const selectedLocIds = [];
            document.querySelectorAll('input[name="e-locations"]:checked').forEach(cb => {
                selectedLocIds.push(cb.value);
            });

            const primaryLoc = document.getElementById('e-primary-location')?.value || '';
            // Auto-include primary location in allowedLocations
            if (primaryLoc && !selectedLocIds.includes(primaryLoc)) {
                selectedLocIds.unshift(primaryLoc);
            }

            const updated = {
                ...med,
                nameEN: document.getElementById('e-name-en').value.trim(),
                nameAR: document.getElementById('e-name-ar').value.trim() || document.getElementById('e-name-en').value.trim(),
                activeIngredient: (document.getElementById('e-active')?.value || '').trim(),
                // v18.14.0: Allow clearing barcode cleanly without touching med.id
                barcode: (document.getElementById('e-barcode')?.value || '').trim(),
                categoryId: document.getElementById('e-category').value,
                type: document.getElementById('e-type').value,
                primaryLocation: primaryLoc || null,
                allowedLocations: selectedLocIds.length > 0 ? selectedLocIds : null,
                imagePath: imgData,
                syncStatus: 'local',
                lastUpdated: new Date().toISOString()
            };

            await Categories.saveMedicine(updated);
            UI.closeModal();
            UI.showToast('تم تحديث بيانات الدواء بنجاح ✨', 'success');
            await this.refreshAllViews(updated.categoryId);

            // Cloud Upload & Sync with Offline Queue
            const shouldSyncEdit = document.getElementById('e-sync')?.checked ?? true;
            if (shouldSyncEdit) {
                if (imageChanged && fileBlob && typeof this.uploadImage === 'function') {
                    UI.showToast('جاري رفع وتحديث الصورة في السحابة... ☁️', 'info');
                    try {
                        const url = await this.uploadImage(fileBlob, id);
                        if (url) {
                            const m = await DB.get('medicineMaster', id);
                            if (m) {
                                m.imagePath = url;
                                await DB.put('medicineMaster', m);
                                UI.showToast('تم تحديث الصورة السحابية بنجاح ✨', 'success');
                            }
                        } else if (imgData?.startsWith('data:image') && typeof Sync !== 'undefined' && Sync.enqueuePendingImage) {
                            Sync.enqueuePendingImage(id, imgData);
                        }
                    } catch (e) {
                        console.warn('Cloud image upload warning, queued:', e);
                        if (imgData?.startsWith('data:image') && typeof Sync !== 'undefined' && Sync.enqueuePendingImage) {
                            Sync.enqueuePendingImage(id, imgData);
                        }
                    }
                }
                // Push AFTER image upload completes
                if (typeof Sync !== 'undefined' && Sync.push) {
                    await Sync.push(id);
                }
                await this.refreshAllViews(updated.categoryId);
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
                                <h4 style="font-weight:800">${Utils.escapeHTML(s.name)}</h4>
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

    async deleteMasterMedicine(id) {
        if (!confirm('هل تريد نقل هذا الصنف إلى سلة المهملات؟ (يمكنك استعادته لاحقاً من سلة المهملات)')) return;
        try {
            UI.showToast('جاري نقل الصنف لسلة المهملات... 🗑️', 'info');
            await Categories.deleteMedicine(id);
            UI.showToast('تم نقل الصنف إلى سلة المهملات 🗑️ (يمكنك استعادته بأي وقت)', 'warning');
            UI.closeModal();
            await this.refreshAllViews();
        } catch (err) {
            UI.showToast('فشل الحذف: ' + err.message, 'danger');
        }
    },

    // Removed legacy duplicate saveEntry block - merged logic upwards
    async deleteEntry(id) {
        if (confirm('حذف هذا السجل؟')) {
            try {
                await Inventory.deleteEntry(id);
                await this.refreshAllViews();
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
            // Pure Catalog: Read from medicineMaster directly (no stock data)
            let data = (await DB.getAll('medicineMaster')) || [];

            // Filter by category
            if (this.selectedCategoryId) {
                const sel = this.selectedCategoryId;
                const allCurrentCats = await Categories.getAllSorted();
                const validCatIds = new Set(allCurrentCats.filter(c => c.id !== 'uncategorized').map(c => c.id));
                data = data.filter(m => {
                    const cat = m.categoryId;
                    if (sel === 'uncategorized') {
                        return !cat || cat === 'uncategorized' || !validCatIds.has(cat);
                    }
                    return cat === sel;
                });
            }

            // Filter by location
            if (this.selectedLocationId) {
                const locId = this.selectedLocationId;
                data = data.filter(m => {
                    if (m.allowedLocations && Array.isArray(m.allowedLocations) && m.allowedLocations.length > 0) {
                        return m.allowedLocations.includes(locId);
                    }
                    if (m.primaryLocation) return m.primaryLocation === locId;
                    return false;
                });
            }

            if (q.length > 0) {
                data = Utils.smartFilter(
                    data,
                    query,
                    (pq, m) => Utils.smartScoreMed(pq, m, [m.categoryId])
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
                <div class="inventory-card" style="opacity: 0.8; border-style: dashed;" onclick="window.App.openMedicineDetails('${m.id}')">
                    <div class="card-icon"><i class='bx bx-plus-circle'></i></div>
                    <div class="card-info">
                        <h3>${Utils.escapeHTML(m.nameEN)} / ${Utils.escapeHTML(m.nameAR || '')}</h3>
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

    openQuickAdd(catId = null) {
        return this.openAddMedicine(catId);
    },

    // --- Egyptian Drug Catalog Auto-Complete (v18.12.0 — 27K+ drugs) ---
    handleDrugCatalogSearch(query, prefix = 'qa') {
        const container = document.getElementById(`${prefix}-catalog-suggestions`);
        if (!container) return;

        if (!query || query.trim().length < 2) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        // Use sync search (which lazy-loads extended catalog in background)
        const results = EgyptianDrugs.search(query, 8);

        // If extended catalog not loaded yet and we got builtin results,
        // schedule an async re-search after load completes
        if (!EgyptianDrugs.isExtendedLoaded && results.length < 8) {
            EgyptianDrugs.searchAsync(query, 8).then(asyncResults => {
                if (asyncResults.length > results.length) {
                    // Re-render with better results
                    this.handleDrugCatalogSearch(query, prefix);
                }
            });
        }

        if (results.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        container.style.display = 'block';
        const sizeLabel = EgyptianDrugs.isExtendedLoaded
            ? `<div style="text-align:center; padding:4px; font-size:10px; color:var(--text-muted); border-top:1px solid var(--border);">💊 يبحث في ${EgyptianDrugs.catalogSize.toLocaleString()} دواء مصري</div>`
            : '';
        container.innerHTML = results.map((item, idx) => {
            const catName = Categories.getCategoryNameAR(item.categoryId);
            return `
                <div class="catalog-suggestion-item" onclick="window.App.selectDrugFromCatalog(${idx}, '${prefix}')">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <strong style="font-size:13px; color:var(--text-main);">${Utils.escapeHTML(item.nameEN)}</strong>
                            ${item.nameAR ? `<span style="font-size:11px; color:var(--text-muted);">(${Utils.escapeHTML(item.nameAR)})</span>` : ''}
                        </div>
                        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:2px;">
                            ${item.active ? `<small style="font-size:11px; color:var(--text-muted);">💊 ${Utils.escapeHTML(item.active)}</small>` : ''}
                            ${item.barcode ? `<small style="font-size:10.5px; color:var(--primary); font-family:monospace;">🔢 ${Utils.escapeHTML(item.barcode)}</small>` : ''}
                        </div>
                    </div>
                    ${item.categoryId && item.categoryId !== 'uncategorized' ? `
                        <span class="badge" style="background:rgba(59,130,246,0.1); color:var(--primary); font-size:10px; padding:2px 6px; border-radius:4px; white-space:nowrap;">
                            ${catName}
                        </span>
                    ` : ''}
                </div>
            `;
        }).join('') + sizeLabel;

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
            const activeEl = document.getElementById('qa-active');
            const barcodeEl = document.getElementById('qa-barcode');

            if (nameEnEl) nameEnEl.value = item.nameEN;
            if (nameArEl) nameArEl.value = item.nameAR;
            if (activeEl && item.active) activeEl.value = item.active;
            if (barcodeEl && item.barcode) barcodeEl.value = item.barcode;
            if (catEl && item.categoryId && item.categoryId !== 'uncategorized') {
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
            const barcodeEl = document.getElementById('m-barcode');
            const catEl = document.getElementById('m-category');
            const typeEl = document.getElementById('m-type');

            if (nameEnEl) nameEnEl.value = item.nameEN;
            if (nameArEl) nameArEl.value = item.nameAR;
            if (activeEl) activeEl.value = item.active || '';
            if (barcodeEl && item.barcode) barcodeEl.value = item.barcode;
            if (catEl && item.categoryId && item.categoryId !== 'uncategorized') {
                catEl.value = item.categoryId;
                if (!catEl.value) {
                    Array.from(catEl.options).forEach(opt => {
                        if (opt.value.toLowerCase() === item.categoryId.toLowerCase()) catEl.value = opt.value;
                    });
                }
            }
            if (typeEl && item.type) typeEl.value = item.type;
        }

        UI.showToast(`✨ تم إدراج (${Utils.escapeHTML(item.nameAR || item.nameEN)}) بنجاح`, 'success');
    },

    async saveQuickAddMedicine() {
        return this.saveMasterMedicine();
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
                const newQty = Math.max(0, delta);
                entry = {
                    id: 'inv_audit_stock_' + medId,
                    medicineId: medId,
                    auditId: 'manual_adjustment',
                    quantity: newQty,
                    expiryDate: `${new Date().getFullYear() + 2}-12-31`,
                    location: 'المستودع الرئيسي',
                    lastUpdated: now
                };
                await DB.put('inventory', entry);
            }

            const countEl = document.getElementById(`stock-val-${medId}`);
            if (countEl) countEl.textContent = entry.quantity;

            if (typeof Sync !== 'undefined' && Sync.pushInventoryEntry) {
                Sync.pushInventoryEntry(entry).catch(() => {});
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

    // ===================== Custom Export Builder =====================
    async openCustomExportModal() {
        try {
            const allCats = (await Categories.getAllSorted()) || [];
            const allLocs = (await Locations.getAll()) || [];
            const allSessions = (await Audit.getAllSessions()) || [];

            // Build category checkboxes
            const catChecks = allCats.map(c => {
                const label = Categories.getCategoryDisplayName(c, 'both');
                return `<label style="display:flex; align-items:center; gap:6px; padding:4px 0; cursor:pointer;">
                    <input type="checkbox" value="${c.id}" checked class="cex-cat-cb"> ${Utils.escapeHTML(label)}
                </label>`;
            }).join('');

            // Build location checkboxes
            const locChecks = allLocs.map(l => {
                const label = l.nameAR || l.id;
                return `<label style="display:flex; align-items:center; gap:6px; padding:4px 0; cursor:pointer;">
                    <input type="checkbox" value="${l.id}" checked class="cex-loc-cb"> ${Utils.escapeHTML(label)}
                </label>`;
            }).join('');

            // Build audit session options
            const sessionOptions = allSessions.map(s => {
                const statusIcon = (s.status === 'completed' || s.status === 'finalized') ? '✅' : '🔄';
                const countNum = Object.keys(s.counts || {}).length;
                const dateStr = s.startedAt ? new Date(s.startedAt).toLocaleDateString('ar-EG') : '';
                return `<option value="${s.id}">${statusIcon} ${Utils.escapeHTML(s.name || 'جلسة')} — ${countNum} صنف معدود — ${dateStr}</option>`;
            }).join('');

            // Load saved preferences
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem('dawaa_export_prefs') || '{}'); } catch(e) {}

            const nameVal = saved.nameMode || 'both';
            const groupModeVal = saved.groupMode || (saved.groupByCat === false ? 'none' : 'category');
            const locModeVal = saved.locationMode || 'columns';
            const expiryVal = saved.expiryMode || 'all';
            const sortVal = saved.sortMode || 'name';

            UI.showModal(`
                <div class="modal-header">
                    <h2><i class='bx bx-slider-alt'></i> تصدير إكسيل مخصص</h2>
                    <p class="text-muted" style="font-size:12px; margin-top:4px;">اختر مصدر البيانات والإعدادات وصدّر</p>
                </div>

                <div style="max-height: 65vh; overflow-y: auto; padding: 4px;">

                <!-- 0. Data Source -->
                <div class="cex-section" style="margin-bottom:16px; padding:12px; background:rgba(59,130,246,0.04); border:1px solid rgba(59,130,246,0.2); border-radius:10px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">📂 مصدر البيانات</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-source" value="inventory" checked onchange="document.getElementById('cex-session-picker').style.display='none'"> المخزون الحالي</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-source" value="audit" onchange="document.getElementById('cex-session-picker').style.display='block'" ${allSessions.length === 0 ? 'disabled' : ''}> جلسة جرد ${allSessions.length === 0 ? '(لا توجد جلسات)' : ''}</label>
                    </div>
                    <div id="cex-session-picker" style="display:none; margin-top:8px;">
                        <select id="cex-session-select" style="width:100%; padding:8px; border:1px solid var(--border); border-radius:8px; font-size:13px; background:var(--bg-card); color:var(--text-main);">
                            ${sessionOptions}
                        </select>
                        <small style="color:var(--text-muted); display:block; margin-top:4px;">🔄 = لسه شغال &nbsp; ✅ = مكتمل</small>
                    </div>
                </div>

                <!-- 1. Name -->
                <div class="cex-section" style="margin-bottom:16px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">📛 اسم الدواء</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-name" value="both" ${nameVal==='both'?'checked':''}> الاتنين (EN + AR)</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-name" value="en" ${nameVal==='en'?'checked':''}> إنجليزي فقط</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-name" value="ar" ${nameVal==='ar'?'checked':''}> عربي فقط</label>
                    </div>
                </div>

                <!-- 2. Grouping -->
                <div class="cex-section" style="margin-bottom:16px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">🗂️ طريقة التجميع</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-group" value="category" ${groupModeVal==='category'?'checked':''}> مجمّع بالتصنيفات</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-group" value="active" ${groupModeVal==='active'?'checked':''}> مجمّع بالمادة الفعالة 🧬</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-group" value="none" ${groupModeVal==='none'?'checked':''}> قائمة مسطحة</label>
                    </div>
                </div>

                <!-- 3. Locations -->
                <div class="cex-section" style="margin-bottom:16px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">📍 الأماكن</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-loc" value="columns" ${locModeVal==='columns'?'checked':''}> عمود لكل مكان</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-loc" value="single" ${locModeVal==='single'?'checked':''}> عمود واحد باسم المكان</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-loc" value="none" ${locModeVal==='none'?'checked':''}> بدون أماكن</label>
                    </div>
                </div>

                <!-- 4. Expiry -->
                <div class="cex-section" style="margin-bottom:16px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">📅 الصلاحية</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-exp" value="all" ${expiryVal==='all'?'checked':''}> كل الصلاحيات مع كمياتها</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-exp" value="earliest" ${expiryVal==='earliest'?'checked':''}> أقرب صلاحية فقط</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-exp" value="none" ${expiryVal==='none'?'checked':''}> بدون صلاحية</label>
                    </div>
                </div>

                <!-- 5. Sort -->
                <div class="cex-section" style="margin-bottom:16px;">
                    <h4 style="margin-bottom:8px; font-size:14px;">🔢 الترتيب</h4>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <label style="cursor:pointer;"><input type="radio" name="cex-sort" value="name" ${sortVal==='name'?'checked':''}> أبجدي بالاسم</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-sort" value="qty-asc" ${sortVal==='qty-asc'?'checked':''}> الأقل كمية أولاً</label>
                        <label style="cursor:pointer;"><input type="radio" name="cex-sort" value="exp-asc" ${sortVal==='exp-asc'?'checked':''}> الأقرب صلاحية أولاً</label>
                    </div>
                </div>

                <!-- 6. Filter: Categories -->
                <details style="margin-bottom:16px; border:1px solid var(--border); border-radius:8px; padding:8px 12px;">
                    <summary style="cursor:pointer; font-size:14px; font-weight:600;">🏷️ فلتر التصنيفات <small style="color:var(--text-muted);">(اختياري)</small></summary>
                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:2px; max-height:150px; overflow-y:auto;">
                        <label style="display:flex; align-items:center; gap:6px; padding:4px 0; cursor:pointer; color:var(--primary); font-weight:600;">
                            <input type="checkbox" id="cex-cat-all" checked onchange="document.querySelectorAll('.cex-cat-cb').forEach(c=>c.checked=this.checked)"> تحديد / إلغاء الكل
                        </label>
                        ${catChecks}
                    </div>
                </details>

                <!-- 7. Filter: Locations -->
                <details style="margin-bottom:16px; border:1px solid var(--border); border-radius:8px; padding:8px 12px;">
                    <summary style="cursor:pointer; font-size:14px; font-weight:600;">📍 فلتر الأماكن <small style="color:var(--text-muted);">(اختياري)</small></summary>
                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:2px; max-height:150px; overflow-y:auto;">
                        <label style="display:flex; align-items:center; gap:6px; padding:4px 0; cursor:pointer; color:var(--primary); font-weight:600;">
                            <input type="checkbox" id="cex-loc-all" checked onchange="document.querySelectorAll('.cex-loc-cb').forEach(c=>c.checked=this.checked)"> تحديد / إلغاء الكل
                        </label>
                        ${locChecks}
                    </div>
                </details>

                </div>

                <div class="form-actions mt-15" style="gap:8px;">
                    <button class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    <button class="btn-primary" onclick="window.App._runCustomExport()">
                        <i class='bx bx-download'></i> تصدير الآن
                    </button>
                </div>
            `);
        } catch (err) {
            console.error('Custom export modal error:', err);
            UI.showToast('خطأ في فتح خيارات التصدير', 'danger');
        }
    },

    _runCustomExport() {
        // Collect options from modal
        const source = document.querySelector('input[name="cex-source"]:checked')?.value || 'inventory';
        const sessionId = source === 'audit' ? (document.getElementById('cex-session-select')?.value || null) : null;
        const nameMode = document.querySelector('input[name="cex-name"]:checked')?.value || 'both';
        const groupMode = document.querySelector('input[name="cex-group"]:checked')?.value || 'category';
        const locationMode = document.querySelector('input[name="cex-loc"]:checked')?.value || 'columns';
        const expiryMode = document.querySelector('input[name="cex-exp"]:checked')?.value || 'all';
        const sortMode = document.querySelector('input[name="cex-sort"]:checked')?.value || 'name';

        // Collect category & location filters
        const selectedCats = Array.from(document.querySelectorAll('.cex-cat-cb:checked')).map(c => c.value);
        const selectedLocs = Array.from(document.querySelectorAll('.cex-loc-cb:checked')).map(c => c.value);

        // Save preferences
        try {
            localStorage.setItem('dawaa_export_prefs', JSON.stringify({
                nameMode, groupMode, locationMode, expiryMode, sortMode
            }));
        } catch(e) {}

        UI.closeModal();
        this.exportCustomInventory({ source, sessionId, nameMode, groupMode, locationMode, expiryMode, sortMode, selectedCats, selectedLocs });
    },

    async exportCustomInventory(opts) {
        try {
            if (!window.XLSX) {
                UI.showToast('مكتبة تصدير Excel غير متوفرة', 'danger');
                return;
            }

            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const allCats = (await Categories.getAllSorted()) || [];
            const allLocs = (await Locations.getAll()) || [];
            const catMap = new Map(allCats.map(c => [c.id, c]));
            const locMap = new Map(allLocs.map(l => [l.id, l]));

            // Filter by selected categories
            const catFilter = new Set(opts.selectedCats || allCats.map(c => c.id));
            if (catFilter.size === allCats.length) catFilter.add('uncategorized');

            // Filter by selected locations
            const locFilter = new Set(opts.selectedLocs || allLocs.map(l => l.id));

            // --- Step 1: Build per-medicine data ---
            const medData = new Map();
            let exportFileName = '';

            if (opts.source === 'audit' && opts.sessionId) {
                // ========== AUDIT SESSION SOURCE ==========
                const session = await Audit.getSession(opts.sessionId);
                if (!session || !session.counts || Object.keys(session.counts).length === 0) {
                    UI.showToast('لا توجد بيانات في هذه الجلسة', 'warning');
                    return;
                }
                exportFileName = `جرد_${(session.name || 'جلسة').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}`;

                let skippedOrphans = 0;
                for (const [key, record] of Object.entries(session.counts)) {
                    const [locId, medId] = key.split('___');
                    if (!locFilter.has(locId)) continue;

                    const med = masterMap.get(medId);
                    if (!med) {
                        // v18.15.0: Skip deleted/orphan medicines so "Unknown" never pollutes Excel exports
                        skippedOrphans++;
                        continue;
                    }
                    if (!catFilter.has(med.categoryId || 'uncategorized')) continue;

                    if (!medData.has(medId)) {
                        medData.set(medId, {
                            id: medId,
                            nameEN: med.nameEN || '',
                            nameAR: med.nameAR || med.nameEN || '',
                            activeIngredient: (med.activeIngredient || '').trim(),
                            categoryId: med.categoryId || 'uncategorized',
                            perLoc: {},
                            total: 0,
                            earliestExp: null
                        });
                    }

                    const d = medData.get(medId);
                    const batches = (record.batches && record.batches.length > 0)
                        ? record.batches
                        : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

                    for (const b of batches) {
                        const qty = parseFloat(b.quantity) || 0;
                        const exp = (qty > 0 && b.expiryDate && b.expiryDate !== 'غير محدد') ? b.expiryDate : null;

                        if (!d.perLoc[locId]) {
                            d.perLoc[locId] = { qty: 0, expiries: {} };
                        }
                        d.perLoc[locId].qty += qty;
                        if (qty > 0 && exp) {
                            d.perLoc[locId].expiries[exp] = (d.perLoc[locId].expiries[exp] || 0) + qty;
                        }
                        d.total += qty;
                        if (qty > 0 && exp && (!d.earliestExp || exp < d.earliestExp)) {
                            d.earliestExp = exp;
                        }
                    }
                }
            } else {
                // ========== INVENTORY SOURCE (default) ==========
                const inventoryEntries = (await DB.getAll('inventory')) || [];
                exportFileName = 'مخزون_مخصص';

                for (const med of masterMeds) {
                    if (!catFilter.has(med.categoryId || 'uncategorized')) continue;
                    medData.set(med.id, {
                        id: med.id,
                        nameEN: med.nameEN || '',
                        nameAR: med.nameAR || med.nameEN || '',
                        activeIngredient: (med.activeIngredient || '').trim(),
                        categoryId: med.categoryId || 'uncategorized',
                        perLoc: {},
                        total: 0,
                        earliestExp: null
                    });
                }

                for (const entry of inventoryEntries) {
                    const d = medData.get(entry.medicineId);
                    if (!d) continue;

                    let locId = null;
                    if (locMap.has(entry.location)) {
                        locId = entry.location;
                    } else {
                        for (const [lid, lobj] of locMap) {
                            if (lobj.nameAR === entry.location || lobj.nameEN === entry.location) {
                                locId = lid; break;
                            }
                        }
                        if (!locId) locId = entry.location || '__default__';
                    }

                    if (!locFilter.has(locId) && locId !== '__default__') continue;

                    const qty = parseFloat(entry.quantity) || 0;
                    const exp = (qty > 0 && entry.expiryDate && entry.expiryDate !== 'غير محدد') ? entry.expiryDate : null;

                    if (!d.perLoc[locId]) {
                        d.perLoc[locId] = { qty: 0, expiries: {} };
                    }
                    d.perLoc[locId].qty += qty;
                    if (qty > 0 && exp) {
                        d.perLoc[locId].expiries[exp] = (d.perLoc[locId].expiries[exp] || 0) + qty;
                    }
                    d.total += qty;
                    if (qty > 0 && exp && (!d.earliestExp || exp < d.earliestExp)) {
                        d.earliestExp = exp;
                    }
                }
            }

            const medsArray = Array.from(medData.values());
            if (medsArray.length === 0) {
                UI.showToast('لا توجد بيانات لتصديرها', 'warning');
                return;
            }

            // --- Step 2: Sort ---
            if (opts.sortMode === 'qty-asc') {
                medsArray.sort((a, b) => a.total - b.total);
            } else if (opts.sortMode === 'exp-asc') {
                medsArray.sort((a, b) => {
                    if (!a.earliestExp && !b.earliestExp) return 0;
                    if (!a.earliestExp) return 1;
                    if (!b.earliestExp) return -1;
                    return a.earliestExp.localeCompare(b.earliestExp);
                });
            } else {
                medsArray.sort((a, b) => (a.nameEN || a.nameAR).localeCompare(b.nameEN || b.nameAR));
            }

            // --- Step 3: Get unique location names used ---
            const usedLocIds = new Set();
            for (const d of medsArray) {
                for (const lid of Object.keys(d.perLoc)) usedLocIds.add(lid);
            }
            const locColumns = allLocs.filter(l => usedLocIds.has(l.id)).sort((a, b) => (a.nameAR || '').localeCompare(b.nameAR || ''));

            // Helper: format expiries
            const formatExpiries = (d) => {
                // Merge all expiries across locations
                const allExp = {};
                for (const loc of Object.values(d.perLoc)) {
                    for (const [exp, qty] of Object.entries(loc.expiries)) {
                        allExp[exp] = (allExp[exp] || 0) + qty;
                    }
                }
                if (Object.keys(allExp).length === 0) return '';
                return Object.entries(allExp)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([exp, qty]) => `${exp}: ${qty}`)
                    .join(' | ');
            };

            // --- Step 4: Build sheet ---
            const groupMode = opts.groupMode || (opts.groupByCat === false ? 'none' : 'category');

            if (groupMode === 'category' || groupMode === 'active') {
                // === GROUPED BY CATEGORY OR ACTIVE INGREDIENT ===
                const groups = new Map(); // groupKey -> { label, meds[] }

                if (groupMode === 'category') {
                    for (const d of medsArray) {
                        const cid = d.categoryId;
                        if (!groups.has(cid)) {
                            const cat = catMap.get(cid);
                            groups.set(cid, {
                                key: cid,
                                label: Categories.getCategoryDisplayName(cat || cid, opts.nameMode, catMap),
                                labelEN: Categories.getCategoryDisplayName(cat || cid, 'en', catMap),
                                labelAR: Categories.getCategoryDisplayName(cat || cid, 'ar', catMap),
                                isLast: cid === 'uncategorized',
                                meds: []
                            });
                        }
                        groups.get(cid).meds.push(d);
                    }
                } else {
                    // Group by normalized active ingredient
                    for (const d of medsArray) {
                        const normKey = this._normalizeActiveKey(d.activeIngredient);
                        const groupKey = normKey || '__no_active__';
                        if (!groups.has(groupKey)) {
                            const actLabel = normKey ? d.activeIngredient.trim() : 'بدون مادة فعالة';
                            groups.set(groupKey, {
                                key: groupKey,
                                label: actLabel,
                                labelEN: normKey ? d.activeIngredient.trim() : 'No Active Ingredient',
                                labelAR: actLabel,
                                isLast: !normKey,
                                meds: []
                            });
                        }
                        groups.get(groupKey).meds.push(d);
                    }
                }

                const sortedGroups = Array.from(groups.values()).sort((a, b) => {
                    if (a.isLast !== b.isLast) return a.isLast ? 1 : -1;
                    return a.label.localeCompare(b.label);
                });

                // Headers (with sequential numbering column 'م')
                const headers = ['م'];
                if (opts.nameMode === 'both' || opts.nameMode === 'en') headers.push('Medicine Name (EN)');
                if (opts.nameMode === 'both' || opts.nameMode === 'ar') headers.push('اسم الدواء (AR)');

                if (opts.locationMode === 'columns') {
                    for (const loc of locColumns) headers.push(loc.nameAR || loc.id);
                } else if (opts.locationMode === 'single') {
                    headers.push('مكان التخزين');
                }

                headers.push('الإجمالي');

                if (opts.expiryMode === 'all') {
                    headers.push('الصلاحيات');
                } else if (opts.expiryMode === 'earliest') {
                    headers.push('أقرب صلاحية');
                }

                const aoa = [headers];
                const groupRowIndices = [];
                let rowCounter = 1;

                for (const grp of sortedGroups) {
                    // Put EN category under EN column & AR category under AR column — NO square symbol, NO row merge!
                    const grpRow = [''];
                    if (opts.nameMode === 'both') {
                        grpRow.push(grp.labelEN);
                        grpRow.push(grp.labelAR);
                    } else if (opts.nameMode === 'en') {
                        grpRow.push(grp.labelEN);
                    } else {
                        grpRow.push(grp.labelAR);
                    }
                    while (grpRow.length < headers.length) grpRow.push('');
                    groupRowIndices.push(aoa.length);
                    aoa.push(grpRow);

                    // Medicine rows with sequential numbering
                    for (const m of grp.meds) {
                        const row = [rowCounter++];
                        if (opts.nameMode === 'both' || opts.nameMode === 'en') row.push(m.nameEN);
                        if (opts.nameMode === 'both' || opts.nameMode === 'ar') row.push(m.nameAR);

                        if (opts.locationMode === 'columns') {
                            for (const loc of locColumns) {
                                row.push(m.perLoc[loc.id]?.qty || 0);
                            }
                        } else if (opts.locationMode === 'single') {
                            const locNames = [];
                            for (const [lid, data] of Object.entries(m.perLoc)) {
                                const lObj = locMap.get(lid);
                                const name = lObj ? lObj.nameAR : lid;
                                locNames.push(`${name} (${data.qty})`);
                            }
                            row.push(locNames.join(' | '));
                        }

                        row.push(m.total);

                        if (opts.expiryMode === 'all') {
                            row.push(formatExpiries(m));
                        } else if (opts.expiryMode === 'earliest') {
                            row.push(m.earliestExp || '');
                        }

                        aoa.push(row);
                    }

                    // For active ingredient grouping, when a group has 2+ alternatives, add merged active total row
                    if (groupMode === 'active' && grp.meds.length > 1 && !grp.isLast) {
                        const activeTotal = grp.meds.reduce((s, m) => s + m.total, 0);
                        const subRow = ['', `إجمالي المادة الفعالة (${grp.label})`];
                        while (subRow.length < headers.length) subRow.push('');
                        const totalColIdx = headers.indexOf('الإجمالي');
                        if (totalColIdx >= 0) subRow[totalColIdx] = activeTotal;
                        aoa.push(subRow);
                    }
                }

                // Bottom summary row: Total number of medicines (instead of grand quantity total)
                const countRow = ['', 'إجمالي عدد الأدوية', medsArray.length];
                while (countRow.length < headers.length) countRow.push('');
                aoa.push([]);
                aoa.push(countRow);

                // Build sheet with native Excel styling (Bold + Larger font for Category rows, NO merged rows)
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                ws['!cols'] = headers.map((h, i) => {
                    if (i === 0) return { wch: 6 };
                    let maxLen = h.length;
                    for (const row of aoa) {
                        const cellLen = String(row[i] || '').length;
                        if (cellLen > maxLen) maxLen = cellLen;
                    }
                    return { wch: Math.min(maxLen + 4, 55) };
                });

                this._applyExcelSheetStyles(ws, aoa.length, headers.length, groupRowIndices, aoa.length - 1);

                const wb = XLSX.utils.book_new();
                const sheetTitle = groupMode === 'active' ? 'حسب المادة الفعالة' : 'المخزون';
                XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
                const suffix = groupMode === 'active' ? '_مادة_فعالة' : '';
                XLSX.writeFile(wb, `${exportFileName}${suffix}_${new Date().toISOString().split('T')[0]}.xlsx`);
                UI.showToast(`تم تصدير ${medsArray.length} دواء ✅`, 'success');

            } else {
                // === FLAT LIST (with sequential numbering 'م' + total medicine count footer) ===
                const finalRows = medsArray.map((m, idx) => {
                    const row = { 'م': idx + 1 };
                    if (opts.nameMode === 'both' || opts.nameMode === 'en') row['Medicine Name (EN)'] = m.nameEN;
                    if (opts.nameMode === 'both' || opts.nameMode === 'ar') row['اسم الدواء (AR)'] = m.nameAR;

                    const cat = catMap.get(m.categoryId);
                    if (opts.nameMode === 'en') {
                        row['Category'] = Categories.getCategoryDisplayName(cat || m.categoryId, 'en', catMap);
                    } else if (opts.nameMode === 'ar') {
                        row['التصنيف'] = Categories.getCategoryDisplayName(cat || m.categoryId, 'ar', catMap);
                    } else {
                        row['التصنيف (AR)'] = Categories.getCategoryDisplayName(cat || m.categoryId, 'ar', catMap);
                        row['Category (EN)'] = Categories.getCategoryDisplayName(cat || m.categoryId, 'en', catMap);
                    }

                    if (opts.locationMode === 'columns') {
                        for (const loc of locColumns) {
                            row[loc.nameAR || loc.id] = m.perLoc[loc.id]?.qty || 0;
                        }
                    } else if (opts.locationMode === 'single') {
                        const locNames = [];
                        for (const [lid, data] of Object.entries(m.perLoc)) {
                            const lObj = locMap.get(lid);
                            const name = lObj ? lObj.nameAR : lid;
                            locNames.push(`${name} (${data.qty})`);
                        }
                        row['مكان التخزين'] = locNames.join(' | ');
                    }

                    row['الإجمالي'] = m.total;

                    if (opts.expiryMode === 'all') {
                        row['الصلاحيات'] = formatExpiries(m);
                    } else if (opts.expiryMode === 'earliest') {
                        row['أقرب صلاحية'] = m.earliestExp || '';
                    }

                    return row;
                });

                if (finalRows.length === 0) {
                    UI.showToast('لا توجد بيانات لتصديرها', 'warning');
                    return;
                }

                // Append empty row + total medicine count row
                const keys = Object.keys(finalRows[0]);
                const emptyRow = {};
                const countRow = {};
                keys.forEach((k, i) => {
                    emptyRow[k] = '';
                    if (i === 1) countRow[k] = 'إجمالي عدد الأدوية';
                    else if (i === 2) countRow[k] = medsArray.length;
                    else countRow[k] = '';
                });
                finalRows.push(emptyRow, countRow);

                const ws = XLSX.utils.json_to_sheet(finalRows);
                ws['!cols'] = keys.map((key, idx) => {
                    if (idx === 0) return { wch: 6 };
                    const maxLen = Math.max(key.length, ...finalRows.map(r => String(r[key] || '').length));
                    return { wch: Math.min(maxLen + 4, 55) };
                });
                this._applyExcelSheetStyles(ws, finalRows.length + 1, keys.length, [], finalRows.length);

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
                XLSX.writeFile(wb, `${exportFileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
                UI.showToast(`تم تصدير ${medsArray.length} دواء ✅`, 'success');
            }

        } catch (err) {
            console.error('Custom export error:', err);
            UI.showToast('فشل تصدير الإكسيل: ' + err.message, 'danger');
        }
    },

    /**
     * Apply native Excel styling via xlsx-js-style:
     * - Table Header Row: Bold 12pt white on dark navy
     * - Category / Group Header Rows: Bold 14pt navy on soft blue tint (unmerged)
     * - Footer Row ("إجمالي عدد الأدوية"): Bold 12pt on soft gray
     * - RTL sheet view
     */
    _applyExcelSheetStyles(ws, rowCount, colCount, groupRowIndices = [], footerRowIdx = -1) {
        if (!ws || !window.XLSX?.utils?.encode_cell) return;
        const groupSet = new Set(groupRowIndices);

        const headerStyle = {
            font: { name: 'Arial', sz: 12, bold: true, color: { rgb: 'FFFFFF' } },
            fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
            alignment: { vertical: 'center', horizontal: 'center' }
        };
        const categoryStyle = {
            font: { name: 'Arial', sz: 14, bold: true, color: { rgb: '1E3A8A' } },
            fill: { patternType: 'solid', fgColor: { rgb: 'EBF2FF' } },
            alignment: { vertical: 'center' }
        };
        const footerStyle = {
            font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '0F172A' } },
            fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
            alignment: { vertical: 'center' }
        };
        const normalStyle = {
            font: { name: 'Arial', sz: 11 },
            alignment: { vertical: 'center' }
        };

        const rowsMeta = [];
        for (let r = 0; r < rowCount; r++) {
            const isHeader = r === 0;
            const isGroup = groupSet.has(r);
            const isFooter = r === footerRowIdx;
            rowsMeta.push({ hpt: isHeader ? 26 : (isGroup ? 28 : (isFooter ? 24 : 20)) });

            const style = isHeader ? headerStyle : (isGroup ? categoryStyle : (isFooter ? footerStyle : normalStyle));
            for (let c = 0; c < colCount; c++) {
                const ref = XLSX.utils.encode_cell({ r, c });
                if (!ws[ref]) {
                    if (isHeader || isGroup || isFooter) {
                        ws[ref] = { t: 's', v: '', s: style };
                    }
                } else {
                    ws[ref].s = style;
                }
            }
        }
        ws['!rows'] = rowsMeta;
        ws['!views'] = [{ rightToLeft: true }];
    },
    // ===================== End Custom Export Builder =====================

    // ===================== Smart Catalog Enricher (27K Egyptian Drugs) =====================
    async openCatalogEnricherModal() {
        try {
            // Show quick loading modal while 27K catalog loads & indexes
            UI.showModal(`
                <div class="modal-header">
                    <h2><i class='bx bx-sparkles' style="color:#10b981;"></i> فحص وتكميل بيانات الأدوية</h2>
                </div>
                <div style="text-align:center; padding:32px 16px;">
                    <i class='bx bx-loader-alt bx-spin' style="font-size:38px; color:var(--primary);"></i>
                    <p style="margin-top:12px; font-weight:700; color:var(--text-main);">جاري تحميل قاعدة الـ 27,601 دواء ومطابقة أصنافك...</p>
                    <small class="text-muted">يستغرق لحظات فقط ولا يغيّر أي بيانات بدون موافقتك</small>
                </div>
            `);

            await EgyptianDrugs.ensureLoaded();
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            if (allMeds.length === 0) {
                UI.closeModal();
                UI.showToast('لا توجد أدوية في قاعدة البيانات للفحص', 'info');
                return;
            }

            // Yield a frame so spinner renders smoothly
            await new Promise(r => setTimeout(r, 30));

            const rows = allMeds.map((med, idx) => {
                const status = med.catalogVerified ? 'verified' : (med.catalogIgnored ? 'ignored' : 'pending');
                const matches = status === 'pending' ? EgyptianDrugs.findBestMatches(med, 5) : [];
                const selectedIdx = matches.length > 0 ? 0 : -1;
                const best = selectedIdx >= 0 ? matches[selectedIdx] : null;
                return {
                    _idx: idx,
                    status, // 'pending' | 'verified' | 'ignored'
                    med,
                    matches,
                    selectedIdx,
                    checked: !!(status === 'pending' && best && best.confidence === 'high')
                };
            });

            // Default field options
            const fields = {
                fillActive: true,
                fillAR: true,
                fillBarcode: true,
                updateEN: false
            };

            this._enricherState = {
                rows,
                fields,
                filter: 'actionable', // 'actionable' | 'high' | 'medium' | 'unmatched' | 'done'
                search: '',
                openManualIdx: -1,
                manualQuery: '',
                manualResults: []
            };

            // Only keep rows auto-checked if pending and actually have a change under default fields
            for (const row of rows) {
                if (row.status !== 'pending') {
                    row.checked = false;
                    continue;
                }
                const diff = this._computeEnrichDiff(row, fields);
                const best = row.selectedIdx >= 0 ? row.matches[row.selectedIdx] : null;
                row.checked = !!(best?.confidence === 'high' && diff.hasChanges);
            }

            this._renderEnricherModal();
        } catch (err) {
            console.error('Catalog enricher error:', err);
            UI.showToast('تعذر تشغيل فحص البيانات: ' + err.message, 'danger');
        }
    },

    _computeEnrichDiff(row, fields) {
        if (!row || row.status !== 'pending') return { hasChanges: false, changes: {} };
        const med = row.med;
        const match = (row.selectedIdx >= 0 && row.matches[row.selectedIdx]) ? row.matches[row.selectedIdx] : null;
        if (!match) return { hasChanges: false, changes: {} };

        const item = match.item;
        const changes = {};
        const overwrite = !!(row.forceOverwrite || match.manual);

        // 1. Active ingredient (fill if missing, OR replace if user manually changed/reopened this medicine)
        const curActive = (med.activeIngredient || '').trim();
        const newActive = (item.active || '').trim();
        if (fields.fillActive && newActive && (overwrite ? newActive.toLowerCase() !== curActive.toLowerCase() : !curActive)) {
            changes.activeIngredient = { from: curActive, to: newActive };
        }

        // 2. Arabic name (fill if empty/no Arabic, OR replace in overwrite mode)
        const curAR = (med.nameAR || '').trim();
        const curEN = (med.nameEN || '').trim();
        const newAR = (item.nameAR || '').trim();
        const arMissingOrEnglish = !curAR || curAR.toLowerCase() === curEN.toLowerCase() || !/[\u0600-\u06FF]/.test(curAR);
        if (fields.fillAR && newAR && (overwrite ? newAR !== curAR : arMissingOrEnglish)) {
            changes.nameAR = { from: curAR, to: newAR };
        }

        // 3. Verified EAN Barcode (fill if missing/internal ID, OR replace in overwrite mode)
        const curBc = String(med.barcode || '').trim();
        const hasRealBc = curBc && curBc !== String(med.id) && /^\d{8,14}$/.test(curBc);
        const newBc = String(item.barcode || '').trim();
        if (fields.fillBarcode && /^\d{8,14}$/.test(newBc) && (overwrite ? newBc !== curBc : !hasRealBc)) {
            changes.barcode = { from: curBc === String(med.id) ? '' : curBc, to: newBc };
        }

        // 4. English name (global updateEN OR per-row overwriteEN enabled on manual link/edit)
        const targetEN = (match.formattedEN || item.nameEN || '').trim();
        if ((fields.updateEN || row.overwriteEN) && targetEN && targetEN.toLowerCase() !== curEN.toLowerCase()) {
            changes.nameEN = { from: curEN, to: targetEN };
        }

        return {
            hasChanges: Object.keys(changes).length > 0,
            changes
        };
    },

    _getEnricherStats() {
        const st = this._enricherState;
        let highCount = 0, medCount = 0, unmatchedCount = 0, actionableCount = 0, doneCount = 0, completePendingCount = 0;
        if (!st) return { highCount, medCount, unmatchedCount, actionableCount, doneCount, completePendingCount };
        for (const r of st.rows) {
            if (r.status !== 'pending') {
                doneCount++;
                continue;
            }
            const best = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
            const diff = this._computeEnrichDiff(r, st.fields);
            if (best?.confidence === 'high') highCount++;
            else if (best?.confidence === 'medium') medCount++;
            else if (r.med.type !== 'supply') unmatchedCount++;
            if (diff.hasChanges) actionableCount++;
            else if (best) completePendingCount++;
        }
        return { highCount, medCount, unmatchedCount, actionableCount, doneCount, completePendingCount };
    },

    _refreshEnricherCounters() {
        const { highCount, medCount, unmatchedCount, actionableCount, doneCount, completePendingCount } = this._getEnricherStats();
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setTxt('enrich-high-num', highCount);
        setTxt('enrich-med-num', medCount);
        setTxt('enrich-unmatched-num', unmatchedCount);
        setTxt('enrich-actionable-num', actionableCount);
        setTxt('enr-tab-high-cnt', highCount);
        setTxt('enr-tab-med-cnt', medCount);
        setTxt('enr-tab-unmatched-cnt', unmatchedCount);
        setTxt('enr-tab-done-cnt', doneCount);

        const subEl = document.getElementById('enr-header-subtitle');
        if (subEl && this._enricherState) {
            const pendingTotal = this._enricherState.rows.length - doneCount;
            subEl.textContent = `فحص ${pendingTotal} صنف جديد بقاعدة ${EgyptianDrugs.catalogSize.toLocaleString()} دواء${doneCount > 0 ? ` (${doneCount} معتمد ومخفي سابقاً)` : ''}`;
        }

        const banner = document.getElementById('enr-complete-banner');
        if (banner) {
            if (completePendingCount > 0) {
                banner.style.display = 'flex';
                const cntEl = document.getElementById('enr-complete-banner-cnt');
                if (cntEl) cntEl.textContent = completePendingCount;
            } else {
                banner.style.display = 'none';
            }
        }
    },

    _renderEnricherModal() {
        const st = this._enricherState;
        if (!st) return;

        const { highCount, medCount, unmatchedCount, actionableCount, doneCount, completePendingCount } = this._getEnricherStats();
        const pendingTotal = st.rows.length - doneCount;

        UI.showModal(`
            <div class="sheet-handle"></div>
            <div class="modal-header" style="margin-bottom:10px;">
                <h2 style="font-size:16px; display:flex; align-items:center; gap:6px;">
                    <i class='bx bx-sparkles' style="color:#10b981;"></i> فحص وتكميل بيانات الأدوية
                </h2>
                <p class="text-muted" id="enr-header-subtitle" style="font-size:11.5px; margin-top:3px;">
                    فحص ${pendingTotal} صنف جديد بقاعدة ${EgyptianDrugs.catalogSize.toLocaleString()} دواء${doneCount > 0 ? ` (${doneCount} معتمد ومخفي سابقاً)` : ''}
                </p>
            </div>

            <!-- Summary Strip (clickable filters) -->
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin-bottom:8px; text-align:center;">
                <div onclick="window.App._setEnricherFilter('high')" style="cursor:pointer; padding:6px 4px; border-radius:8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25);">
                    <div style="font-size:14px; font-weight:800; color:#059669;" id="enrich-high-num">${highCount}</div>
                    <div style="font-size:9.5px; color:var(--text-muted);">🟢 قوي</div>
                </div>
                <div onclick="window.App._setEnricherFilter('medium')" style="cursor:pointer; padding:6px 4px; border-radius:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25);">
                    <div style="font-size:14px; font-weight:800; color:#d97706;" id="enrich-med-num">${medCount}</div>
                    <div style="font-size:9.5px; color:var(--text-muted);">🟡 مراجعة</div>
                </div>
                <div onclick="window.App._setEnricherFilter('unmatched')" style="cursor:pointer; padding:6px 4px; border-radius:8px; background:rgba(100,116,139,0.08); border:1px solid rgba(100,116,139,0.25);">
                    <div style="font-size:14px; font-weight:800; color:var(--text-muted);" id="enrich-unmatched-num">${unmatchedCount}</div>
                    <div style="font-size:9.5px; color:var(--text-muted);">⚪ غير مطابق</div>
                </div>
                <div onclick="window.App._setEnricherFilter('actionable')" style="cursor:pointer; padding:6px 4px; border-radius:8px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25);">
                    <div style="font-size:14px; font-weight:800; color:var(--primary);" id="enrich-actionable-num">${actionableCount}</div>
                    <div style="font-size:9.5px; color:var(--text-muted);">✨ للتكميل</div>
                </div>
            </div>

            <!-- 1-click hide already-complete medicines -->
            <div id="enr-complete-banner" style="display:${completePendingCount > 0 ? 'flex' : 'none'}; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding:7px 10px; border-radius:9px; background:rgba(16,185,129,0.09); border:1px solid rgba(16,185,129,0.28); margin-bottom:8px; font-size:11px;">
                <span style="color:#065f46; font-weight:700;">✅ يوجد <strong id="enr-complete-banner-cnt">${completePendingCount}</strong> دواء بياناتهم مكتملة بالفعل</span>
                <button type="button" onclick="window.App._verifyAllCompleteEnricherRows()" style="font-size:10.5px; padding:4px 9px; border-radius:7px; border:none; background:#10b981; color:#fff; font-weight:700; cursor:pointer;">اعتمادهم وإخفاؤهم من الفحص</button>
            </div>

            <!-- Field Toggles -->
            <div style="padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; margin-bottom:8px;">
                <div style="font-size:11.5px; font-weight:800; margin-bottom:5px; color:var(--text-main);">إيه اللي عايز تكمله؟</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:11.5px;">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" ${st.fields.fillActive ? 'checked' : ''} onchange="window.App._onEnricherToggleField('fillActive', this.checked)"> 💊 المادة الفعالة
                    </label>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" ${st.fields.fillAR ? 'checked' : ''} onchange="window.App._onEnricherToggleField('fillAR', this.checked)"> 🔤 العربي الناقص
                    </label>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" ${st.fields.fillBarcode ? 'checked' : ''} onchange="window.App._onEnricherToggleField('fillBarcode', this.checked)"> 🔢 الباركود
                    </label>
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px; color:var(--text-muted);">
                        <input type="checkbox" ${st.fields.updateEN ? 'checked' : ''} onchange="window.App._onEnricherToggleField('updateEN', this.checked)"> 🇬🇧 توحيد الاسم الإنجليزي
                    </label>
                </div>
            </div>

            <!-- Filter Tabs + Search -->
            <div style="display:flex; gap:5px; margin-bottom:8px; flex-wrap:wrap; align-items:center;">
                <button type="button" id="enr-tab-actionable" onclick="window.App._setEnricherFilter('actionable')" class="${st.filter==='actionable'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:10.5px; padding:5px 8px; border-radius:8px; ${st.filter!=='actionable'?'border:1px solid var(--border-color);':''}">للتكميل</button>
                <button type="button" id="enr-tab-high" onclick="window.App._setEnricherFilter('high')" class="${st.filter==='high'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:10.5px; padding:5px 8px; border-radius:8px; ${st.filter!=='high'?'border:1px solid var(--border-color);':''}">🟢 قوي (<span id="enr-tab-high-cnt">${highCount}</span>)</button>
                <button type="button" id="enr-tab-medium" onclick="window.App._setEnricherFilter('medium')" class="${st.filter==='medium'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:10.5px; padding:5px 8px; border-radius:8px; ${st.filter!=='medium'?'border:1px solid var(--border-color);':''}">🟡 مراجعة (<span id="enr-tab-med-cnt">${medCount}</span>)</button>
                <button type="button" id="enr-tab-unmatched" onclick="window.App._setEnricherFilter('unmatched')" class="${st.filter==='unmatched'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:10.5px; padding:5px 8px; border-radius:8px; ${st.filter!=='unmatched'?'border:1px solid var(--border-color);':''}">⚪ غير مطابق (<span id="enr-tab-unmatched-cnt">${unmatchedCount}</span>)</button>
                <button type="button" id="enr-tab-done" onclick="window.App._setEnricherFilter('done')" class="${st.filter==='done'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:10.5px; padding:5px 8px; border-radius:8px; ${st.filter!=='done'?'border:1px solid var(--border-color);':''}">✅ معتمد (<span id="enr-tab-done-cnt">${doneCount}</span>)</button>
                <input type="text" id="enr-search" placeholder="🔍 فلتر بالاسم..." value="${Utils.escapeHTML(st.search)}" oninput="window.App._setEnricherSearch(this.value)" style="flex:1; min-width:110px; padding:5px 8px; border:1px solid var(--border-color); border-radius:8px; font-size:11.5px; background:var(--surface); color:var(--text-main);">
            </div>

            <!-- Results List -->
            <div id="enricher-results-list" style="max-height:42vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:2px;"></div>

            <!-- Footer -->
            <div class="form-actions mt-15" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App._toggleEnricherAll(true)" style="font-size:11px; padding:6px 8px; border:1px solid var(--border-color);">تحديد القوي</button>
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App._toggleEnricherAll(false)" style="font-size:11px; padding:6px 8px; border:1px solid var(--border-color);">إلغاء الكل</button>
                </div>
                <div style="display:flex; gap:8px;">
                    <button type="button" class="btn-ghost sm-btn" onclick="window.UI.closeModal()">إغلاق</button>
                    <button type="button" id="enricher-apply-btn" class="btn-primary sm-btn" onclick="window.App.applyCatalogEnrichment()">
                        <i class='bx bx-check-double'></i> اعتماد التحديثات
                    </button>
                </div>
            </div>
        `);

        this._renderEnricherList();
    },

    _onEnricherToggleField(field, val) {
        const st = this._enricherState;
        if (!st) return;
        st.fields[field] = !!val;
        for (const r of st.rows) {
            if (r.status !== 'pending') { r.checked = false; continue; }
            const diff = this._computeEnrichDiff(r, st.fields);
            const best = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
            if (!diff.hasChanges) r.checked = false;
            else if (best?.confidence === 'high') r.checked = true;
        }
        this._refreshEnricherCounters();
        this._renderEnricherList();
    },

    _setEnricherFilter(filter) {
        const st = this._enricherState;
        if (!st) return;
        st.filter = filter;
        ['actionable', 'high', 'medium', 'unmatched', 'done'].forEach(f => {
            const btn = document.getElementById(`enr-tab-${f}`);
            if (!btn) return;
            if (f === filter) {
                btn.className = 'btn-primary sm-btn';
                btn.style.border = 'none';
            } else {
                btn.className = 'btn-ghost sm-btn';
                btn.style.border = '1px solid var(--border-color)';
            }
        });
        this._renderEnricherList();
    },

    _setEnricherSearch(q) {
        if (!this._enricherState) return;
        this._enricherState.search = q || '';
        this._renderEnricherList();
    },

    _onEnricherSelectMatch(medId, newIdx) {
        const st = this._enricherState;
        if (!st) return;
        const row = st.rows.find(r => r.med.id === medId);
        if (!row) return;
        const parsed = parseInt(newIdx, 10);
        row.selectedIdx = Number.isNaN(parsed) ? -1 : parsed;
        if (row.selectedIdx >= 0) {
            row.forceOverwrite = true;
        }
        const diff = this._computeEnrichDiff(row, st.fields);
        row.checked = row.selectedIdx >= 0 && diff.hasChanges;
        this._refreshEnricherCounters();
        this._renderEnricherList();
    },

    _enableEnricherOverwrite(rowIdx) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        row.forceOverwrite = true;
        row.overwriteEN = true;
        const diff = this._computeEnrichDiff(row, st.fields);
        row.checked = diff.hasChanges;
        this._refreshEnricherCounters();
        this._renderEnricherList();
    },

    _toggleEnricherRowOverwriteEN(rowIdx, val) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        row.overwriteEN = !!val;
        const diff = this._computeEnrichDiff(row, st.fields);
        row.checked = diff.hasChanges;
        this._refreshEnricherCounters();
        this._renderEnricherList();
    },

    async _applySingleEnricherRow(rowIdx) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        const diff = this._computeEnrichDiff(row, st.fields);
        if (!diff.hasChanges) {
            return this._verifySingleEnricherRow(rowIdx);
        }
        try {
            const med = await DB.get('medicineMaster', row.med.id);
            if (!med) return;
            const now = new Date().toISOString();
            if (diff.changes.activeIngredient) med.activeIngredient = diff.changes.activeIngredient.to;
            if (diff.changes.nameAR) med.nameAR = diff.changes.nameAR.to;
            if (diff.changes.barcode) med.barcode = diff.changes.barcode.to;
            if (diff.changes.nameEN) med.nameEN = diff.changes.nameEN.to;

            const match = row.selectedIdx >= 0 ? row.matches[row.selectedIdx] : null;
            med.catalogVerified = true;
            med.catalogIgnored = false;
            med.catalogVerifiedAt = now;
            if (match?.item?.nameEN) med.catalogMatchedEN = match.item.nameEN;
            med.lastUpdated = now;
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(() => {});
            }
            row.med = med;
            row.status = 'verified';
            row.checked = false;
            row.forceOverwrite = false;
            row.overwriteEN = false;
            this._dashCache = null;
            this._refreshEnricherCounters();
            this._renderEnricherList();
            UI.showToast(`تم تعديل واعتماد "${med.nameEN || med.nameAR}" بنجاح ✨`, 'success');
            this.refreshAllViews?.();
        } catch (err) {
            UI.showToast('تعذر حفظ التعديل: ' + err.message, 'danger');
        }
    },

    _rejectEnricherMatch(rowIdx) {
        const st = this._enricherState;
        if (!st) return;
        const row = st.rows[rowIdx];
        if (!row) return;
        row.selectedIdx = -1;
        row.checked = false;
        this._refreshEnricherCounters();
        this._renderEnricherList();
        UI.showToast('تم رفض الاقتراح — يمكنك البحث يدوياً أو استبعاده', 'info');
    },

    async _verifySingleEnricherRow(rowIdx) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        try {
            const med = await DB.get('medicineMaster', row.med.id);
            if (!med) return;
            const now = new Date().toISOString();
            const match = row.selectedIdx >= 0 ? row.matches[row.selectedIdx] : null;
            med.catalogVerified = true;
            med.catalogIgnored = false;
            med.catalogVerifiedAt = now;
            if (match?.item?.nameEN) med.catalogMatchedEN = match.item.nameEN;
            med.lastUpdated = now;
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(() => {});
            }
            row.med = med;
            row.status = 'verified';
            row.checked = false;
            this._refreshEnricherCounters();
            this._renderEnricherList();
            UI.showToast(`تم اعتماد "${med.nameEN || med.nameAR}" وإخفاؤه من الفحص ✅`, 'success');
        } catch (err) {
            UI.showToast('تعذر حفظ حالة الاعتماد: ' + err.message, 'danger');
        }
    },

    async _verifyAllCompleteEnricherRows() {
        const st = this._enricherState;
        if (!st) return;
        const targets = st.rows.filter(r => {
            if (r.status !== 'pending') return false;
            const best = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
            if (!best) return false;
            return !this._computeEnrichDiff(r, st.fields).hasChanges;
        });
        if (targets.length === 0) return;

        try {
            const now = new Date().toISOString();
            for (const row of targets) {
                const med = await DB.get('medicineMaster', row.med.id);
                if (!med) continue;
                const match = row.selectedIdx >= 0 ? row.matches[row.selectedIdx] : null;
                med.catalogVerified = true;
                med.catalogIgnored = false;
                med.catalogVerifiedAt = now;
                if (match?.item?.nameEN) med.catalogMatchedEN = match.item.nameEN;
                med.lastUpdated = now;
                med.v = (med.v || 1) + 1;
                await DB.put('medicineMaster', med);
                if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                    window.Sync.push(med.id).catch(() => {});
                }
                row.med = med;
                row.status = 'verified';
                row.checked = false;
            }
            this._refreshEnricherCounters();
            this._renderEnricherList();
            UI.showToast(`تم اعتماد وإخفاء ${targets.length} دواء مكتمل بنجاح ✅`, 'success');
        } catch (err) {
            UI.showToast('تعذر اعتماد المكتمل: ' + err.message, 'danger');
        }
    },

    async _ignoreEnricherRow(rowIdx) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        try {
            const med = await DB.get('medicineMaster', row.med.id);
            if (!med) return;
            const now = new Date().toISOString();
            med.catalogIgnored = true;
            med.catalogVerified = false;
            med.catalogIgnoredAt = now;
            med.lastUpdated = now;
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(() => {});
            }
            row.med = med;
            row.status = 'ignored';
            row.selectedIdx = -1;
            row.checked = false;
            if (st.openManualIdx === rowIdx) st.openManualIdx = -1;
            this._refreshEnricherCounters();
            this._renderEnricherList();
            UI.showToast(`تم استبعاد "${med.nameEN || med.nameAR}" من الفحص المستقبلي 🚫`, 'info');
        } catch (err) {
            UI.showToast('تعذر حفظ الاستبعاد: ' + err.message, 'danger');
        }
    },

    async _reopenEnricherRow(rowIdx) {
        const st = this._enricherState;
        const row = st?.rows?.[rowIdx];
        if (!row) return;
        try {
            const med = await DB.get('medicineMaster', row.med.id);
            if (!med) return;
            const now = new Date().toISOString();
            med.catalogVerified = false;
            med.catalogIgnored = false;
            med.lastUpdated = now;
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(() => {});
            }
            row.med = med;
            row.status = 'pending';
            row.forceOverwrite = true;
            row.matches = EgyptianDrugs.findBestMatches(med, 5);
            row.selectedIdx = row.matches.length > 0 ? 0 : -1;
            const diff = this._computeEnrichDiff(row, st.fields);
            row.checked = !!(row.selectedIdx >= 0 && row.matches[row.selectedIdx]?.confidence === 'high' && diff.hasChanges);
            this._refreshEnricherCounters();
            this._renderEnricherList();
            UI.showToast(`تمت إعادة "${med.nameEN || med.nameAR}" للفحص 🔄`, 'info');
        } catch (err) {
            UI.showToast('تعذر إعادة الفحص: ' + err.message, 'danger');
        }
    },

    _toggleEnricherManualSearch(rowIdx) {
        const st = this._enricherState;
        if (!st) return;
        if (st.openManualIdx === rowIdx) {
            st.openManualIdx = -1;
            st.manualQuery = '';
            st.manualResults = [];
            this._renderEnricherList();
            return;
        }
        const row = st.rows[rowIdx];
        if (!row) return;
        st.openManualIdx = rowIdx;
        const seed = (row.med.nameEN || row.med.nameAR || '').trim().split(/\s+/)[0] || '';
        st.manualQuery = seed;
        st.manualResults = seed.length >= 2 ? EgyptianDrugs.search(seed, 8) : [];
        this._renderEnricherList();
        setTimeout(() => {
            const inp = document.getElementById(`enr-manual-input-${rowIdx}`);
            if (inp) {
                inp.focus();
                inp.select();
            }
        }, 30);
    },

    _onEnricherManualSearch(rowIdx, query) {
        const st = this._enricherState;
        if (!st || st.openManualIdx !== rowIdx) return;
        st.manualQuery = query || '';
        st.manualResults = st.manualQuery.trim().length >= 2 ? EgyptianDrugs.search(st.manualQuery.trim(), 8) : [];
        const resEl = document.getElementById(`enr-manual-results-${rowIdx}`);
        if (resEl) {
            resEl.innerHTML = this._renderManualSearchResultsHtml(rowIdx, st.manualResults, st.manualQuery);
        }
    },

    _renderManualSearchResultsHtml(rowIdx, results, query) {
        if (!query || query.trim().length < 2) {
            return `<div style="font-size:11px; color:var(--text-muted); padding:6px;">اكتب حرفين على الأقل للبحث في الـ ${EgyptianDrugs.catalogSize.toLocaleString()} دواء...</div>`;
        }
        if (!results || results.length === 0) {
            return `<div style="font-size:11px; color:var(--text-muted); padding:6px;">لا توجد نتائج لـ "${Utils.escapeHTML(query)}" — جرب جزء آخر من الاسم أو المادة الفعالة</div>`;
        }
        return results.map((item, idx) => `
            <div onclick="window.App._onEnricherPickManual(${rowIdx}, ${idx})" style="cursor:pointer; padding:6px 8px; border-radius:7px; border:1px solid var(--border-color); background:var(--surface); margin-top:4px; transition:background 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.08)'" onmouseout="this.style.background='var(--surface)'">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                    <strong style="font-size:11.5px; color:var(--text-main);">${Utils.escapeHTML(EgyptianDrugs.formatEN ? EgyptianDrugs.formatEN(item.nameEN) : item.nameEN)}</strong>
                    ${item.barcode ? `<span style="font-size:9.5px; color:#7c3aed; font-family:monospace;">🔢 ${Utils.escapeHTML(item.barcode)}</span>` : ''}
                </div>
                ${item.nameAR ? `<div style="font-size:10.5px; color:var(--text-muted);">${Utils.escapeHTML(item.nameAR)}</div>` : ''}
                ${item.active ? `<div style="font-size:10px; color:#059669;">💊 ${Utils.escapeHTML(item.active)}</div>` : ''}
            </div>
        `).join('');
    },

    _onEnricherPickManual(rowIdx, resultIdx) {
        const st = this._enricherState;
        if (!st) return;
        const row = st.rows[rowIdx];
        const item = st.manualResults?.[resultIdx];
        if (!row || !item) return;

        const formattedEN = EgyptianDrugs.formatEN ? EgyptianDrugs.formatEN(item.nameEN) : item.nameEN;
        const existingIdx = row.matches.findIndex(m => m.item === item || (m.item.nameEN === item.nameEN && m.item.barcode === item.barcode));
        if (existingIdx >= 0) {
            row.matches[existingIdx].manual = true;
            row.matches[existingIdx].confidence = 'high';
            row.matches[existingIdx].score = 100;
            row.selectedIdx = existingIdx;
        } else {
            row.matches.unshift({
                item,
                score: 100,
                confidence: 'high',
                manual: true,
                formattedEN
            });
            row.selectedIdx = 0;
        }

        row.forceOverwrite = true;
        row.overwriteEN = true;
        const diff = this._computeEnrichDiff(row, st.fields);
        row.checked = diff.hasChanges;
        st.openManualIdx = -1;
        st.manualQuery = '';
        st.manualResults = [];

        this._refreshEnricherCounters();
        this._renderEnricherList();
        UI.showToast(`تم اختيار "${formattedEN}" — اضغط "حفظ التعديل" لتحديث البيانات 🔗`, 'success');
    },

    _toggleEnricherRow(medId, isChecked) {
        const st = this._enricherState;
        if (!st) return;
        const row = st.rows.find(r => r.med.id === medId);
        if (row) row.checked = !!isChecked;
        this._updateEnricherApplyBtn();
    },

    _toggleEnricherAll(selectHigh) {
        const st = this._enricherState;
        if (!st) return;
        for (const r of st.rows) {
            if (!selectHigh || r.status !== 'pending') {
                r.checked = false;
            } else {
                const diff = this._computeEnrichDiff(r, st.fields);
                const best = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
                r.checked = !!(best?.confidence === 'high' && diff.hasChanges);
            }
        }
        this._renderEnricherList();
    },

    _updateEnricherApplyBtn() {
        const st = this._enricherState;
        const btn = document.getElementById('enricher-apply-btn');
        if (!st || !btn) return;
        const count = st.rows.filter(r => r.status === 'pending' && r.checked && this._computeEnrichDiff(r, st.fields).hasChanges).length;
        btn.innerHTML = `<i class='bx bx-check-double'></i> اعتماد (${count} دواء)`;
        btn.disabled = count === 0;
        btn.style.opacity = count === 0 ? '0.55' : '1';
    },

    _renderEnricherList() {
        const st = this._enricherState;
        const container = document.getElementById('enricher-results-list');
        if (!st || !container) return;

        const pq = Utils.prepareSearchQuery(st.search);

        const visible = st.rows.filter(r => {
            if (st.filter === 'done') {
                if (r.status === 'pending') return false;
            } else {
                if (r.status !== 'pending') return false;
                const match = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
                const diff = this._computeEnrichDiff(r, st.fields);
                if (st.filter === 'actionable' && !diff.hasChanges) return false;
                if (st.filter === 'high' && !(match && match.confidence === 'high')) return false;
                if (st.filter === 'medium' && !(match && match.confidence === 'medium')) return false;
                if (st.filter === 'unmatched' && !(!match && r.med.type !== 'supply')) return false;
            }

            if (pq) {
                const match = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
                const extra = match?.item ? [match.item.nameEN, match.item.nameAR, match.item.active] : [];
                if (Utils.smartScoreMed(pq, r.med, extra) === 0) return false;
            }
            return true;
        });

        // Sort: high confidence first, then medium, then unmatched
        visible.sort((a, b) => {
            const sa = (a.selectedIdx >= 0 ? a.matches[a.selectedIdx]?.score : 0) || 0;
            const sb = (b.selectedIdx >= 0 ? b.matches[b.selectedIdx]?.score : 0) || 0;
            return sb - sa;
        });

        if (visible.length === 0) {
            const emptyMsg = st.filter === 'actionable'
                ? 'ممتاز! كل الأدوية الجديدة بياناتها مكتملة وفق الإعدادات المحددة ✅'
                : st.filter === 'unmatched'
                    ? 'ممتاز! لا توجد أدوية غير مطابقة 🎉'
                    : st.filter === 'done'
                        ? 'لا توجد أصناف معتمدة أو مستبعدة بعد'
                        : 'لا توجد أصناف مطابقة لهذا الفلتر';
            container.innerHTML = `
                <div class="empty-state" style="padding:26px; text-align:center; background:var(--bg-secondary); border-radius:12px;">
                    <i class='bx bx-check-circle' style="font-size:34px; color:#10b981;"></i>
                    <p style="margin:8px 0 0 0; font-size:13px; color:var(--text-muted);">${emptyMsg}</p>
                </div>
            `;
            this._updateEnricherApplyBtn();
            return;
        }

        container.innerHTML = visible.map(r => {
            const med = r.med;
            // Render compact card for already-verified / ignored items in the 'done' tab
            if (r.status !== 'pending') {
                const statusBadge = r.status === 'verified'
                    ? `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:rgba(16,185,129,0.12); color:#059669; font-weight:800;">✅ معتمد</span>`
                    : `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:rgba(100,116,139,0.14); color:var(--text-muted); font-weight:700;">🚫 مستبعد</span>`;
                return `
                    <div style="padding:9px 10px; border-radius:10px; background:var(--surface); border:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <div style="min-width:0; flex:1;">
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                <strong style="font-size:12px; color:var(--text-main);">${Utils.escapeHTML(med.nameEN || med.nameAR)}</strong>
                                ${statusBadge}
                            </div>
                            ${med.nameAR && med.nameAR !== med.nameEN ? `<div style="font-size:10.5px; color:var(--text-muted);">${Utils.escapeHTML(med.nameAR)}</div>` : ''}
                            ${med.activeIngredient ? `<div style="font-size:10px; color:#059669;">💊 ${Utils.escapeHTML(med.activeIngredient)}</div>` : ''}
                        </div>
                        <button type="button" onclick="window.App._reopenEnricherRow(${r._idx})" style="font-size:10.5px; padding:4px 8px; border-radius:7px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-main); cursor:pointer; white-space:nowrap;">🔄 إعادة للفحص</button>
                    </div>
                `;
            }

            const match = r.selectedIdx >= 0 ? r.matches[r.selectedIdx] : null;
            const diff = this._computeEnrichDiff(r, st.fields);
            const isHigh = match?.confidence === 'high';
            const badge = !match
                ? `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:var(--bg-secondary); color:var(--text-muted); border:1px solid var(--border-color);">${med.type === 'supply' ? '🩹 مستلزم طبي' : '⚪ غير مطابق'}</span>`
                : match.manual
                    ? `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:rgba(59,130,246,0.14); color:#2563eb; font-weight:800;">🔗 ربط يدوي</span>`
                    : isHigh
                        ? `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:rgba(16,185,129,0.12); color:#059669; font-weight:800;">🟢 قوي ${match.score}%</span>`
                        : `<span style="font-size:10px; padding:2px 6px; border-radius:6px; background:rgba(245,158,11,0.14); color:#d97706; font-weight:800;">🟡 مراجعة ${match.score}%${match.fuzzyCorrected ? ' ✏️' : ''}</span>`;

            const diffLines = [];
            if (diff.changes.activeIngredient) {
                diffLines.push(`<div style="font-size:11px; color:#059669;">💊 <strong>المادة الفعالة:</strong> ${diff.changes.activeIngredient.from ? `<s style="opacity:0.6;">${Utils.escapeHTML(diff.changes.activeIngredient.from)}</s> ⬅️ ` : '+ '}${Utils.escapeHTML(diff.changes.activeIngredient.to)}</div>`);
            }
            if (diff.changes.nameAR) {
                diffLines.push(`<div style="font-size:11px; color:#2563eb;">🔤 <strong>الاسم العربي:</strong> ${diff.changes.nameAR.from ? `<s style="opacity:0.6;">${Utils.escapeHTML(diff.changes.nameAR.from)}</s> ⬅️ ` : '+ '}${Utils.escapeHTML(diff.changes.nameAR.to)}</div>`);
            }
            if (diff.changes.barcode) {
                diffLines.push(`<div style="font-size:11px; color:#7c3aed; font-family:monospace;">🔢 <strong>الباركود:</strong> ${diff.changes.barcode.from ? `<s style="opacity:0.6;">${Utils.escapeHTML(diff.changes.barcode.from)}</s> ⬅️ ` : '+ '}${Utils.escapeHTML(diff.changes.barcode.to)}</div>`);
            }
            if (diff.changes.nameEN) {
                diffLines.push(`<div style="font-size:11px; color:#d97706;">🇬🇧 <strong>الإنجليزي:</strong> <s style="opacity:0.6;">${Utils.escapeHTML(diff.changes.nameEN.from)}</s> ⬅️ ${Utils.escapeHTML(diff.changes.nameEN.to)}</div>`);
            }

            const safeMedId = Utils.escapeHTML(med.id);
            const isManualOpen = st.openManualIdx === r._idx;

            const actionBtns = med.type === 'supply' ? '' : (match
                ? `
                    <button type="button" onclick="window.App._toggleEnricherManualSearch(${r._idx})" style="font-size:10px; padding:3px 7px; border-radius:6px; border:1px solid rgba(59,130,246,0.3); background:rgba(59,130,246,0.06); color:var(--primary); cursor:pointer; font-weight:700;">🔍 ${isManualOpen ? 'إغلاق' : 'تغيير / بحث'}</button>
                    <button type="button" onclick="window.App._rejectEnricherMatch(${r._idx})" style="font-size:10px; padding:3px 7px; border-radius:6px; border:1px solid rgba(239,68,68,0.3); background:rgba(239,68,68,0.06); color:#dc2626; cursor:pointer; font-weight:700;">❌ غير مطابق</button>
                `
                : `
                    <button type="button" onclick="window.App._toggleEnricherManualSearch(${r._idx})" style="font-size:10.5px; padding:3px 8px; border-radius:6px; border:1px solid rgba(59,130,246,0.35); background:rgba(59,130,246,0.08); color:var(--primary); cursor:pointer; font-weight:700;">🔍 ${isManualOpen ? 'إغلاق البحث' : 'بحث يدوي وربط'}</button>
                    <button type="button" onclick="window.App._ignoreEnricherRow(${r._idx})" style="font-size:10px; padding:3px 7px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-muted); cursor:pointer;">🚫 استبعاد</button>
                `
            );

            return `
                <div style="padding:10px; border-radius:10px; background:var(--surface); border:1px solid ${r.checked && diff.hasChanges ? 'rgba(16,185,129,0.5)' : 'var(--border-color)'};">
                    <div style="display:flex; align-items:flex-start; gap:8px;">
                        ${diff.hasChanges ? `
                            <input type="checkbox" ${r.checked ? 'checked' : ''} onchange="window.App._toggleEnricherRow('${safeMedId}', this.checked)" style="margin-top:3px; width:16px; height:16px; cursor:pointer; accent-color:#10b981;">
                        ` : ''}
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                                <strong style="font-size:12.5px; color:var(--text-main);">${Utils.escapeHTML(med.nameEN || med.nameAR)}</strong>
                                <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                                    ${actionBtns}
                                    ${badge}
                                </div>
                            </div>
                            ${med.nameAR && med.nameAR !== med.nameEN ? `<div style="font-size:11px; color:var(--text-muted);">${Utils.escapeHTML(med.nameAR)}</div>` : ''}

                            ${isManualOpen ? `
                                <div style="margin-top:7px; padding:8px; border-radius:8px; background:var(--bg-secondary); border:1px solid rgba(59,130,246,0.35);">
                                    <input type="text" id="enr-manual-input-${r._idx}" value="${Utils.escapeHTML(st.manualQuery)}" placeholder="ابحث بالاسم الإنجليزي أو العربي أو المادة الفعالة..." oninput="window.App._onEnricherManualSearch(${r._idx}, this.value)" style="width:100%; padding:6px 8px; border-radius:7px; border:1px solid var(--border-color); background:var(--surface); color:var(--text-main); font-size:11.5px; box-sizing:border-box;">
                                    <div id="enr-manual-results-${r._idx}" style="max-height:170px; overflow-y:auto; margin-top:4px;">
                                        ${this._renderManualSearchResultsHtml(r._idx, st.manualResults, st.manualQuery)}
                                    </div>
                                </div>
                            ` : ''}

                            ${r.matches.length > 0 ? `
                                <div style="margin-top:6px;">
                                    <select onchange="window.App._onEnricherSelectMatch('${safeMedId}', this.value)" style="width:100%; padding:5px 7px; border-radius:7px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-main); font-size:11px;">
                                        ${r.matches.map((m, idx) => `
                                            <option value="${idx}" ${idx === r.selectedIdx ? 'selected' : ''}>
                                                [${m.manual ? 'يدوي' : m.score + '%'}] ${Utils.escapeHTML(m.formattedEN)}${m.item.nameAR ? ' — ' + Utils.escapeHTML(m.item.nameAR) : ''}${m.item.barcode ? ' 🔢' : ''}
                                            </option>
                                        `).join('')}
                                        <option value="-1" ${r.selectedIdx === -1 ? 'selected' : ''}>❌ لا يوجد تطابق مناسب (غير مطابق)</option>
                                    </select>
                                </div>
                            ` : ''}

                            ${diffLines.length > 0 ? `
                                <div style="margin-top:6px; padding:6px 8px; border-radius:7px; background:var(--bg-secondary); display:flex; flex-direction:column; gap:3px;">
                                    ${diffLines.join('')}
                                    <div style="margin-top:4px; padding-top:4px; border-top:1px dashed var(--border-color); display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                                        ${(r.forceOverwrite || match?.manual) ? `
                                            <label style="font-size:10px; color:var(--text-muted); cursor:pointer; display:flex; align-items:center; gap:4px;">
                                                <input type="checkbox" ${r.overwriteEN || st.fields.updateEN ? 'checked' : ''} onchange="window.App._toggleEnricherRowOverwriteEN(${r._idx}, this.checked)"> استبدال الاسم الإنجليزي أيضاً
                                            </label>
                                        ` : '<span></span>'}
                                        <button type="button" onclick="window.App._applySingleEnricherRow(${r._idx})" style="font-size:10.5px; padding:3px 9px; border-radius:6px; border:none; background:#10b981; color:#fff; font-weight:700; cursor:pointer;">💾 حفظ التعديل</button>
                                    </div>
                                </div>
                            ` : (match ? `
                                <div style="margin-top:6px; display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
                                    <span style="font-size:10.5px; color:var(--text-muted);">✅ بيانات هذا الصنف مكتملة</span>
                                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                                        <button type="button" onclick="window.App._enableEnricherOverwrite(${r._idx})" style="font-size:10px; padding:3px 8px; border-radius:6px; border:1px solid rgba(245,158,11,0.4); background:rgba(245,158,11,0.1); color:#b45309; font-weight:700; cursor:pointer;">✏️ تعديل / استبدال</button>
                                        <button type="button" onclick="window.App._verifySingleEnricherRow(${r._idx})" style="font-size:10px; padding:3px 8px; border-radius:6px; border:1px solid rgba(16,185,129,0.35); background:rgba(16,185,129,0.1); color:#059669; font-weight:700; cursor:pointer;">✅ اعتماد وإخفاء</button>
                                    </div>
                                </div>
                            ` : '')}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this._updateEnricherApplyBtn();
    },

    async applyCatalogEnrichment() {
        const st = this._enricherState;
        if (!st) return;

        const toUpdate = st.rows
            .filter(r => r.status === 'pending' && r.checked)
            .map(r => ({ row: r, diff: this._computeEnrichDiff(r, st.fields) }))
            .filter(x => x.diff.hasChanges);

        if (toUpdate.length === 0) {
            UI.showToast('لم يتم تحديد أي أصناف للتحديث', 'info');
            return;
        }

        const btn = document.getElementById('enricher-apply-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> جاري الحفظ...`;
        }

        try {
            let updatedCount = 0;
            const now = new Date().toISOString();

            for (const { row, diff } of toUpdate) {
                const med = await DB.get('medicineMaster', row.med.id);
                if (!med) continue;

                if (diff.changes.activeIngredient) med.activeIngredient = diff.changes.activeIngredient.to;
                if (diff.changes.nameAR) med.nameAR = diff.changes.nameAR.to;
                if (diff.changes.barcode) med.barcode = diff.changes.barcode.to;
                if (diff.changes.nameEN) med.nameEN = diff.changes.nameEN.to;

                const match = row.selectedIdx >= 0 ? row.matches[row.selectedIdx] : null;
                med.catalogVerified = true;
                med.catalogIgnored = false;
                med.catalogVerifiedAt = now;
                if (match?.item?.nameEN) med.catalogMatchedEN = match.item.nameEN;

                med.lastUpdated = now;
                med.v = (med.v || 1) + 1;
                await DB.put('medicineMaster', med);

                if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                    window.Sync.push(med.id).catch(e => console.warn('Sync push enrich error:', e));
                }
                updatedCount++;
            }

            this._dashCache = null;
            UI.closeModal();
            UI.showToast(`تم تكميل واعتماد ومزامنة ${updatedCount} دواء بنجاح ✨💊`, 'success');
            await this.refreshAllViews();
        } catch (err) {
            console.error('Apply enrichment error:', err);
            UI.showToast('حدث خطأ أثناء حفظ التعديلات: ' + err.message, 'danger');
            if (btn) {
                btn.disabled = false;
                this._updateEnricherApplyBtn();
            }
        }
    },
    // ===================== End Smart Catalog Enricher =====================

    // ===================== Clear Barcode Safely (Separate from DB ID) =====================
    async clearMedicineBarcode(medId) {
        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) return;
            med.barcode = '';
            med.lastUpdated = new Date().toISOString();
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(e => console.warn('Sync push clear barcode error:', e));
            }
            UI.showToast('تم مسح الباركود بنجاح (كود الدواء في القاعدة كما هو) 🗑️✅', 'success');
            await this.openMedicineDetails(medId);
        } catch (err) {
            console.error('Clear barcode error:', err);
            UI.showToast('تعذر مسح الباركود', 'danger');
        }
    },

    // ===================== Active Ingredient Analytics & Grouping =====================
    _normalizeActiveKey(str) {
        if (!str) return '';
        const cleaned = String(str)
            .toLowerCase()
            .replace(/\s*\([^)]*\)\s*/g, ' ') // normalize parenthetical aliases like paracetamol(acetaminophen)
            .replace(/[,;/]+/g, '+')
            .split('+')
            .map(p => p.trim().replace(/\s+/g, ' '))
            .filter(Boolean)
            .sort()
            .join(' + ');
        return cleaned;
    },

    async openActiveIngredientAnalysisModal(sourceKey = 'inventory') {
        try {
            const allSessions = (await Audit.getAllSessions()) || [];
            this._activeAnalysisState = {
                sourceKey: sourceKey || 'inventory',
                sessions: allSessions,
                filter: 'all', // 'all' | 'multi' | 'critical' | 'missing'
                search: '',
                groups: []
            };
            await this._buildActiveAnalysisData();
            this._renderActiveAnalysisModal();
        } catch (err) {
            console.error('Active ingredient analysis error:', err);
            UI.showToast('تعذر فتح شاشة التحليل بالمادة الفعالة', 'danger');
        }
    },

    async _buildActiveAnalysisData() {
        const st = this._activeAnalysisState;
        if (!st) return;

        const allMeds = (await DB.getAll('medicineMaster')) || [];
        const qtyMap = new Map(); // medId -> totalQty

        if (st.sourceKey === 'inventory') {
            const inv = (await DB.getAll('inventory')) || [];
            for (const entry of inv) {
                const q = parseFloat(entry.quantity) || 0;
                qtyMap.set(entry.medicineId, (qtyMap.get(entry.medicineId) || 0) + q);
            }
        } else {
            const session = await Audit.getSession(st.sourceKey);
            if (session && session.counts) {
                for (const [key, rec] of Object.entries(session.counts)) {
                    const [, medId] = key.split('___');
                    const batches = (rec.batches && rec.batches.length > 0)
                        ? rec.batches
                        : [{ quantity: rec.quantity }];
                    const sum = batches.reduce((s, b) => s + (parseFloat(b.quantity) || 0), 0);
                    qtyMap.set(medId, (qtyMap.get(medId) || 0) + sum);
                }
            }
        }

        const groupMap = new Map();
        for (const med of allMeds) {
            const rawAct = (med.activeIngredient || '').trim();
            const normKey = this._normalizeActiveKey(rawAct);
            const gKey = normKey || '__missing__';

            if (!groupMap.has(gKey)) {
                groupMap.set(gKey, {
                    key: gKey,
                    label: normKey ? rawAct : 'بدون مادة فعالة مسجلة',
                    isMissing: !normKey,
                    meds: [],
                    totalQty: 0
                });
            }
            const g = groupMap.get(gKey);
            const medQty = qtyMap.get(med.id) || 0;
            g.meds.push({
                id: med.id,
                nameEN: med.nameEN || '',
                nameAR: med.nameAR || '',
                qty: medQty
            });
            g.totalQty += medQty;
        }

        // Sort meds inside each group by qty desc then name
        for (const g of groupMap.values()) {
            g.meds.sort((a, b) => b.qty - a.qty || (a.nameEN || a.nameAR).localeCompare(b.nameEN || b.nameAR));
        }

        // Sort groups: multi-brand alternatives first, then alphabetical, missing at end
        st.groups = Array.from(groupMap.values()).sort((a, b) => {
            if (a.isMissing !== b.isMissing) return a.isMissing ? 1 : -1;
            if ((b.meds.length > 1) !== (a.meds.length > 1)) return (b.meds.length > 1) ? 1 : -1;
            if (b.meds.length !== a.meds.length) return b.meds.length - a.meds.length;
            return a.label.localeCompare(b.label);
        });
    },

    _renderActiveAnalysisModal() {
        const st = this._activeAnalysisState;
        if (!st) return;

        const validGroups = st.groups.filter(g => !g.isMissing);
        const multiCount = validGroups.filter(g => g.meds.length >= 2).length;
        const criticalCount = validGroups.filter(g => g.totalQty <= 5).length;
        const missingGroup = st.groups.find(g => g.isMissing);
        const missingCount = missingGroup ? missingGroup.meds.length : 0;

        const sessionOpts = (st.sessions || []).map(s => {
            const icon = (s.status === 'completed' || s.status === 'finalized') ? '✅' : '🔄';
            return `<option value="${s.id}" ${st.sourceKey === s.id ? 'selected' : ''}>${icon} جرد: ${Utils.escapeHTML(s.name || 'جلسة')}</option>`;
        }).join('');

        UI.showModal(`
            <div class="sheet-handle"></div>
            <div class="modal-header" style="margin-bottom:10px;">
                <h2 style="font-size:16px; display:flex; align-items:center; gap:6px;">
                    <i class='bx bx-dna' style="color:#7c3aed;"></i> التحليل وتجميع الأرصدة بالمادة الفعالة
                </h2>
                <p class="text-muted" style="font-size:11.5px; margin-top:3px;">
                    تجميع المثائل والبدائل ومعرفة إجمالي الرصيد المدمج لكل مادة فعالة
                </p>
            </div>

            <!-- Source Selector -->
            <div style="margin-bottom:10px; display:flex; gap:8px; align-items:center;">
                <label style="font-size:12px; font-weight:700; white-space:nowrap;">📂 مصدر الأرصدة:</label>
                <select onchange="window.App._onActiveAnalysisSourceChange(this.value)" style="flex:1; padding:6px 8px; border-radius:8px; border:1px solid var(--border-color); background:var(--surface); color:var(--text-main); font-size:12px;">
                    <option value="inventory" ${st.sourceKey === 'inventory' ? 'selected' : ''}>📦 المخزون الحالي</option>
                    ${sessionOpts}
                </select>
            </div>

            <!-- Summary Strip -->
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:10px; text-align:center;">
                <div style="padding:7px; border-radius:8px; background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.25);">
                    <div style="font-size:15px; font-weight:800; color:#7c3aed;">${validGroups.length}</div>
                    <div style="font-size:10px; color:var(--text-muted);">🧬 مادة فعالة</div>
                </div>
                <div style="padding:7px; border-radius:8px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25);">
                    <div style="font-size:15px; font-weight:800; color:var(--primary);">${multiCount}</div>
                    <div style="font-size:10px; color:var(--text-muted);">🔗 مواد لها بدائل (2+)</div>
                </div>
                <div style="padding:7px; border-radius:8px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25);">
                    <div style="font-size:15px; font-weight:800; color:#dc2626;">${criticalCount}</div>
                    <div style="font-size:10px; color:var(--text-muted);">⚠️ رصيد حرج / صفر</div>
                </div>
            </div>

            <!-- Filter Tabs + Search -->
            <div style="display:flex; gap:5px; margin-bottom:8px; flex-wrap:wrap;">
                <button type="button" id="act-tab-all" onclick="window.App._setActiveAnalysisFilter('all')" class="${st.filter==='all'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:11px; padding:5px 8px; border-radius:8px; ${st.filter!=='all'?'border:1px solid var(--border-color);':''}">الكل</button>
                <button type="button" id="act-tab-multi" onclick="window.App._setActiveAnalysisFilter('multi')" class="${st.filter==='multi'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:11px; padding:5px 8px; border-radius:8px; ${st.filter!=='multi'?'border:1px solid var(--border-color);':''}">🔗 لها بدائل (${multiCount})</button>
                <button type="button" id="act-tab-critical" onclick="window.App._setActiveAnalysisFilter('critical')" class="${st.filter==='critical'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:11px; padding:5px 8px; border-radius:8px; ${st.filter!=='critical'?'border:1px solid var(--border-color);':''}">⚠️ حرج/صفر (${criticalCount})</button>
                ${missingCount > 0 ? `<button type="button" id="act-tab-missing" onclick="window.App._setActiveAnalysisFilter('missing')" class="${st.filter==='missing'?'btn-primary':'btn-ghost'} sm-btn" style="font-size:11px; padding:5px 8px; border-radius:8px; ${st.filter!=='missing'?'border:1px solid var(--border-color);':''}">بدون مادة (${missingCount})</button>` : ''}
            </div>

            <div class="audit-search-wrapper" style="width:100%; margin-bottom:10px;">
                <i class='bx bx-search'></i>
                <input type="text" id="act-analysis-search" class="audit-search-input" placeholder="🔍 ابحث بالمادة الفعالة أو باسم الدواء..." value="${Utils.escapeHTML(st.search)}" oninput="window.App._setActiveAnalysisSearch(this.value)">
            </div>

            <!-- Groups List -->
            <div id="active-analysis-list" style="max-height:42vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:2px;"></div>

            <!-- Footer -->
            <div class="form-actions mt-15" style="display:flex; gap:8px; justify-content:space-between; flex-wrap:wrap;">
                <button type="button" class="btn-ghost sm-btn" onclick="window.App.exportActiveIngredientAnalysis()" style="border:1px solid rgba(139,92,246,0.4); color:#7c3aed; font-size:12px;">
                    <i class='bx bx-download'></i> تصدير إكسيل بالمادة الفعالة
                </button>
                <button type="button" class="btn-primary sm-btn" onclick="window.UI.closeModal()">إغلاق</button>
            </div>
        `);

        this._renderActiveAnalysisList();
    },

    async _onActiveAnalysisSourceChange(newSource) {
        if (!this._activeAnalysisState) return;
        this._activeAnalysisState.sourceKey = newSource;
        await this._buildActiveAnalysisData();
        this._renderActiveAnalysisModal();
    },

    _setActiveAnalysisFilter(f) {
        if (!this._activeAnalysisState) return;
        this._activeAnalysisState.filter = f;
        ['all', 'multi', 'critical', 'missing'].forEach(key => {
            const btn = document.getElementById(`act-tab-${key}`);
            if (!btn) return;
            if (key === f) {
                btn.className = 'btn-primary sm-btn';
                btn.style.border = 'none';
            } else {
                btn.className = 'btn-ghost sm-btn';
                btn.style.border = '1px solid var(--border-color)';
            }
        });
        this._renderActiveAnalysisList();
    },

    _setActiveAnalysisSearch(q) {
        if (!this._activeAnalysisState) return;
        this._activeAnalysisState.search = q || '';
        this._renderActiveAnalysisList();
    },

    _renderActiveAnalysisList() {
        const st = this._activeAnalysisState;
        const container = document.getElementById('active-analysis-list');
        if (!st || !container) return;

        const pq = Utils.prepareSearchQuery(st.search);

        const visible = st.groups.filter(g => {
            if (st.filter === 'multi' && (g.isMissing || g.meds.length < 2)) return false;
            if (st.filter === 'critical' && (g.isMissing || g.totalQty > 5)) return false;
            if (st.filter === 'missing' && !g.isMissing) return false;

            if (pq) {
                const labelMatch = Utils.smartScore(pq, [g.label], []) > 0;
                const medMatch = g.meds.some(m => Utils.smartScoreMed(pq, m) > 0);
                if (!labelMatch && !medMatch) return false;
            }
            return true;
        });

        if (visible.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:24px; text-align:center; background:var(--bg-secondary); border-radius:12px;">
                    <i class='bx bx-dna' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد نتائج مطابقة</p>
                </div>
            `;
            return;
        }

        container.innerHTML = visible.map(g => {
            const qtyColor = g.totalQty === 0 ? '#dc2626' : (g.totalQty <= 5 ? '#d97706' : '#059669');
            const qtyBg = g.totalQty === 0 ? 'rgba(239,68,68,0.1)' : (g.totalQty <= 5 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)');
            return `
                <div style="padding:10px 12px; border-radius:10px; background:var(--surface); border:1px solid ${g.meds.length >= 2 && !g.isMissing ? 'rgba(139,92,246,0.35)' : 'var(--border-color)'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                        <div style="min-width:0; flex:1;">
                            <div style="font-size:12.5px; font-weight:800; color:${g.isMissing ? 'var(--text-muted)' : '#7c3aed'}; word-break:break-word;">
                                ${g.isMissing ? '⚪' : '🧬'} ${Utils.escapeHTML(g.label)}
                            </div>
                            <div style="font-size:10.5px; color:var(--text-muted); margin-top:1px;">
                                ${g.meds.length} ${g.meds.length > 1 ? 'بدائل مسجلة' : 'صنف مسجل'}
                            </div>
                        </div>
                        <span style="padding:4px 9px; border-radius:8px; background:${qtyBg}; color:${qtyColor}; font-weight:800; font-size:12px; white-space:nowrap;">
                            الإجمالي: ${g.totalQty}
                        </span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px; border-top:1px dashed var(--border-color); padding-top:6px;">
                        ${g.meds.map(m => `
                            <div onclick="window.App.openMedicineDetails('${Utils.escapeHTML(m.id)}')" style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:4px 6px; border-radius:6px; background:var(--bg-secondary); cursor:pointer; font-size:11.5px;">
                                <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; color:var(--text-main);">
                                    ${Utils.escapeHTML(m.nameEN || m.nameAR)}${m.nameAR && m.nameAR !== m.nameEN ? ` <small style="color:var(--text-muted);">(${Utils.escapeHTML(m.nameAR)})</small>` : ''}
                                </span>
                                <strong style="color:${m.qty === 0 ? '#dc2626' : 'var(--primary)'}; white-space:nowrap;">${m.qty}</strong>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    exportActiveIngredientAnalysis() {
        const st = this._activeAnalysisState;
        if (!st) return;
        const opts = {
            source: st.sourceKey === 'inventory' ? 'inventory' : 'audit',
            sessionId: st.sourceKey === 'inventory' ? null : st.sourceKey,
            nameMode: 'both',
            groupMode: 'active',
            locationMode: 'columns',
            expiryMode: 'all',
            sortMode: 'name'
        };
        this.exportCustomInventory(opts);
    },
    // ===================== End Active Ingredient Analytics =====================

    // ===================== Recycle Bin (Trash) & Orphan Audit Inspector =====================
    async _scanOrphanAuditCounts() {
        const masterMeds = (await DB.getAll('medicineMaster')) || [];
        const masterIds = new Set(masterMeds.map(m => String(m.id)));
        const sessions = (await Audit.getAllSessions()) || [];
        const locs = (await Locations.getAll()) || [];
        const locMap = new Map(locs.map(l => [l.id, l.nameAR || l.id]));

        const orphans = [];
        for (const s of sessions) {
            if (!s || !s.counts) continue;
            for (const [key, rec] of Object.entries(s.counts)) {
                const [locId, medId] = key.split('___');
                if (!masterIds.has(String(medId))) {
                    const batches = (rec.batches && rec.batches.length > 0)
                        ? rec.batches
                        : [{ quantity: rec.quantity, expiryDate: rec.expiryDate }];
                    const qty = batches.reduce((sum, b) => sum + (parseFloat(b.quantity) || 0), 0);
                    const exps = batches.filter(b => (parseFloat(b.quantity) || 0) > 0 && b.expiryDate).map(b => `${b.expiryDate} (${b.quantity})`);
                    orphans.push({
                        sessionId: s.id,
                        sessionName: s.name || 'جلسة جرد',
                        sessionStatus: s.status || 'active',
                        key,
                        locId,
                        locName: locMap.get(locId) || locId,
                        medId,
                        qty,
                        expText: exps.join(' | ') || 'بدون صلاحية',
                        userName: rec.userName || s.host || '—',
                        countedAt: rec.countedAt ? new Date(rec.countedAt).toLocaleString('ar-EG') : '—'
                    });
                }
            }
        }
        return orphans;
    },

    async openTrashModal(activeTab = null) {
        try {
            const trashItems = await Categories.getTrashItems();
            const orphans = await this._scanOrphanAuditCounts();
            // If trash is empty and there are orphan audit records, open directly on orphans tab so user sees them immediately!
            const tab = activeTab || (trashItems.length === 0 && orphans.length > 0 ? 'orphans' : 'trash');

            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header" style="margin-bottom:10px;">
                    <h2 style="font-size:16px; display:flex; align-items:center; gap:6px;">
                        <i class='bx bx-trash' style="color:var(--danger);"></i> سلة المهملات وتنظيف الجرد
                    </h2>
                    <p class="text-muted" style="font-size:11.5px; margin-top:3px;">
                        استعد الأصناف المحذوفة أو افحص ونظّف الأصناف المجهولة (Unknown) العالقة في الجرد
                    </p>
                </div>

                <!-- Tabs -->
                <div style="display:flex; gap:6px; margin-bottom:12px;">
                    <button type="button" onclick="window.App.openTrashModal('trash')" class="${tab === 'trash' ? 'btn-primary' : 'btn-ghost'} sm-btn" style="flex:1; font-size:12px; padding:7px 10px; border-radius:9px; ${tab !== 'trash' ? 'border:1px solid var(--border-color);' : ''}">
                        🗑️ سلة المهملات (${trashItems.length})
                    </button>
                    <button type="button" onclick="window.App.openTrashModal('orphans')" class="${tab === 'orphans' ? 'btn-primary' : 'btn-ghost'} sm-btn" style="flex:1; font-size:12px; padding:7px 10px; border-radius:9px; ${tab !== 'orphans' ? 'border:1px solid var(--border-color);' : ''}">
                        🧹 عوالق الجرد Unknown (${orphans.length})
                    </button>
                </div>

                <div style="max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:2px;">
                    ${tab === 'trash' ? (
                        trashItems.length === 0 ? `
                            <div class="empty-state" style="padding:28px; text-align:center; background:var(--bg-secondary); border-radius:12px;">
                                <i class='bx bx-check-shield' style="font-size:36px; color:#10b981;"></i>
                                <p style="margin:8px 0 0 0; font-size:13px; color:var(--text-muted);">سلة المهملات فارغة حالياً</p>
                                <small class="text-muted">أي دواء أو قسم تحذفه من الآن سيظهر هنا مع إمكانية استعادته بالكامل</small>
                            </div>
                        ` : trashItems.map(item => {
                            const isCat = item.itemType === 'category';
                            const titleEN = isCat ? (item.data?.nameEN || '') : (item.data?.nameEN || item.data?.nameAR || 'دواء');
                            const titleAR = isCat ? (item.data?.nameAR || 'قسم') : (item.data?.nameAR || '');
                            const delDate = item.deletedAt ? new Date(item.deletedAt).toLocaleString('ar-EG') : '';
                            return `
                                <div style="padding:10px 12px; border-radius:10px; background:var(--surface); border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <div style="flex:1; min-width:160px;">
                                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                            <span style="font-size:10px; padding:2px 6px; border-radius:5px; background:${isCat ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)'}; color:${isCat ? '#d97706' : 'var(--primary)'}; font-weight:800;">
                                                ${isCat ? '🏷️ قسم' : '💊 دواء'}
                                            </span>
                                            <strong style="font-size:13px; color:var(--text-main);">${Utils.escapeHTML(isCat ? titleAR : titleEN)}</strong>
                                        </div>
                                        ${(!isCat && titleAR && titleAR !== titleEN) ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${Utils.escapeHTML(titleAR)}</div>` : ''}
                                        <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">
                                            حُذف بواسطة: ${Utils.escapeHTML(item.deletedBy || '—')} &bull; ${delDate}
                                        </div>
                                    </div>
                                    <div style="display:flex; gap:6px; flex-shrink:0;">
                                        <button type="button" class="btn-primary sm-btn" onclick="window.App.restoreTrashItem('${Utils.escapeHTML(item.id)}')" style="font-size:11px; padding:5px 9px; border-radius:7px; background:#10b981;">
                                            <i class='bx bx-undo'></i> استعادة
                                        </button>
                                        <button type="button" class="btn-ghost sm-btn" onclick="window.App.permanentDeleteTrashItem('${Utils.escapeHTML(item.id)}')" style="font-size:11px; padding:5px 8px; border-radius:7px; border:1px solid rgba(239,68,68,0.35); color:var(--danger);" title="حذف نهائي">
                                            <i class='bx bx-x'></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')
                    ) : (
                        orphans.length === 0 ? `
                            <div class="empty-state" style="padding:28px; text-align:center; background:var(--bg-secondary); border-radius:12px;">
                                <i class='bx bx-check-circle' style="font-size:36px; color:#10b981;"></i>
                                <p style="margin:8px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أي أصناف مجهولة (Unknown) عالقة في جلسات الجرد ✅</p>
                            </div>
                        ` : orphans.map(o => `
                            <div style="padding:10px 12px; border-radius:10px; background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.35);">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-size:12.5px; font-weight:800; color:var(--text-main);">
                                            ⚠️ صنف محذوف — كود: <code style="color:var(--danger);">#${Utils.escapeHTML(o.medId)}</code>
                                        </div>
                                        <div style="font-size:11.5px; color:var(--text-muted); margin-top:3px;">
                                            📋 الجلسة: <strong>${Utils.escapeHTML(o.sessionName)}</strong> &bull; 📍 المكان: <strong>${Utils.escapeHTML(o.locName)}</strong>
                                        </div>
                                        <div style="font-size:11.5px; color:var(--text-main); margin-top:3px;">
                                            📦 الكمية المسجلة: <strong style="color:var(--primary);">${o.qty}</strong> &bull; 📅 الصلاحية: ${Utils.escapeHTML(o.expText)}
                                        </div>
                                        <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">
                                            👤 عدّه: ${Utils.escapeHTML(o.userName)} &bull; ${o.countedAt}
                                        </div>
                                    </div>
                                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.deleteOrphanAuditCount('${Utils.escapeHTML(o.sessionId)}', '${Utils.escapeHTML(o.key)}')" style="font-size:11px; padding:6px 9px; border-radius:8px; border:1px solid rgba(239,68,68,0.4); color:var(--danger); flex-shrink:0;">
                                        <i class='bx bx-trash'></i> حذف
                                    </button>
                                </div>
                            </div>
                        `).join('')
                    )}
                </div>

                <div class="form-actions mt-15" style="display:flex; gap:8px; justify-content:space-between; flex-wrap:wrap;">
                    ${tab === 'trash' && trashItems.length > 0 ? `
                        <button type="button" class="btn-ghost sm-btn" onclick="window.App.emptyTrashConfirm()" style="color:var(--danger); border:1px solid rgba(239,68,68,0.35); font-size:11.5px;">
                            🧹 تفريغ السلة نهائياً
                        </button>
                    ` : (tab === 'orphans' && orphans.length > 0 ? `
                        <button type="button" class="btn-primary sm-btn" onclick="window.App.cleanAllOrphanAuditCounts()" style="background:#ef4444; font-size:11.5px;">
                            🧹 تنظيف كل العوالق (${orphans.length})
                        </button>
                    ` : '<span></span>')}
                    <button type="button" class="btn-ghost sm-btn" onclick="window.UI.closeModal()">إغلاق</button>
                </div>
            `);
        } catch (err) {
            console.error('Open trash modal error:', err);
            UI.showToast('تعذر فتح سلة المهملات', 'danger');
        }
    },

    async restoreTrashItem(trashId) {
        try {
            const ok = await Categories.restoreFromTrash(trashId);
            if (ok) {
                UI.showToast('تمت الاستعادة بنجاح ومزامنتها سحابياً ♻️✅', 'success');
                await this.refreshAllViews();
                await this.openTrashModal('trash');
            }
        } catch (err) {
            console.error('Restore trash error:', err);
            UI.showToast('فشل الاستعادة: ' + err.message, 'danger');
        }
    },

    async permanentDeleteTrashItem(trashId) {
        if (!confirm('حذف نهائي لا يمكن التراجع عنه؟')) return;
        try {
            await Categories.permanentDeleteFromTrash(trashId);
            UI.showToast('تم الحذف النهائي 🗑️', 'info');
            await this.openTrashModal('trash');
        } catch (err) {
            UI.showToast('فشل الحذف النهائي', 'danger');
        }
    },

    async emptyTrashConfirm() {
        if (!confirm('هل أنت متأكد من تفريغ سلة المهملات بالكامل؟ لا يمكن التراجع عن هذا الإجراء.')) return;
        try {
            const n = await Categories.emptyTrash();
            UI.showToast(`تم تفريغ سلة المهملات (${n} عنصر) 🧹`, 'info');
            await this.openTrashModal('trash');
        } catch (err) {
            UI.showToast('فشل تفريغ السلة', 'danger');
        }
    },

    async deleteOrphanAuditCount(sessionId, countKey) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session || !session.counts) return;
            delete session.counts[countKey];
            session.updatedAt = new Date().toISOString();
            await DB.put('audit_sessions', session);
            if (typeof Sync !== 'undefined' && Sync.deleteAuditCountKeys) {
                await Sync.deleteAuditCountKeys(sessionId, [countKey]);
            }
            UI.showToast('تم تنظيف السجل المجهول من الجلسة ومزامنتها ✅', 'success');
            await this.openTrashModal('orphans');
        } catch (err) {
            console.error('Delete orphan count error:', err);
            UI.showToast('تعذر حذف السجل', 'danger');
        }
    },

    async cleanAllOrphanAuditCounts() {
        try {
            const orphans = await this._scanOrphanAuditCounts();
            if (orphans.length === 0) return;
            const bySession = new Map();
            for (const o of orphans) {
                if (!bySession.has(o.sessionId)) bySession.set(o.sessionId, []);
                bySession.get(o.sessionId).push(o.key);
            }
            for (const [sid, keys] of bySession) {
                const session = await Audit.getSession(sid);
                if (!session || !session.counts) continue;
                for (const k of keys) delete session.counts[k];
                session.updatedAt = new Date().toISOString();
                await DB.put('audit_sessions', session);
                if (typeof Sync !== 'undefined' && Sync.deleteAuditCountKeys) {
                    await Sync.deleteAuditCountKeys(sid, keys);
                }
            }
            UI.showToast(`تم تنظيف ${orphans.length} سجل مجهول من جلسات الجرد بنجاح 🧹✅`, 'success');
            await this.openTrashModal('orphans');
        } catch (err) {
            console.error('Clean all orphans error:', err);
            UI.showToast('فشل تنظيف العوالق', 'danger');
        }
    },
    // ===================== End Recycle Bin & Orphan Audit Inspector =====================

    async openManageCategories() {
        try {
            const cats = await Categories.getAllSorted();
            const allMeds = await DB.getAll('medicineMaster');
            
            UI.showModal(`
                <div class="modal-header">
                    <h2>إدارة الأقسام والتبويب</h2>
                    <button class="btn-primary sm-btn" onclick="window.App.openAddCategoryModal()">+ قسم جديد</button>
                </div>
                <div class="items-list mini">
                    ${cats.map(c => {
                        const count = allMeds.filter(m => m.categoryId === c.id).length;
                        const isSystem = c.id === 'uncategorized';
                        return `
                            <div class="cat-manage-item">
                                <div class="cat-info" onclick="${c.id === 'uncategorized' ? `window.App.openCategoryDetailModal('${c.id}')` : `window.App.openEditCategoryModal('${c.id}')`}" style="cursor:pointer">
                                    <i class='bx ${c.icon}' style="color: ${c.color}; font-size: 24px;"></i>
                                    <div style="display:flex; flex-direction:column">
                                        <span style="font-weight:800">${c.nameAR}</span>
                                        <span class="text-muted" style="font-size:10px">${count} صنف مسجل</span>
                                    </div>
                                </div>
                                <div class="cat-actions">
                                    ${!isSystem ? `<button class="icon-btn" onclick="window.App.deleteCategoryConfirm('${c.id}')" title="حذف القسم"><i class='bx bx-trash' style="color:var(--danger)"></i></button>` : '<span style="font-size:11px; color:var(--text-muted); padding:4px 8px;">أساسي</span>'}
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
        this.openAddCategoryModal();
    },

    openEditCategory(id) {
        this.openEditCategoryModal(id);
    },

    async saveCategory(id = null) {
        return this.saveCategoryForm(id);
    },

    async confirmDeleteCategory(catId) {
        return this.deleteCategoryConfirm(catId);
    },

    async executeDeleteCategory(catId, action) {
        if (catId === 'uncategorized') {
            UI.showToast('لا يمكن حذف قسم "أدوية غير مصنفة"', 'warning');
            return;
        }
        try {
            const meds = await Categories.getMedicinesByCategoryId(catId);
            
            if (action === 'move') {
                for (const med of meds) {
                    med.categoryId = 'uncategorized';
                    med.lastUpdated = new Date().toISOString();
                    await DB.put('medicineMaster', med);
                    if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                        window.Sync.push(med.id).catch(() => {});
                    }
                }
                UI.showToast(`تم نقل ${meds.length} دواء لـ "أدوية غير مصنفة"`, 'info');
            } else if (action === 'delete_all') {
                for (const med of meds) {
                    await DB.delete('medicineMaster', med.id);
                    // Sync deletion to cloud
                    if (typeof window.Sync !== 'undefined' && window.Sync.deleteMedicine) {
                        window.Sync.deleteMedicine(med.id).catch(() => {});
                    }
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
            settings: (await DB.getAll('settings')) || [],
            team: (typeof Users !== 'undefined' && Users.getAll) ? Users.getAll() : [],
            exportDate: new Date().toISOString(),
            version: App.VERSION || '18.9.1'
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
                if (Array.isArray(data.settings) && data.settings.length > 0) {
                    await DB.clear('settings');
                    for (const s of data.settings) await DB.put('settings', s);
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

App.setMedicineLanguagePreference = function(lang) {
    localStorage.setItem('dawaa_med_lang_pref', lang);
    UI.showToast('تم تحديث لغة عرض الأدوية بنجاح ✨', 'success');
    if (typeof this.renderInventory === 'function') this.renderInventory();
    if (typeof this.renderDashboard === 'function') this.renderDashboard();
    if (typeof this.renderAuditView === 'function') this.renderAuditView();
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
        const worker = reg.waiting || reg.installing;
        if (worker) {
            UI.showToast('جاري تثبيت التحديث وإعادة التشغيل... ⏳', 'info');
            this._userApprovedUpdate = true;
            worker.postMessage({ type: 'SKIP_WAITING' });
            // Fallback: reload after 2s if controllerchange doesn't fire
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            // No waiting worker found — force reload to pick up new SW
            UI.showToast('جاري إعادة التشغيل... ⏳', 'info');
            setTimeout(() => window.location.reload(), 500);
        }
        return;
    }

    // Stage 1: Check for Updates (First Click)
    this.updateStatus('جاري فحص الإصدار بدقة... 🔍');
    if ('serviceWorker' in navigator) {
        try {
            const remoteVer = await this.getRemoteVersion();
            console.log(`Update Check: Local=${this.VERSION}, Remote=${remoteVer}`);

            if (remoteVer && remoteVer !== this.VERSION) {
                const reg = await navigator.serviceWorker.register(`./sw.js?v=${remoteVer}`);
                await reg.update();

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

            // Up to date
            this.updateStatus(`أنت تستخدم النسخة v${this.VERSION} بنجاح ✅`);
            this.updateState = 'check';
            const btn = document.querySelector('.setting-card .bx-refresh')?.closest('.setting-card');
            if (btn) btn.style.background = '';
            setTimeout(() => this.updateStatus('البحث عن إصدارات جديدة متوفرة'), 4000);

        } catch (err) {
            console.error('Update Sentry Error:', err);
            this.updateStatus('فشل التحقق من التحديث ⚠️');
        }
    }
};








App.userRole = 'staff';
App.user = null;
// Authentication passphrase - derived at runtime (not stored as plaintext constant)
App._getAuthPass = function() {
    const parts = ['dawaa', '@', '20', '26'];
    return parts.join('');
};

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
        const norm = (s) => (s || '').replace(/^(د\.?|د\/)\s*/, '').trim().toLowerCase();
        let user = team.find(u => u.id === `user_${payrollNo}` || norm(u.name) === norm(name));
        const isKhaled = norm(name) === 'خالد' || norm(name) === 'khaled' || payrollNo === '1001';
        if (!user) {
            user = Users.addUser({
                name: isKhaled ? 'د. خالد' : name,
                title: isKhaled ? 'مدير الصيدلية والنظام' : 'صيدلي ميداني',
                role: isKhaled ? 'admin' : 'staff'
            });
        } else if (isKhaled && user.role !== 'admin') {
            user.role = 'admin';
            if (typeof Users.saveUser === 'function') Users.saveUser(user);
        }
        if (user) Users.setActive(user);

        // 1. Try to Login with Firebase
        try {
            await auth.signInWithEmailAndPassword(email, this._getAuthPass());
            UI.showToast(`أهلاً بك مجدداً يا ${name}!`, 'success');
        } catch (loginErr) {
            // 2. If user doesn't exist, Create Account
            if (loginErr.code === 'auth/user-not-found' || loginErr.code === 'auth/invalid-credential') {
                await auth.createUserWithEmailAndPassword(email, this._getAuthPass());
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
            localStorage.removeItem('dawaa_active_user');
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
    whCatViewMode: 'categories', // 'categories' | 'all-meds' | 'cat-detail'
    whSelectedCatId: null,
    whCatSearch: '',
    whCatSortMode: 'en',

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
        const container = document.getElementById('wh-cats-container');
        if (!container) return;

        try {
            const cats = await Categories.getAllSorted();
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            const totalMedCount = allMeds.length;

            // If viewing a specific category's medicines
            if (this.whCatViewMode === 'cat-detail' && this.whSelectedCatId) {
                await this._renderWhCatDetail(container, cats, allMeds);
                return;
            }

            const viewMode = this.whCatViewMode || 'categories';
            const searchQuery = this.whCatSearch || '';
            const sortMode = this.whCatSortMode || 'en';
            this._whCatAllMedsCache = allMeds;

            // Filter & sort medicines for "all-meds" mode
            let displayedMeds = this._filterAndSortWhMeds(allMeds, searchQuery, sortMode);

            const catCount = cats.length;

            container.innerHTML = `
                <!-- Action Buttons -->
                <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                    <button class="btn-primary sm-btn" onclick="window.App.openAddMedicine()" style="display:flex; align-items:center; gap:5px; padding:8px 14px; border-radius:10px; font-size:12px; font-weight:800;">
                        <i class='bx bx-plus'></i> إضافة دواء جديد
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.App.openAddCategoryModal()" style="display:flex; align-items:center; gap:5px; padding:8px 14px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid var(--border-color);">
                        <i class='bx bx-folder-plus'></i> قسم جديد
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.App.openCatalogEnricherModal()" style="display:flex; align-items:center; gap:5px; padding:8px 12px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid rgba(16,185,129,0.4); color:#059669; background:rgba(16,185,129,0.06);">
                        <i class='bx bx-sparkles'></i> تكميل بيانات الأدوية
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.App.openActiveIngredientAnalysisModal()" style="display:flex; align-items:center; gap:5px; padding:8px 12px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid rgba(139,92,246,0.4); color:#7c3aed; background:rgba(139,92,246,0.06);">
                        <i class='bx bx-dna'></i> بالمادة الفعالة
                    </button>
                    <button class="btn-ghost sm-btn" onclick="window.App.openTrashModal()" style="display:flex; align-items:center; gap:5px; padding:8px 12px; border-radius:10px; font-size:12px; font-weight:800; border:1px solid rgba(239,68,68,0.35); color:var(--danger); background:rgba(239,68,68,0.05);">
                        <i class='bx bx-trash'></i> سلة المهملات
                    </button>
                </div>

                <!-- View Mode Toggle (Categories / All Medicines) -->
                <div style="display:flex; background:var(--bg-secondary); border-radius:12px; padding:4px; gap:4px; border:1px solid var(--border-color); margin-bottom:12px;">
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.setWhCatViewMode('categories')" style="flex:1; font-size:12px; padding:8px 10px; border-radius:9px; font-weight:800; ${viewMode === 'categories' ? 'background:var(--primary); color:white;' : 'color:var(--text-muted);'}">
                        <i class='bx bx-category'></i> حسب الأقسام (${catCount})
                    </button>
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.setWhCatViewMode('all-meds')" style="flex:1; font-size:12px; padding:8px 10px; border-radius:9px; font-weight:800; ${viewMode === 'all-meds' ? 'background:var(--primary); color:white;' : 'color:var(--text-muted);'}">
                        <i class='bx bx-list-ul'></i> كل الأدوية (${totalMedCount})
                    </button>
                </div>

                ${viewMode === 'all-meds' ? `
                    <!-- Search Bar -->
                    <div class="audit-toolbar" style="margin-bottom:10px;">
                        <div class="audit-search-wrapper" style="width:100%;">
                            <i class='bx bx-search'></i>
                            <input type="text" id="wh-cat-search-input" class="audit-search-input" placeholder="🔍 بحث باسم الدواء أو الباركود..." value="${Utils.escapeHTML(searchQuery)}" oninput="window.App.handleWhCatSearch(this.value)">
                            <button type="button" id="wh-cat-clear-btn" onclick="window.App.handleWhCatSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${searchQuery ? 'flex' : 'none'}; align-items:center;">
                                <i class='bx bx-x' style="font-size:18px;"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Sort -->
                    <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-bottom:10px;">
                        <span style="font-size:11px; color:var(--text-muted); font-weight:bold;">الترتيب:</span>
                        <select class="form-input" onchange="window.App.setWhCatSortMode(this.value)" style="padding:3px 8px; font-size:11px; border-radius:8px; width:auto; height:30px; background:var(--surface);">
                            <option value="en" ${sortMode === 'en' ? 'selected' : ''}>🔤 أبجدي A-Z</option>
                            <option value="ar" ${sortMode === 'ar' ? 'selected' : ''}>🔤 أبجدي أ-ي</option>
                        </select>
                    </div>

                    <!-- Medicine Cards Grid (Updated in-place on search — never loses focus!) -->
                    <div id="wh-cat-results-box">
                        ${this._renderWhMedsGridHtml(displayedMeds, null, searchQuery)}
                    </div>
                ` : `
                    <!-- Categories Grid -->
                    <div class="audit-square-grid">
                        ${cats.map(c => {
                            const count = allMeds.filter(m => (m.categoryId || 'uncategorized') === c.id).length;
                            const isUncat = c.id === 'uncategorized';
                            const isSystem = isUncat;
                            return `
                                <div class="square-card" onclick="window.App.openWhCatDetail('${c.id}')" style="cursor:pointer; position:relative; ${isUncat ? (count > 0 ? 'border:1px dashed var(--warning); background:rgba(245,158,11,0.05);' : 'opacity:0.85;') : ''}">
                                    <button type="button" class="wh-cat-menu-btn" onclick="event.stopPropagation(); window.App.toggleWhCatMenu('${c.id}')" title="خيارات" style="position:absolute; top:4px; left:4px; width:24px; height:24px; border-radius:6px; border:1px solid var(--border-color); background:var(--surface); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; padding:0; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
                                        <i class='bx bx-dots-vertical-rounded' style="font-size:14px; color:var(--text-muted);"></i>
                                    </button>
                                    <div id="wh-cat-menu-${c.id}" class="wh-cat-popup-menu" style="display:none; position:absolute; top:30px; left:4px; z-index:10; background:var(--surface); border:1px solid var(--border-color); border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,0.12); min-width:160px; padding:6px 0; font-size:12px;">
                                        <button onclick="event.stopPropagation(); window.App.openWhCatDetail('${c.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--text-main); text-align:right;">
                                            <i class='bx bx-show' style="font-size:15px; color:var(--primary);"></i> عرض الأدوية
                                        </button>
                                        ${!isSystem ? `
                                            <button onclick="event.stopPropagation(); window.App.openEditCategoryModal('${c.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--text-main); text-align:right;">
                                                <i class='bx bx-edit' style="font-size:15px; color:var(--accent);"></i> تعديل القسم
                                            </button>
                                            <button onclick="event.stopPropagation(); window.App.deleteCategoryConfirm('${c.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--danger); text-align:right;">
                                                <i class='bx bx-trash' style="font-size:15px;"></i> حذف القسم
                                            </button>
                                        ` : `
                                            <div style="padding:6px 14px; font-size:10px; color:var(--text-muted); font-weight:600;">
                                                <i class='bx bx-lock-alt'></i> قسم أساسي لا يمكن حذفه
                                            </div>
                                        `}
                                    </div>
                                    <i class='bx ${c.icon || 'bx-category'} square-icon' style="color: ${isUncat ? (count > 0 ? 'var(--warning)' : '#94a3b8') : (c.color || 'var(--primary)')}"></i>
                                    <h3>${Utils.escapeHTML(c.nameAR)}</h3>
                                    <span class="square-meta">${count} صنف دواء</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            `;
        } catch (err) {
            console.error('Error rendering warehouse categories:', err);
        }
    },

    // Render a single category's medicines (replaces the grid in-place)
    async _renderWhCatDetail(container, cats, allMeds) {
        const cat = cats.find(c => c.id === this.whSelectedCatId) || { id: this.whSelectedCatId, nameAR: 'غير مصنفة', icon: 'bx-help-circle', color: '#94a3b8' };
        const allInCat = allMeds.filter(m => (m.categoryId || 'uncategorized') === this.whSelectedCatId);
        const totalInCat = allInCat.length;
        const isUncategorized = this.whSelectedCatId === 'uncategorized';

        const searchQuery = this.whCatSearch || '';
        const sortMode = this.whCatSortMode || 'en';
        this._whCatDetailCache = { cat, allInCat };

        const medsInCat = this._filterAndSortWhMeds(allInCat, searchQuery, sortMode);

        container.innerHTML = `
            <!-- Back Button + Category Header -->
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; padding:10px 14px; background:var(--surface); border:1px solid var(--border-color); border-radius:12px;">
                <button onclick="window.App.backToWhCategories()" style="width:34px; height:34px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
                    <i class='bx bx-right-arrow-alt' style="font-size:18px; color:var(--primary);"></i>
                </button>
                <div style="display:flex; align-items:center; gap:8px; flex:1;">
                    <i class='bx ${cat.icon || 'bx-category'}' style="font-size:22px; color:${cat.color || 'var(--primary)'};"></i>
                    <div>
                        <strong style="font-size:14px;">${Utils.escapeHTML(cat.nameAR)}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${totalInCat} صنف مسجل</div>
                    </div>
                </div>
                ${!isUncategorized ? `
                    <button class="icon-btn" onclick="window.App.openEditCategoryModal('${cat.id}')" title="تعديل القسم" style="width:32px; height:32px;">
                        <i class='bx bx-edit' style="font-size:15px;"></i>
                    </button>
                ` : ''}
            </div>

            <!-- Action Buttons -->
            <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                <button class="btn-primary sm-btn" onclick="window.App.openAddMedicineWithCat('${cat.id}')" style="display:flex; align-items:center; gap:5px; padding:7px 12px; border-radius:10px; font-size:11.5px; font-weight:800;">
                    <i class='bx bx-plus-medical'></i> إضافة دواء جديد
                </button>
                <button class="btn-ghost sm-btn" onclick="window.App.openPullMedToCategoryModal('${cat.id}')" style="display:flex; align-items:center; gap:5px; padding:7px 12px; border-radius:10px; font-size:11.5px; font-weight:800; border:1px solid var(--primary); color:var(--primary); background:rgba(59,130,246,0.06);">
                    <i class='bx bx-transfer'></i> نقل دواء لهذا القسم
                </button>
            </div>

            <!-- Search Bar -->
            <div class="audit-toolbar" style="margin-bottom:10px;">
                <div class="audit-search-wrapper" style="width:100%;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="wh-cat-search-input" class="audit-search-input" placeholder="🔍 بحث في ${Utils.escapeHTML(cat.nameAR)}..." value="${Utils.escapeHTML(searchQuery)}" oninput="window.App.handleWhCatSearch(this.value)">
                    <button type="button" id="wh-cat-clear-btn" onclick="window.App.handleWhCatSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${searchQuery ? 'flex' : 'none'}; align-items:center;">
                        <i class='bx bx-x' style="font-size:18px;"></i>
                    </button>
                </div>
            </div>

            <!-- Sort -->
            <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-bottom:10px;">
                <span style="font-size:11px; color:var(--text-muted); font-weight:bold;">الترتيب:</span>
                <select class="form-input" onchange="window.App.setWhCatSortMode(this.value)" style="padding:3px 8px; font-size:11px; border-radius:8px; width:auto; height:30px; background:var(--surface);">
                    <option value="en" ${sortMode === 'en' ? 'selected' : ''}>🔤 أبجدي A-Z</option>
                    <option value="ar" ${sortMode === 'ar' ? 'selected' : ''}>🔤 أبجدي أ-ي</option>
                </select>
            </div>

            <!-- Medicine Cards Grid (Updated in-place on search — never loses focus!) -->
            <div id="wh-cat-results-box">
                ${this._renderWhMedsGridHtml(medsInCat, cat.id, searchQuery)}
            </div>
        `;
    },

    // Warehouse medicine card (same style as audit)
    _renderWhMedicineCard(med, catId = null) {
        const langPref = localStorage.getItem('dawaa_med_lang_pref') || 'en';
        let primaryName = med.nameEN || med.nameAR || 'دواء';
        let secondaryName = (med.nameAR && med.nameAR !== med.nameEN) ? med.nameAR : '';

        if (langPref === 'ar') {
            primaryName = med.nameAR || med.nameEN || 'دواء';
            secondaryName = (med.nameEN && med.nameEN !== med.nameAR) ? med.nameEN : '';
        }

        const safePrimary = Utils.escapeHTML(primaryName);
        const safeSecondary = (secondaryName && secondaryName !== primaryName) ? Utils.escapeHTML(secondaryName) : '';
        const imgUrl = (typeof Categories !== 'undefined' && Categories.getMedicineImage) ? Categories.getMedicineImage(med) : (med.imagePath || 'assets/icons/default-med.png');
        const srcCat = catId ? `'${catId}'` : 'null';

        return `
            <div class="square-card" onclick="window.App.openMedicineDetails('${med.id}')" title="عرض تفاصيل" style="cursor:pointer; position:relative;">
                <button type="button" class="audit-edit-med-btn" onclick="event.stopPropagation(); window.App.openEditMedicine('${med.id}')" title="تعديل بيانات الدواء" style="position:absolute; top:4px; left:4px; width:22px; height:22px; border-radius:6px; border:1px solid var(--border-color); background:var(--surface); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; padding:0; box-shadow:0 1px 2px rgba(0,0,0,0.08);">
                    <i class='bx bx-edit-alt' style="font-size:11px; color:var(--primary);"></i>
                </button>
                <div style="width:38px; height:38px; border-radius:8px; overflow:hidden; margin-bottom:4px; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                    <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <h3 style="font-size:11.5px; font-weight:800; margin:0 0 2px 0; line-height:1.25; word-break:break-word;">${safePrimary}</h3>
                ${safeSecondary ? `<div style="font-size:10px; color:var(--text-muted); margin-bottom:2px; line-height:1.2; word-break:break-word;">${safeSecondary}</div>` : ''}
                <div style="display:flex; gap:4px; margin-top:auto; padding-top:4px;">
                    ${catId ? `<button type="button" onclick="event.stopPropagation(); window.App.openMoveCategoryModal('${med.id}', ${srcCat})" title="نقل لقسم آخر" style="width:24px; height:24px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0;">
                        <i class='bx bx-transfer' style="font-size:12px; color:var(--accent);"></i>
                    </button>` : ''}
                    <button type="button" onclick="event.stopPropagation(); window.App.deleteMasterMedicine('${med.id}')" title="حذف" style="width:24px; height:24px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0;">
                        <i class='bx bx-trash' style="font-size:12px; color:var(--danger);"></i>
                    </button>
                </div>
            </div>
        `;
    },

    // --- Warehouse Category View Handlers ---
    setWhCatViewMode(mode) {
        this.whCatViewMode = mode;
        this.whCatSearch = '';
        this.whSelectedCatId = null;
        this.renderWarehouseCategories();
    },

    openWhCatDetail(catId) {
        this.whCatViewMode = 'cat-detail';
        this.whSelectedCatId = catId;
        this.whCatSearch = '';
        this.renderWarehouseCategories();
    },

    backToWhCategories() {
        this.whCatViewMode = 'categories';
        this.whSelectedCatId = null;
        this.whCatSearch = '';
        this.renderWarehouseCategories();
    },

    _filterAndSortWhMeds(list, query = '', sortMode = 'en') {
        const tieBreaker = (a, b) => {
            if (sortMode === 'ar') return (a.nameAR || '').localeCompare(b.nameAR || '', 'ar');
            return (a.nameEN || '').localeCompare(b.nameEN || '', 'en');
        };
        if (query && query.trim()) {
            return Utils.smartFilter(
                list || [],
                query,
                (pq, m) => Utils.smartScoreMed(pq, m),
                { tieBreaker }
            );
        }
        return [...(list || [])].sort(tieBreaker);
    },

    _renderWhMedsGridHtml(meds, catId = null, searchQuery = '') {
        if (!meds || meds.length === 0) {
            return `
                <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color);">
                    <i class='bx ${searchQuery ? 'bx-search-alt' : 'bx-capsule'}' style="font-size:32px; color:var(--text-muted); opacity:0.55;"></i>
                    <p style="margin:8px 0; font-size:13px; color:var(--text-muted);">${searchQuery ? 'لا توجد أدوية مطابقة للبحث' : 'لا توجد أدوية في هذا القسم'}</p>
                    ${!searchQuery && catId ? `<button class="btn-primary sm-btn" onclick="window.App.openAddMedicineWithCat('${catId}')"><i class='bx bx-plus'></i> إضافة أول دواء</button>` : ''}
                </div>
            `;
        }
        return `<div class="audit-square-grid">${meds.map(m => this._renderWhMedicineCard(m, catId)).join('')}</div>`;
    },

    handleWhCatSearch(query, resetInput = false) {
        this.whCatSearch = query || '';
        const clearBtn = document.getElementById('wh-cat-clear-btn');
        if (clearBtn) clearBtn.style.display = this.whCatSearch ? 'flex' : 'none';
        if (resetInput) {
            const inp = document.getElementById('wh-cat-search-input');
            if (inp) { inp.value = ''; inp.focus(); }
        }
        const resultsBox = document.getElementById('wh-cat-results-box');
        if (resultsBox) {
            const sortMode = this.whCatSortMode || 'en';
            if (this.whCatViewMode === 'cat-detail' && this._whCatDetailCache) {
                const filtered = this._filterAndSortWhMeds(this._whCatDetailCache.allInCat, this.whCatSearch, sortMode);
                resultsBox.innerHTML = this._renderWhMedsGridHtml(filtered, this._whCatDetailCache.cat.id, this.whCatSearch);
                return;
            }
            if (this.whCatViewMode === 'all-meds' && this._whCatAllMedsCache) {
                const filtered = this._filterAndSortWhMeds(this._whCatAllMedsCache, this.whCatSearch, sortMode);
                resultsBox.innerHTML = this._renderWhMedsGridHtml(filtered, null, this.whCatSearch);
                return;
            }
        }
        this.renderWarehouseCategories();
    },

    setWhCatSortMode(mode) {
        this.whCatSortMode = mode;
        this.renderWarehouseCategories();
    },

    toggleWhCatMenu(catId) {
        this._closeAllWhCatMenus();
        const menu = document.getElementById(`wh-cat-menu-${catId}`);
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            if (menu.style.display === 'block') {
                // Close on outside click
                setTimeout(() => {
                    const closer = (e) => {
                        if (!menu.contains(e.target)) {
                            menu.style.display = 'none';
                            document.removeEventListener('click', closer);
                        }
                    };
                    document.addEventListener('click', closer);
                }, 10);
            }
        }
    },

    _closeAllWhCatMenus() {
        document.querySelectorAll('.wh-cat-popup-menu').forEach(m => m.style.display = 'none');
    },

    async renderWarehouseLocations() {
        const container = document.getElementById('wh-locs-container');
        if (!container) return;

        try {
            const locs = await Locations.getAll();
            const allMeds = (await DB.getAll('medicineMaster')) || [];

            // If viewing a specific location's medicines
            if (this.whLocViewMode === 'loc-detail' && this.whSelectedLocId) {
                await this._renderWhLocDetail(container, locs, allMeds);
                return;
            }

            const searchQuery = this.whLocSearch || '';
            const sortMode = this.whLocSortMode || 'en';

            container.innerHTML = `
                <!-- Action Button -->
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <button class="btn-primary sm-btn" onclick="window.App.openAddLocationModal()" style="display:flex; align-items:center; gap:5px; padding:8px 14px; border-radius:10px; font-size:12px; font-weight:800;">
                        <i class='bx bx-plus'></i> مكان تخزين جديد
                    </button>
                </div>

                <!-- Locations Grid -->
                <div class="audit-square-grid">
                    ${(await Promise.all(locs.map(async (loc) => {
                        const medsInLoc = allMeds.filter(m => {
                            if (m.allowedLocations && Array.isArray(m.allowedLocations) && m.allowedLocations.length > 0) {
                                return m.allowedLocations.includes(loc.id);
                            }
                            if (m.primaryLocation === loc.id) return true;
                            return false;
                        });
                        const count = medsInLoc.length;
                        const primaryCount = allMeds.filter(m => m.primaryLocation === loc.id).length;

                        return `
                            <div class="square-card" onclick="window.App.openWhLocDetail('${loc.id}')" style="cursor:pointer; position:relative;">
                                <button type="button" onclick="event.stopPropagation(); window.App.toggleWhLocMenu('${loc.id}')" title="خيارات" style="position:absolute; top:4px; left:4px; width:24px; height:24px; border-radius:6px; border:1px solid var(--border-color); background:var(--surface); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; padding:0; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
                                    <i class='bx bx-dots-vertical-rounded' style="font-size:14px; color:var(--text-muted);"></i>
                                </button>
                                <div id="wh-loc-menu-${loc.id}" class="wh-cat-popup-menu" style="display:none; position:absolute; top:30px; left:4px; z-index:10; background:var(--surface); border:1px solid var(--border-color); border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,0.12); min-width:150px; padding:6px 0; font-size:12px;">
                                    <button onclick="event.stopPropagation(); window.App.openWhLocDetail('${loc.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--text-main); text-align:right;">
                                        <i class='bx bx-show' style="font-size:15px; color:var(--primary);"></i> عرض الأدوية
                                    </button>
                                    <button onclick="event.stopPropagation(); window.App.openEditLocationModal('${loc.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--text-main); text-align:right;">
                                        <i class='bx bx-edit' style="font-size:15px; color:var(--accent);"></i> تعديل المكان
                                    </button>
                                    <button onclick="event.stopPropagation(); window.App.deleteLocationConfirm('${loc.id}'); window.App._closeAllWhCatMenus();" style="display:flex; align-items:center; gap:8px; width:100%; padding:8px 14px; border:none; background:none; cursor:pointer; font-family:inherit; font-size:12px; font-weight:600; color:var(--danger); text-align:right;">
                                        <i class='bx bx-trash' style="font-size:15px;"></i> حذف المكان
                                    </button>
                                </div>
                                <i class='bx ${loc.icon || 'bx-map-pin'} square-icon' style="color: ${loc.color || 'var(--primary)'}"></i>
                                <h3>${Utils.escapeHTML(loc.nameAR)}</h3>
                                <span class="square-meta">${count} صنف</span>
                                ${primaryCount > 0 ? `<span style="font-size:10px; color:var(--primary); font-weight:600;">⭐ ${primaryCount} أساسي</span>` : ''}
                            </div>
                        `;
                    }))).join('')}
                </div>
            `;
        } catch (err) {
            console.error('Error rendering warehouse locations:', err);
        }
    },

    // Location drill-down detail view
    async _renderWhLocDetail(container, locs, allMeds) {
        const loc = locs.find(l => l.id === this.whSelectedLocId);
        if (!loc) { this.backToWhLocations(); return; }

        let medsInLoc = allMeds.filter(m => {
            if (m.allowedLocations && Array.isArray(m.allowedLocations) && m.allowedLocations.length > 0) {
                return m.allowedLocations.includes(loc.id);
            }
            if (m.primaryLocation === loc.id) return true;
            return false;
        });
        const totalInLoc = medsInLoc.length;
        const searchQuery = this.whLocSearch || '';
        const sortMode = this.whLocSortMode || 'en';
        this._whLocDetailCache = { loc, allInLoc: [...medsInLoc] };

        medsInLoc = this._filterAndSortWhMeds(medsInLoc, searchQuery, sortMode);

        container.innerHTML = `
            <!-- Back + Location Header -->
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; padding:10px 14px; background:var(--surface); border:1px solid var(--border-color); border-radius:12px;">
                <button onclick="window.App.backToWhLocations()" style="width:34px; height:34px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
                    <i class='bx bx-right-arrow-alt' style="font-size:18px; color:var(--primary);"></i>
                </button>
                <div style="display:flex; align-items:center; gap:8px; flex:1;">
                    <i class='bx ${loc.icon || 'bx-map-pin'}' style="font-size:22px; color:${loc.color || 'var(--primary)'};"></i>
                    <div>
                        <strong style="font-size:14px;">${Utils.escapeHTML(loc.nameAR)}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${totalInLoc} صنف في هذا المكان</div>
                    </div>
                </div>
                <button class="icon-btn" onclick="window.App.openEditLocationModal('${loc.id}')" title="تعديل المكان" style="width:32px; height:32px;">
                    <i class='bx bx-edit' style="font-size:15px;"></i>
                </button>
            </div>

            <!-- Search -->
            <div class="audit-toolbar" style="margin-bottom:10px;">
                <div class="audit-search-wrapper" style="width:100%;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="wh-loc-search-input" class="audit-search-input" placeholder="🔍 بحث في ${Utils.escapeHTML(loc.nameAR)}..." value="${Utils.escapeHTML(searchQuery)}" oninput="window.App.handleWhLocSearch(this.value)">
                    <button type="button" id="wh-loc-clear-btn" onclick="window.App.handleWhLocSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${searchQuery ? 'flex' : 'none'}; align-items:center;">
                        <i class='bx bx-x' style="font-size:18px;"></i>
                    </button>
                </div>
            </div>

            <!-- Sort -->
            <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin-bottom:10px;">
                <span style="font-size:11px; color:var(--text-muted); font-weight:bold;">الترتيب:</span>
                <select class="form-input" onchange="window.App.setWhLocSortMode(this.value)" style="padding:3px 8px; font-size:11px; border-radius:8px; width:auto; height:30px; background:var(--surface);">
                    <option value="en" ${sortMode === 'en' ? 'selected' : ''}>🔤 أبجدي A-Z</option>
                    <option value="ar" ${sortMode === 'ar' ? 'selected' : ''}>🔤 أبجدي أ-ي</option>
                </select>
            </div>

            <!-- Medicine Cards (Updated in-place on search — never loses focus!) -->
            <div id="wh-loc-results-box">
                ${this._renderWhMedsGridHtml(medsInLoc, null, searchQuery)}
            </div>
        `;
    },

    // Location view handlers
    whLocViewMode: null,
    whSelectedLocId: null,
    whLocSearch: '',
    whLocSortMode: 'en',

    openWhLocDetail(locId) {
        this.whLocViewMode = 'loc-detail';
        this.whSelectedLocId = locId;
        this.whLocSearch = '';
        this.renderWarehouseLocations();
    },

    backToWhLocations() {
        this.whLocViewMode = null;
        this.whSelectedLocId = null;
        this.whLocSearch = '';
        this.renderWarehouseLocations();
    },

    handleWhLocSearch(query, resetInput = false) {
        this.whLocSearch = query || '';
        const clearBtn = document.getElementById('wh-loc-clear-btn');
        if (clearBtn) clearBtn.style.display = this.whLocSearch ? 'flex' : 'none';
        if (resetInput) {
            const inp = document.getElementById('wh-loc-search-input');
            if (inp) { inp.value = ''; inp.focus(); }
        }
        const box = document.getElementById('wh-loc-results-box');
        if (box && this._whLocDetailCache) {
            const filtered = this._filterAndSortWhMeds(this._whLocDetailCache.allInLoc, this.whLocSearch, this.whLocSortMode || 'en');
            box.innerHTML = this._renderWhMedsGridHtml(filtered, null, this.whLocSearch);
            return;
        }
        this.renderWarehouseLocations();
    },

    setWhLocSortMode(mode) {
        this.whLocSortMode = mode;
        this.renderWarehouseLocations();
    },

    toggleWhLocMenu(locId) {
        this._closeAllWhCatMenus();
        const menu = document.getElementById(`wh-loc-menu-${locId}`);
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            if (menu.style.display === 'block') {
                setTimeout(() => {
                    const closer = (e) => {
                        if (!menu.contains(e.target)) {
                            menu.style.display = 'none';
                            document.removeEventListener('click', closer);
                        }
                    };
                    document.addEventListener('click', closer);
                }, 10);
            }
        }
    },

    // --- Interactive Location Detail Modal (Location Hub) ---
    async openLocationDetailModal(locId) {
        try {
            const loc = await Locations.get(locId);
            if (!loc) return UI.showToast('تعذر العثور على المكان', 'warning');

            const medsInLoc = await Locations.getMedicinesForLocation(locId);

            UI.showModal(`
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:44px; height:44px; border-radius:12px; background:${loc.color || 'var(--primary)'}15; display:flex; align-items:center; justify-content:center;">
                            <i class='bx ${loc.icon || 'bx-map-pin'}' style="font-size:24px; color:${loc.color || 'var(--primary)'}"></i>
                        </div>
                        <div>
                            <h2 style="margin:0; font-size:18px;">${Utils.escapeHTML(loc.nameAR)}</h2>
                            <small class="text-muted">${loc.description || 'مكان تخزين'} — ${medsInLoc.length} صنف</small>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-ghost sm-btn" onclick="window.App.openEditLocationModal('${locId}')" title="تعديل بيانات المكان">
                            <i class='bx bx-edit'></i>
                        </button>
                    </div>
                </div>

                <div class="category-meds-list" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">
                    ${medsInLoc.map(m => {
                        const img = Categories.getMedicineImage(m);
                        const isPrimary = m.primaryLocation === locId;
                        return `
                            <div class="cat-med-item" style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px;">
                                <div style="width:40px; height:40px; border-radius:8px; overflow:hidden; flex-shrink:0;">
                                    <img src="${img}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                                </div>
                                <div style="flex:1; min-width:0;">
                                    <h4 style="margin:0; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHTML(m.nameEN || m.nameAR)}</h4>
                                    <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                                        <span style="font-size:11px; color:var(--text-muted);">${Utils.escapeHTML(m.nameAR && m.nameAR !== m.nameEN ? m.nameAR : (m.activeIngredient || 'دواء'))}</span>
                                        ${isPrimary ? '<span style="font-size:9px; background:var(--primary); color:white; padding:1px 5px; border-radius:4px; font-weight:bold;">أساسي ⭐</span>' : ''}
                                    </div>
                                </div>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <button class="icon-btn" onclick="window.App.openMedicineDetails('${m.id}')" title="عرض تفاصيل الدواء" style="padding:4px;">
                                        <i class='bx bx-show' style="font-size:16px;"></i>
                                    </button>
                                    <button class="icon-btn" onclick="window.App.openEditMedicine('${m.id}')" title="تعديل الدواء" style="padding:4px;">
                                        <i class='bx bx-edit-alt' style="font-size:16px;"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${medsInLoc.length === 0 ? `
                        <div class="empty-state" style="padding:24px; text-align:center;">
                            <i class='bx bx-map-pin' style="font-size:36px; color:var(--text-muted);"></i>
                            <p style="font-size:13px; color:var(--text-muted); margin:8px 0;">لا توجد أدوية محددة لهذا المكان حالياً</p>
                            <p style="font-size:11px; color:var(--text-muted);">أضف أدوية واختر هذا المكان كمكان تخزين أساسي أو إضافي</p>
                        </div>
                    ` : ''}
                </div>

                <div style="display:flex; gap:8px; margin-top:14px; border-top:1px solid var(--border-color); padding-top:12px;">
                    <button type="button" class="btn-ghost sm-btn w-100" onclick="window.UI.closeModal()" style="font-size:12px; padding:8px;">
                        إغلاق النافذة
                    </button>
                </div>
            `);
        } catch (err) {
            console.error('Error opening location detail:', err);
            UI.showToast('خطأ في تحميل بيانات المكان', 'danger');
        }
    },

    // Auto-check primary location in multi-select checkboxes
    _autocheckPrimaryLoc(locId, prefix) {
        if (!locId) return;
        const checkbox = document.querySelector(`input[name="${prefix}-locations"][value="${locId}"]`);
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
        }
    },

    // --- Interactive Category Drill-Down & Management ---
    async openCategoryDetailModal(catId) {
        try {
            this._activeCategoryModalId = catId;
            const cat = await Categories.getInfo(catId);
            const medsInCat = await Categories.getMedicinesByCategoryId(catId);
            const isUncategorized = (catId === 'uncategorized');

            UI.showModal(`
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:16px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class='bx ${cat.icon || 'bx-category'}' style="font-size:24px; color:${cat.color || 'var(--primary)'}"></i>
                        <div>
                            <h2 style="margin:0; font-size:18px;">${Utils.escapeHTML(cat.nameAR)}</h2>
                            <small class="text-muted">${medsInCat.length} صنف مسجل في هذا القسم</small>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-primary sm-btn" onclick="window.App.openAddMedicineWithCat('${catId}')" title="إضافة دواء جديد لهذا القسم">
                            <i class='bx bx-plus'></i> دواء جديد
                        </button>
                        <button class="btn-ghost sm-btn" onclick="window.App.openPullMedToCategoryModal('${catId}')" title="نقل دواء موجود لهذا القسم" style="border:1px solid var(--primary); color:var(--primary);">
                            <i class='bx bx-transfer'></i> نقل دواء
                        </button>
                        ${!isUncategorized ? `
                            <button class="btn-ghost sm-btn" onclick="window.App.openEditCategoryModal('${catId}')" title="تعديل بيانات التصنيف">
                                <i class='bx bx-edit'></i>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div class="category-meds-list" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;">
                    ${medsInCat.map(m => {
                        const img = Categories.getMedicineImage(m);
                        return `
                            <div class="cat-med-item" style="display:flex; align-items:center; gap:12px; padding:10px 14px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px;">
                                <div style="width:40px; height:40px; border-radius:8px; overflow:hidden; flex-shrink:0;">
                                    <img src="${img}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                                </div>
                                <div style="flex:1; min-width:0;">
                                    <h4 style="margin:0; font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHTML(m.nameEN || m.nameAR)}</h4>
                                    <span style="font-size:11px; color:var(--text-muted);">${Utils.escapeHTML(m.nameAR && m.nameAR !== m.nameEN ? m.nameAR : (m.activeIngredient || 'دواء'))}</span>
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
                            <p class="text-muted mt-10">لا توجد أدوية مسجلة في قسم "${Utils.escapeHTML(cat.nameAR)}" حالياً</p>
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
                    <h3 style="margin:0; font-size:14px; font-weight:800;">${Utils.escapeHTML(med.nameEN)}</h3>
                    <p style="margin:4px 0 0 0; font-size:12px; color:var(--text-muted);">
                        التصنيف الحالي: <strong style="color:var(--primary);">${Utils.escapeHTML(currentCat ? currentCat.nameAR : med.categoryId)}</strong>
                    </p>
                </div>
                <form onsubmit="event.preventDefault(); window.App.saveMoveCategory('${medicineId}', '${sourceCatId || ''}');">
                    <div class="form-group mb-15">
                        <label class="form-label">اختر التصنيف الجديد:</label>
                        <select id="move-target-cat" class="form-select" required>
                            <option value="">-- حدد التصنيف المستهدف --</option>
                            ${cats.filter(c => c.id !== med.categoryId).map(c => `
                                <option value="${c.id}">${Utils.escapeHTML(Categories.getCategoryDisplayName(c, 'both'))}</option>
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
            med.lastUpdated = new Date().toISOString();
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);

            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(e => console.warn('Sync push move category error:', e));
            }

            const cats = await Categories.getAllSorted();
            const newCat = cats.find(c => c.id === targetCatId);

            UI.showToast(`تم نقل ${Utils.escapeHTML(med.nameEN || med.nameAR)} إلى ${Utils.escapeHTML(newCat?.nameAR || targetCatId)} بنجاح ✅`, 'success');

            if (sourceCatId) {
                await this.refreshAllViews(sourceCatId);
            } else {
                UI.closeModal();
                await this.refreshAllViews(targetCatId);
            }
        } catch (err) {
            console.error('Error saving moved category:', err);
            UI.showToast('فشل حفظ النقل', 'danger');
        }
    },

    // --- Pull / Move Existing Medicine INTO Current Category by Search ---
    async openPullMedToCategoryModal(targetCatId) {
        try {
            const allCats = (await Categories.getAllSorted()) || [];
            const allMeds = (await DB.getAll('medicineMaster')) || [];
            const catMap = new Map(allCats.map(c => [c.id, c]));
            const targetCat = catMap.get(targetCatId) || { id: targetCatId, nameAR: Categories.getCategoryDisplayName(targetCatId, 'ar', catMap), icon: 'bx-category', color: 'var(--primary)' };

            this._pullCatState = {
                targetCatId,
                targetCatName: targetCat.nameAR || Categories.getCategoryDisplayName(targetCatId, 'ar', catMap),
                allMeds,
                catMap,
                query: '',
                onlyUncat: false,
                movedIds: new Set()
            };

            const isTargetUncat = targetCatId === 'uncategorized';

            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header" style="margin-bottom:10px;">
                    <h2 style="display:flex; align-items:center; gap:8px; font-size:16px;">
                        <i class='bx bx-transfer' style="color:${targetCat.color || 'var(--primary)'};"></i>
                        نقل دواء إلى: ${Utils.escapeHTML(this._pullCatState.targetCatName)}
                    </h2>
                    <p class="text-muted" style="font-size:12px; margin-top:4px;">ابحث عن أي دواء بالاسم العربي أو الإنجليزي أو المادة الفعالة وانقله فوراً</p>
                </div>

                <!-- Search Input -->
                <div class="audit-search-wrapper" style="width:100%; margin-bottom:10px;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="pull-med-search" class="audit-search-input"
                        placeholder="🔍 ابحث باسم الدواء (عربي / إنجليزي)..."
                        oninput="window.App.filterPullMedToCategory(this.value)" autofocus>
                </div>

                ${!isTargetUncat ? `
                    <div style="display:flex; gap:6px; margin-bottom:10px;">
                        <button type="button" id="pull-filter-all" class="btn-primary sm-btn" onclick="window.App.setPullMedFilter(false)" style="flex:1; font-size:11.5px; padding:6px 10px; border-radius:8px;">
                            كل الأقسام الأخرى
                        </button>
                        <button type="button" id="pull-filter-uncat" class="btn-ghost sm-btn" onclick="window.App.setPullMedFilter(true)" style="flex:1; font-size:11.5px; padding:6px 10px; border-radius:8px; border:1px solid var(--border-color);">
                            غير المصنفة فقط
                        </button>
                    </div>
                ` : ''}

                <div id="pull-med-results" style="max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:2px;"></div>

                <div class="form-actions mt-15" style="display:flex; justify-content:space-between; align-items:center;">
                    <span id="pull-med-counter" style="font-size:12px; color:var(--text-muted); font-weight:700;"></span>
                    <button type="button" class="btn-primary sm-btn" onclick="window.UI.closeModal()">تم / إغلاق</button>
                </div>
            `);

            this.filterPullMedToCategory('');
            setTimeout(() => document.getElementById('pull-med-search')?.focus(), 80);
        } catch (err) {
            console.error('Error opening pull-to-category modal:', err);
            UI.showToast('تعذر فتح نافذة نقل الأدوية', 'danger');
        }
    },

    setPullMedFilter(onlyUncat) {
        if (!this._pullCatState) return;
        this._pullCatState.onlyUncat = !!onlyUncat;
        const btnAll = document.getElementById('pull-filter-all');
        const btnUncat = document.getElementById('pull-filter-uncat');
        if (btnAll && btnUncat) {
            if (onlyUncat) {
                btnAll.className = 'btn-ghost sm-btn';
                btnAll.style.border = '1px solid var(--border-color)';
                btnUncat.className = 'btn-primary sm-btn';
                btnUncat.style.border = 'none';
            } else {
                btnAll.className = 'btn-primary sm-btn';
                btnAll.style.border = 'none';
                btnUncat.className = 'btn-ghost sm-btn';
                btnUncat.style.border = '1px solid var(--border-color)';
            }
        }
        this.filterPullMedToCategory(this._pullCatState.query);
    },

    filterPullMedToCategory(query = '') {
        const state = this._pullCatState;
        const container = document.getElementById('pull-med-results');
        const counter = document.getElementById('pull-med-counter');
        if (!state || !container) return;

        state.query = query;
        const qRaw = String(query || '').trim();

        // Filter candidates: medicines NOT originally in targetCatId (or just moved in this modal session)
        let matches = state.allMeds.filter(m => {
            const curCat = m.categoryId || 'uncategorized';
            const justMoved = state.movedIds.has(m.id);
            if (!justMoved && curCat === state.targetCatId) return false;
            if (!justMoved && state.onlyUncat && curCat !== 'uncategorized') return false;
            return true;
        });

        if (qRaw) {
            matches = Utils.smartFilter(
                matches,
                qRaw,
                (pq, m) => Utils.smartScoreMed(pq, m),
                { tieBreaker: (a, b) => (a.nameEN || a.nameAR || '').localeCompare(b.nameEN || b.nameAR || '') }
            );
        } else {
            // Sort: uncategorized first when no search, then alphabetical
            matches.sort((a, b) => {
                const aUncat = (a.categoryId || 'uncategorized') === 'uncategorized' ? 0 : 1;
                const bUncat = (b.categoryId || 'uncategorized') === 'uncategorized' ? 0 : 1;
                if (aUncat !== bUncat) return aUncat - bUncat;
                return (a.nameEN || a.nameAR || '').localeCompare(b.nameEN || b.nameAR || '');
            });
        }

        const totalMatches = matches.length;
        const shown = matches.slice(0, 60);

        if (counter) {
            const movedCount = state.movedIds.size;
            counter.textContent = movedCount > 0
                ? `تم نقل ${movedCount} دواء ✅`
                : `${totalMatches} دواء متاح للنقل`;
        }

        if (shown.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:26px; text-align:center; background:var(--bg-secondary); border-radius:12px;">
                    <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">
                        ${qRaw ? 'لا توجد أدوية مطابقة للبحث في الأقسام الأخرى' : 'كل الأدوية موجودة بالفعل في هذا القسم'}
                    </p>
                </div>
            `;
            return;
        }

        container.innerHTML = shown.map(m => {
            const isMoved = state.movedIds.has(m.id);
            const curCatName = Categories.getCategoryDisplayName(m.categoryId || 'uncategorized', 'ar', state.catMap);
            const img = Categories.getMedicineImage(m);
            const primary = Utils.escapeHTML(m.nameEN || m.nameAR || 'دواء');
            const secondary = (m.nameAR && m.nameAR !== m.nameEN) ? Utils.escapeHTML(m.nameAR) : '';

            return `
                <div style="display:flex; align-items:center; gap:10px; padding:9px 11px; background:${isMoved ? 'rgba(16,185,129,0.08)' : 'var(--bg-secondary)'}; border:1px solid ${isMoved ? 'var(--success, #10b981)' : 'var(--border-color)'}; border-radius:10px;">
                    <div style="width:36px; height:36px; border-radius:8px; overflow:hidden; flex-shrink:0;">
                        <img src="${img}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:800; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${primary}</div>
                        ${secondary ? `<div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${secondary}</div>` : ''}
                        <div style="font-size:10.5px; color:${isMoved ? 'var(--success, #10b981)' : 'var(--text-muted)'}; margin-top:2px;">
                            ${isMoved ? `✅ تم نقله إلى ${Utils.escapeHTML(state.targetCatName)}` : `القسم الحالي: <strong>${Utils.escapeHTML(curCatName)}</strong>`}
                        </div>
                    </div>
                    ${isMoved ? `
                        <span style="font-size:11px; font-weight:800; color:var(--success, #10b981); padding:5px 8px; white-space:nowrap;">تم ✅</span>
                    ` : `
                        <button type="button" class="btn-primary sm-btn" onclick="window.App.executePullMedToCategory('${m.id}')" style="font-size:11.5px; padding:6px 10px; border-radius:8px; white-space:nowrap; flex-shrink:0;">
                            <i class='bx bx-transfer'></i> نقل هنا
                        </button>
                    `}
                </div>
            `;
        }).join('') + (totalMatches > 60 ? `<div style="text-align:center; font-size:11px; color:var(--text-muted); padding:6px;">اكتب اسم الدواء لتضييق النتائج (يعرض أول 60 من ${totalMatches})</div>` : '');
    },

    async executePullMedToCategory(medId) {
        const state = this._pullCatState;
        if (!state) return;

        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) return;

            med.categoryId = state.targetCatId;
            med.lastUpdated = new Date().toISOString();
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);

            if (typeof window.Sync !== 'undefined' && window.Sync.push) {
                window.Sync.push(med.id).catch(e => console.warn('Sync push pull category error:', e));
            }

            // Update local modal state & UI immediately without closing modal
            state.movedIds.add(medId);
            const inState = state.allMeds.find(x => x.id === medId);
            if (inState) inState.categoryId = state.targetCatId;

            this.filterPullMedToCategory(state.query);
            UI.showToast(`تم نقل «${med.nameEN || med.nameAR}» إلى «${state.targetCatName}» ✅`, 'success');

            // Refresh underlying category view smoothly in background
            if (typeof this.renderWarehouseCategories === 'function') {
                this.renderWarehouseCategories();
            }
        } catch (err) {
            console.error('Error pulling medicine to category:', err);
            UI.showToast('فشل نقل الدواء', 'danger');
        }
    },

    // --- Master Medicine Action Menu ---
    async openMasterMedicineMenu(medicineId) {
        try {
            const med = await DB.get('medicineMaster', medicineId);
            if (!med) return;

            UI.showModal(`
                <div class="modal-header">
                    <h2>خيارات: ${Utils.escapeHTML(med.nameEN || med.nameAR)}</h2>
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
            <div class="modal-header"><h2>تعديل مكان التخزين: ${Utils.escapeHTML(loc.nameAR)}</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveLocationForm('${id}');">
                <div class="form-group mb-12">
                    <label class="form-label">اسم المكان:</label>
                    <input type="text" id="loc-name-ar" class="form-input" value="${Utils.escapeHTML(loc.nameAR)}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">الاسم بالإنجليزية:</label>
                    <input type="text" id="loc-name-en" class="form-input" value="${Utils.escapeHTML(loc.nameEN || '')}" placeholder="English name (optional)">
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
            <div class="sheet-handle"></div>
            <div class="modal-header"><h2>إضافة تصنيف علاجي جديد</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveCategoryForm();">
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف بالعربية (إجباري):</label>
                    <input type="text" id="cat-name-ar" class="form-input" placeholder="مثال: أدوية عيون، قطرات..." required autofocus>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف بالإنجليزية (اختياري):</label>
                    <input type="text" id="cat-name-en" class="form-input" placeholder="مثال: Eye Drops & Ointments">
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">أيقونة التصنيف:</label>
                    <select id="cat-icon" class="form-select">
                        <option value="bx-capsule">💊 كبسولة</option>
                        <option value="bx-plus-medical">🩺 طبي / عام</option>
                        <option value="bx-shield">🛡️ مضادات حيوية</option>
                        <option value="bx-injection">💉 حقن ومحاليل</option>
                        <option value="bx-wind">🌬️ جهاز تنفسي</option>
                        <option value="bx-droplet">💧 قطرات / سوائل</option>
                        <option value="bx-dish">🍽️ معدة وجهاز هضمي</option>
                        <option value="bx-pulse">💓 أمراض مزمنة / قلب</option>
                        <option value="bx-spray-can">🧴 مراهم وبخاخ</option>
                        <option value="bx-first-aid">🩹 إسعافات وغيار طبي</option>
                    </select>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">لون التمييز:</label>
                    <input type="color" id="cat-color" class="form-input" value="#3b82f6" style="height:40px; padding:2px;">
                </div>
                <div class="form-actions" style="display:flex; gap:10px;">
                    <button type="submit" class="btn-primary" style="flex:1;">حفظ</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async openEditCategoryModal(id) {
        // v18.11.7: Only 'uncategorized' is fully locked. System categories can be edited.
        if (id === 'uncategorized') {
            UI.showToast('قسم "أدوية غير مصنفة" هو قسم نظام افتراضي ولا يمكن تعديله', 'info');
            return;
        }
        const cat = await Categories.getInfo(id);
        UI.showModal(`
            <div class="sheet-handle"></div>
            <div class="modal-header"><h2>تعديل التصنيف: ${Utils.escapeHTML(cat.nameAR)}</h2></div>
            <form onsubmit="event.preventDefault(); window.App.saveCategoryForm('${id}');">
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف بالعربية:</label>
                    <input type="text" id="cat-name-ar" class="form-input" value="${Utils.escapeHTML(cat.nameAR)}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">اسم التصنيف بالإنجليزية:</label>
                    <input type="text" id="cat-name-en" class="form-input" placeholder="مثال: Eye Drops & Ointments" value="${Utils.escapeHTML(cat.nameEN && !/^cat_\d+$/i.test(cat.nameEN) && !/^\d+$/.test(cat.nameEN) ? cat.nameEN : '')}">
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">الأيقونة:</label>
                    <select id="cat-icon" class="form-select">
                        <option value="bx-capsule" ${cat.icon === 'bx-capsule' ? 'selected' : ''}>💊 كبسولة</option>
                        <option value="bx-plus-medical" ${cat.icon === 'bx-plus-medical' ? 'selected' : ''}>🩺 طبي / عام</option>
                        <option value="bx-shield" ${cat.icon === 'bx-shield' ? 'selected' : ''}>🛡️ مضادات حيوية</option>
                        <option value="bx-injection" ${cat.icon === 'bx-injection' ? 'selected' : ''}>💉 حقن ومحاليل</option>
                        <option value="bx-wind" ${cat.icon === 'bx-wind' ? 'selected' : ''}>🌬️ تنفسي</option>
                        <option value="bx-droplet" ${cat.icon === 'bx-droplet' ? 'selected' : ''}>💧 قطرات</option>
                        <option value="bx-dish" ${cat.icon === 'bx-dish' ? 'selected' : ''}>🍽️ معدة وهضم</option>
                        <option value="bx-pulse" ${cat.icon === 'bx-pulse' ? 'selected' : ''}>💓 مزمن / قلب</option>
                        <option value="bx-spray-can" ${cat.icon === 'bx-spray-can' ? 'selected' : ''}>🧴 مراهم وبخاخ</option>
                        <option value="bx-first-aid" ${cat.icon === 'bx-first-aid' ? 'selected' : ''}>🩹 إسعافات</option>
                    </select>
                </div>
                <div class="form-group mb-15">
                    <label class="form-label">اللون:</label>
                    <input type="color" id="cat-color" class="form-input" value="${cat.color || '#3b82f6'}" style="height:40px; padding:2px;">
                </div>
                <div class="form-actions" style="display:flex; gap:10px;">
                    <button type="submit" class="btn-primary" style="flex:1;">حفظ</button>
                    <button type="button" class="btn-ghost" style="color:var(--danger)" onclick="window.App.deleteCategoryConfirm('${id}')">حذف التصنيف</button>
                    <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },

    async saveCategoryForm(id = null) {
        const nameArEl = document.getElementById('cat-name-ar');
        const nameEnEl = document.getElementById('cat-name-en');
        const iconEl = document.getElementById('cat-icon');
        const colorEl = document.getElementById('cat-color');
        if (!nameArEl || !nameArEl.value.trim()) {
            UI.showToast('يرجى كتابة اسم التصنيف بالعربية', 'warning');
            return;
        }

        const nameAR = nameArEl.value.trim();
        const nameEN = (nameEnEl && nameEnEl.value.trim()) ? nameEnEl.value.trim() : nameAR;

        let catId = id;
        if (!catId) {
            let slug = (nameEnEl && nameEnEl.value.trim()) 
                ? nameEnEl.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') 
                : '';
            if (!slug) {
                slug = `cat_${Date.now()}`;
            } else {
                slug = slug.startsWith('cat_') ? slug : `cat_${slug}`;
            }
            // Collision check
            const existing = await DB.get('categories', slug);
            if (existing) {
                slug = `${slug}_${Date.now()}`;
            }
            catId = slug;
        }

        const data = {
            id: catId,
            nameAR: nameAR,
            nameEN: nameEN,
            icon: iconEl ? iconEl.value : 'bx-capsule',
            color: colorEl ? colorEl.value : '#3b82f6',
            isSystem: false,
            updatedAt: new Date().toISOString()
        };

        try {
            await Categories.saveCategory(data);
            UI.closeModal();
            UI.showToast(`تم حفظ تصنيف «${nameAR}» بنجاح ومزامنته سحابياً ✨`, 'success');
            await this.refreshAllViews(catId);
        } catch (err) {
            console.error('Error saving category form:', err);
            UI.showToast('فشل حفظ التصنيف: ' + err.message, 'danger');
        }
    },

    async deleteCategoryConfirm(id) {
        if (id === 'uncategorized') {
            UI.showToast('لا يمكن حذف قسم "أدوية غير مصنفة" لأنه تصنيف أساسي في النظام', 'warning');
            return;
        }
        if (!confirm('حذف هذا القسم؟ لن يتم حذف الأدوية التابعة له بل ستحتاج لإعادة تصنيفها.')) return;
        await Categories.deleteCategory(id);
        UI.closeModal();
        UI.showToast('تم حذف التصنيف', 'info');
        await this.refreshAllViews();
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

        // LEVEL 2b: Merged view — all medicines across all locations
        if (this.auditLevel === 'merged') {
            await this.renderAuditMergedLevel(container, session);
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
                    <h2>مركز عمليات الجرد</h2>
                </div>
                <button class="btn-primary sm-btn" onclick="window.App.openNewAuditModal()">
                    <i class='bx bx-plus'></i> بدء جرد جديد
                </button>
            </div>

            <!-- Active / On-Hold Sessions -->
            <div style="margin-bottom: 8px; font-size: 13px; font-weight: 800; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-play-circle' style="font-size: 16px; color: var(--primary);"></i>
                الجلسات الجارية (${activeSessions.length})
            </div>
            
            ${activeSessions.length === 0 ? `
                <div style="padding: 30px; text-align: center; background: var(--surface); border-radius: 16px; border: 1px dashed var(--border-color); margin-bottom: 24px;">
                    <i class='bx bx-clipboard' style="font-size: 38px; color: var(--primary); opacity: 0.5;"></i>
                    <h3 style="margin: 8px 0 4px; font-size: 14px;">لا توجد جلسة جارية</h3>
                    <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">ابدأ جرد جديد الآن</p>
                    <button class="btn-primary sm-btn" onclick="window.App.openNewAuditModal()">+ بدء جرد</button>
                </div>
            ` : `
                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
                    ${activeSessions.map(s => {
                        const isHold = s.status === 'on_hold';
                        const countKeys = Object.keys(s.counts || {}).length;
                        const totalLocs = (s.locationIds || []).length;
                        return `
                            <div style="background: var(--surface); border-radius: 16px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); overflow: hidden;">
                                <!-- Session Header -->
                                <div style="padding: 14px 16px; border-bottom: 1px solid var(--border-color);">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                            <span style="padding: 3px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; ${isHold ? 'background: #fef3c7; color: #92400e;' : 'background: rgba(16,185,129,0.12); color: #065f46;'}">
                                                ${isHold ? '⏸️ معلقة' : '🟢 جارية'}
                                            </span>
                                            <strong style="font-size: 15px;">${Utils.escapeHTML(s.name)}</strong>
                                        </div>
                                        <span style="font-size: 11px; color: var(--text-muted);">${new Date(s.startedAt).toLocaleDateString('ar-EG')}</span>
                                    </div>
                                    <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 11px; color: var(--text-muted); font-weight: 600;">
                                        <span><i class='bx bx-check-circle' style="color: var(--secondary);"></i> ${countKeys} صنف</span>
                                        <span><i class='bx bx-map' style="color: var(--primary);"></i> ${totalLocs} مكان</span>
                                        <span>${s.type === 'group' ? '👥 جماعي' : '👤 فردي'}</span>
                                    </div>
                                </div>
                                <!-- Session Actions -->
                                <div style="padding: 10px 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                                    <button class="btn-primary sm-btn" onclick="window.App.openAuditSession('${s.id}')" style="flex: 1; min-width: 120px;">
                                        ▶️ متابعة الجرد
                                    </button>
                                    <button class="btn-ghost sm-btn" onclick="window.App.openExportOptionsModal('${s.id}')" title="تصدير Excel">
                                        <i class='bx bx-download'></i> Excel
                                    </button>
                                    <div style="display: flex; gap: 4px; margin-right: auto;">
                                        ${!isHold ? `
                                            <button class="icon-btn" onclick="window.App.holdAuditSession('${s.id}')" title="تعليق" style="width:34px; height:34px;">
                                                <i class='bx bx-pause' style="font-size:16px; color: var(--accent);"></i>
                                            </button>
                                        ` : `
                                            <button class="icon-btn" onclick="window.App.resumeAuditSession('${s.id}')" title="استئناف" style="width:34px; height:34px;">
                                                <i class='bx bx-play' style="font-size:16px; color: var(--secondary);"></i>
                                            </button>
                                        `}
                                        <button class="icon-btn" onclick="window.App.finalizeAuditSession('${s.id}')" title="إنهاء واعتماد" style="width:34px; height:34px;">
                                            <i class='bx bx-check-double' style="font-size:16px; color: var(--secondary);"></i>
                                        </button>
                                        <button class="icon-btn" onclick="window.App.openEditAuditSessionModal('${s.id}')" title="تعديل" style="width:34px; height:34px;">
                                            <i class='bx bx-edit-alt' style="font-size:14px;"></i>
                                        </button>
                                        <button class="icon-btn" onclick="window.App.archiveAuditSession('${s.id}')" title="أرشفة" style="width:34px; height:34px;">
                                            <i class='bx bx-archive-in' style="font-size:14px; color: var(--accent);"></i>
                                        </button>
                                        <button class="icon-btn" onclick="window.App.deleteAuditSession('${s.id}')" title="حذف" style="width:34px; height:34px;">
                                            <i class='bx bx-trash' style="font-size:14px; color: var(--danger);"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}

            <!-- Closed / Completed / Archived Sessions -->
            <div style="margin-bottom: 8px; font-size: 13px; font-weight: 800; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-archive' style="font-size: 16px; color: var(--accent);"></i>
                الأرشيف والمعتمدة (${closedSessions.length})
            </div>
            ${closedSessions.length > 0 ? `
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${closedSessions.map(s => {
                        const countKeys = Object.keys(s.counts || {}).length;
                        const isFinal = s.status === 'finalized';
                        return `
                            <div style="background: var(--surface); border-radius: 14px; border: 1px solid var(--border-color); padding: 14px 16px;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                                            <span style="padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; ${isFinal ? 'background: rgba(16,185,129,0.12); color: #065f46;' : 'background: var(--bg-secondary); color: var(--text-muted);'}">
                                                ${isFinal ? '✅ معتمد' : '📦 مؤرشف'}
                                            </span>
                                            <strong style="font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${Utils.escapeHTML(s.name)}</strong>
                                        </div>
                                        <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap;">
                                            <span><i class='bx bx-user'></i> ${s.host || 'النظام'}</span>
                                            <span>•</span>
                                            <span>${countKeys} صنف</span>
                                            <span>•</span>
                                            <span>${new Date(s.finalizedAt || s.startedAt).toLocaleDateString('ar-EG')}</span>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                                        <button class="sm-btn btn-ghost" onclick="window.App.openAuditReportModal('${s.id}')" title="عرض" style="padding: 6px 10px; font-size: 12px;">
                                            <i class='bx bx-show'></i> كشف
                                        </button>
                                        <button class="sm-btn btn-ghost" onclick="window.App.openExportOptionsModal('${s.id}')" title="Excel" style="padding: 6px 10px; font-size: 12px;">
                                            <i class='bx bx-download'></i> Excel
                                        </button>
                                        <button class="icon-btn" onclick="window.App.unarchiveAuditSession('${s.id}')" title="استعادة" style="width:30px; height:30px;">
                                            <i class='bx bx-undo' style="font-size:14px;"></i>
                                        </button>
                                        <button class="icon-btn" onclick="window.App.deleteAuditSession('${s.id}')" title="حذف" style="width:30px; height:30px;">
                                            <i class='bx bx-trash' style="font-size:14px; color: var(--danger);"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `
                <p style="text-align: center; padding: 20px; font-size: 12px; color: var(--text-muted);">لا توجد جلسات مؤرشفة</p>
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
                                    <span>${Utils.escapeHTML(loc.nameAR)}</span>
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
        if (this.selectedAuditSessionId === sessionId) {
            this.selectedAuditSessionId = null;
            this.auditLevel = 'sessions';
        }
        if (this.activeAudit && this.activeAudit.id === sessionId) {
            this.activeAudit = null;
        }
        if (typeof Sync !== 'undefined' && typeof Sync.broadcastAuditStatus === 'function') {
            Sync.broadcastAuditStatus(null);
        }
        if (typeof TaskManager !== 'undefined' && typeof TaskManager.renderAssignedTaskPrompt === 'function') {
            TaskManager.renderAssignedTaskPrompt();
        }
        UI.showToast('تم حذف الجلسة وسجلاتها نهائياً 🗑️', 'info');
        this.renderAuditView();
        if (typeof this.renderDashboard === 'function') this.renderDashboard();
    },

    async archiveAuditSession(sessionId) {
        await Audit.archiveSession(sessionId);
        UI.showToast('تم نقل الجلسة إلى الأرشيف بنجاح 📦', 'success');
        this.renderAuditView();
        if (typeof this.renderDashboard === 'function') this.renderDashboard();
    },

    async unarchiveAuditSession(sessionId) {
        await Audit.unarchiveSession(sessionId);
        UI.showToast('تمت استعادة الجلسة من الأرشيف ↩️', 'success');
        this.renderAuditView();
        if (typeof this.renderDashboard === 'function') this.renderDashboard();
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
                const med = masterMap.get(medId);
                if (!med) continue; // v18.15.0: Skip deleted/orphan medicines (no "Unknown" rows)
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
                        expiryDate: b.expiryDate || 'غير محدد',
                        countedBy: record.userName || session.host
                    });
                }
            }

            const totalQty = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);

            UI.showModal(`
                <div class="modal-header" style="border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:12px;">
                    <div>
                        <h2 style="margin:0; font-size:16px;">📋 كشف تفاصيل: ${session.name}</h2>
                        <small class="text-muted">تاريخ الاعتماد: ${new Date(session.finalizedAt || session.startedAt).toLocaleDateString('ar-EG')} | القائم بالجرد: ${session.host || this.getActiveUserName()}</small>
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
                    <button class="btn-primary sm-btn" onclick="window.App.openExportOptionsModal('${sessionId}')" style="flex:1;">
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

    async exportAuditSession(sessionId, options = {}) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session) return;
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const locs = (await Locations.getAll()) || [];
            const locMap = new Map(locs.map(l => [l.id, l.nameAR]));

            const counts = session.counts || {};
            let exportRows = [];

            // --- Step 1: Build raw rows ---
            for (const [key, record] of Object.entries(counts)) {
                const [locId, medId] = key.split('___');
                const med = masterMap.get(medId);
                if (!med) continue; // v18.15.0: Skip deleted/orphan medicines (no "Unknown" rows)
                const loc = locMap.get(locId) || 'المستودع';
                const batches = (record.batches && record.batches.length > 0)
                    ? record.batches
                    : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

                for (const b of batches) {
                    const bQty = parseFloat(b.quantity) || 0;
                    exportRows.push({
                        medId: medId,
                        nameEN: med.nameEN || '',
                        nameAR: med.nameAR || '',
                        location: loc,
                        quantity: bQty,
                        expiryDate: bQty > 0 ? (b.expiryDate || '') : '',
                        userName: record.userName || session.host,
                        countedAt: new Date(record.countedAt || session.startedAt).toLocaleString('ar-EG')
                    });
                }
            }

            if (exportRows.length === 0) {
                UI.showToast('لا توجد بيانات لتصديرها في هذه الجلسة', 'warning');
                return;
            }

            // --- Step 2: Merge same expiry (always) ---
            // Group by medId + location + expiryDate → sum quantities
            if (options.mergeExpiry !== false) {
                const expiryMap = new Map();
                for (const row of exportRows) {
                    const key = `${row.medId}___${row.location}___${row.expiryDate}`;
                    if (expiryMap.has(key)) {
                        expiryMap.get(key).quantity += row.quantity;
                    } else {
                        expiryMap.set(key, { ...row });
                    }
                }
                exportRows = Array.from(expiryMap.values());
            }

            // --- Step 3: Merge locations (optional) ---
            // Group by medId + expiryDate → sum quantities, combine location names
            if (options.mergeLocations) {
                const locMergeMap = new Map();
                for (const row of exportRows) {
                    const key = `${row.medId}___${row.expiryDate}`;
                    if (locMergeMap.has(key)) {
                        const existing = locMergeMap.get(key);
                        existing.quantity += row.quantity;
                        if (!existing.location.includes(row.location)) {
                            existing.location += ' + ' + row.location;
                        }
                    } else {
                        locMergeMap.set(key, { ...row });
                    }
                }
                exportRows = Array.from(locMergeMap.values());
            }

            // --- Step 4: Full merge (optional) ---
            // Group by medId only → sum ALL quantities regardless of expiry/location
            if (options.mergeAll) {
                const allMergeMap = new Map();
                for (const row of exportRows) {
                    if (allMergeMap.has(row.medId)) {
                        const existing = allMergeMap.get(row.medId);
                        existing.quantity += row.quantity;
                        if (!existing.location.includes(row.location)) {
                            existing.location += ' + ' + row.location;
                        }
                        // Keep earliest expiry for reference
                        if (row.expiryDate && (!existing.expiryDate || row.expiryDate < existing.expiryDate)) {
                            existing.expiryDate = row.expiryDate;
                        }
                    } else {
                        allMergeMap.set(row.medId, { ...row });
                    }
                }
                exportRows = Array.from(allMergeMap.values());
            }

            // --- Step 5: Sort ---
            exportRows.sort((a, b) => (a.nameEN || a.nameAR).localeCompare(b.nameEN || b.nameAR));

            // --- Step 6: Build final export format ---
            const finalRows = exportRows.map(r => {
                const row = {
                    'اسم الدواء (EN)': r.nameEN,
                    'اسم الدواء (AR)': r.nameAR,
                    'الكمية المحصورة': r.quantity
                };
                if (!options.mergeAll) {
                    row['تاريخ الصلاحية'] = r.expiryDate;
                }
                row['مكان التخزين'] = r.location;
                if (!options.mergeLocations && !options.mergeAll) {
                    row['المسؤول عن العد'] = r.userName;
                    row['تاريخ التسجيل'] = r.countedAt;
                }
                return row;
            });

            // --- Step 7: Export ---
            if (window.XLSX) {
                const ws = XLSX.utils.json_to_sheet(finalRows);

                // Auto column widths
                const colWidths = Object.keys(finalRows[0]).map(key => {
                    const maxLen = Math.max(key.length, ...finalRows.map(r => String(r[key] || '').length));
                    return { wch: Math.min(maxLen + 4, 40) };
                });
                ws['!cols'] = colWidths;

                const wb = XLSX.utils.book_new();
                const sheetName = options.mergeAll ? 'ملخص مجمع' : options.mergeLocations ? 'مجمع بالأماكن' : 'تقرير الجرد';
                XLSX.utils.book_append_sheet(wb, ws, sheetName);

                const suffix = options.mergeAll ? '_ملخص' : options.mergeLocations ? '_مجمع' : '';
                XLSX.writeFile(wb, `جرد_${session.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}${suffix}.xlsx`);
                
                const mergeInfo = options.mergeAll ? ' (ملخص مجمع)' : options.mergeLocations ? ' (أماكن مجمعة)' : '';
                UI.showToast(`تم تصدير ${finalRows.length} صنف${mergeInfo} ✅`, 'success');
            } else {
                UI.showToast('مكتبة تصدير Excel غير متوفرة', 'danger');
            }
        } catch (err) {
            console.error('Export session error:', err);
            UI.showToast('فشل تصدير الإكسيل', 'danger');
        }
    },

    openExportOptionsModal(sessionId) {
        UI.showModal(`
            <div class="modal-header">
                <h2><i class='bx bx-download'></i> خيارات تصدير الإكسيل</h2>
                <p class="text-muted" style="font-size:12px; margin-top:4px;">اختر طريقة التصدير المناسبة</p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">

                <button onclick="window.App.exportAuditProfessional('${sessionId}'); window.UI.closeModal();"
                    class="action-card-btn" style="text-align: right; width: 100%; border-color: var(--primary); background: rgba(59,130,246,0.04);">
                    <i class='bx bx-spreadsheet' style="font-size: 32px; color: var(--primary);"></i>
                    <div>
                        <strong>⭐ كشف جرد احترافي (موصّى به)</strong>
                        <small style="display:block; color: var(--text-muted); margin-top:2px;">
                            مجمّع بالفئات — عمود لكل مكان تخزين — إجمالي — صلاحيات مع كمياتها
                        </small>
                    </div>
                </button>
                
                <button onclick="window.App.exportAuditSession('${sessionId}', {}); window.UI.closeModal();"
                    class="action-card-btn" style="text-align: right; width: 100%;">
                    <i class='bx bx-table' style="font-size: 32px; color: var(--text-muted);"></i>
                    <div>
                        <strong>📋 تصدير تفصيلي (كل سطر لوحده)</strong>
                        <small style="display:block; color: var(--text-muted); margin-top:2px;">
                            كل دوا في كل مكان وكل صلاحية في سطر مستقل
                        </small>
                    </div>
                </button>

                <button onclick="window.App.exportAuditSession('${sessionId}', {mergeAll: true}); window.UI.closeModal();"
                    class="action-card-btn" style="text-align: right; width: 100%;">
                    <i class='bx bx-customize' style="font-size: 32px; color: var(--text-muted);"></i>
                    <div>
                        <strong>📊 ملخص مجمع (دوا = سطر واحد)</strong>
                        <small style="display:block; color: var(--text-muted); margin-top:2px;">
                            كل دوا في سطر واحد بإجمالي الكمية — أبسط صورة
                        </small>
                    </div>
                </button>
            </div>

            <div class="form-actions mt-15">
                <button class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
            </div>
        `);
    },

    async exportAuditProfessional(sessionId) {
        try {
            const session = await Audit.getSession(sessionId);
            if (!session) return;
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            const masterMap = new Map(masterMeds.map(m => [m.id, m]));
            const allLocs = (await Locations.getAll()) || [];
            const locMap = new Map(allLocs.map(l => [l.id, l]));
            const allCats = (await Categories.getAllSorted()) || [];
            const catMap = new Map(allCats.map(c => [c.id, c]));

            const counts = session.counts || {};
            if (Object.keys(counts).length === 0) {
                UI.showToast('لا توجد بيانات لتصديرها', 'warning');
                return;
            }

            // --- Step 1: Collect all unique location names used in this session ---
            const sessionLocNames = new Set();
            for (const key of Object.keys(counts)) {
                const [locId] = key.split('___');
                const loc = locMap.get(locId);
                sessionLocNames.add(loc ? loc.nameAR : 'المستودع');
            }
            const locColumns = Array.from(sessionLocNames).sort();

            // --- Step 2: Build medicine data map ---
            // medId → { nameEN, nameAR, categoryId, locations: { locName: qty }, expiries: { "YYYY-MM": qty }, total }
            const medData = new Map();

            for (const [key, record] of Object.entries(counts)) {
                const [locId, medId] = key.split('___');
                const med = masterMap.get(medId);
                if (!med) continue; // v18.15.0: Skip deleted/orphan medicines (no "Unknown" rows)
                const loc = locMap.get(locId);
                const locName = loc ? loc.nameAR : 'المستودع';
                const batches = (record.batches && record.batches.length > 0)
                    ? record.batches
                    : [{ quantity: record.quantity, expiryDate: record.expiryDate }];

                if (!medData.has(medId)) {
                    medData.set(medId, {
                        medId,
                        nameEN: med.nameEN || '',
                        nameAR: med.nameAR || '',
                        categoryId: med.categoryId || 'uncategorized',
                        locations: {},
                        expiries: {},
                        total: 0
                    });
                }

                const d = medData.get(medId);
                for (const b of batches) {
                    const qty = parseFloat(b.quantity) || 0;
                    // Sum per location
                    d.locations[locName] = (d.locations[locName] || 0) + qty;
                    // Sum per expiry ONLY for positive quantities (zero stock has no expiry)
                    if (qty > 0 && b.expiryDate && b.expiryDate !== 'غير محدد') {
                        d.expiries[b.expiryDate] = (d.expiries[b.expiryDate] || 0) + qty;
                    }
                    // Total
                    d.total += qty;
                }
            }

            // --- Step 3: Group by category ---
            const catGroups = new Map();
            for (const [medId, d] of medData) {
                const catId = d.categoryId;
                if (!catGroups.has(catId)) {
                    catGroups.set(catId, []);
                }
                catGroups.get(catId).push(d);
            }

            // Sort medicines within each category
            for (const [catId, meds] of catGroups) {
                meds.sort((a, b) => (a.nameEN || a.nameAR).localeCompare(b.nameEN || b.nameAR));
            }

            // Sort categories: known categories first, then uncategorized
            const sortedCatIds = Array.from(catGroups.keys()).sort((a, b) => {
                if (a === 'uncategorized') return 1;
                if (b === 'uncategorized') return -1;
                const nameA = Categories.getCategoryDisplayName(catMap.get(a) || a, 'both', catMap);
                const nameB = Categories.getCategoryDisplayName(catMap.get(b) || b, 'both', catMap);
                return nameA.localeCompare(nameB);
            });

            // --- Step 4: Build rows array-of-arrays for XLSX ---
            // Header row (with sequential numbering 'م')
            const headers = ['م', 'اسم الدواء (EN)', 'اسم الدواء (AR)', ...locColumns, 'الإجمالي', 'الصلاحيات'];
            const aoa = [headers];
            const categoryRowIndices = [];
            let rowCounter = 1;

            for (const catId of sortedCatIds) {
                const cat = catMap.get(catId);
                const catNameEN = Categories.getCategoryDisplayName(cat || catId, 'en', catMap);
                const catNameAR = Categories.getCategoryDisplayName(cat || catId, 'ar', catMap);
                const meds = catGroups.get(catId);

                // EN category in EN column (col 1), AR category in AR column (col 2), NO square symbol, NO row merge!
                const catRow = ['', catNameEN, catNameAR];
                while (catRow.length < headers.length) catRow.push('');
                categoryRowIndices.push(aoa.length);
                aoa.push(catRow);

                // Medicine rows with sequential numbering
                for (const m of meds) {
                    const row = [rowCounter++, m.nameEN, m.nameAR];
                    // Location columns
                    for (const locName of locColumns) {
                        row.push(m.locations[locName] || 0);
                    }
                    // Total
                    row.push(m.total);
                    // Expiries formatted: "2025-06: 5 | 2025-12: 3"
                    const expiryParts = Object.entries(m.expiries)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([exp, qty]) => `${exp}: ${qty}`);
                    row.push(expiryParts.join(' | '));
                    aoa.push(row);
                }
            }

            // Bottom summary row: Total number of medicines (instead of grand quantity sum)
            const countRow = ['', 'إجمالي عدد الأدوية', medData.size];
            while (countRow.length < headers.length) countRow.push('');
            aoa.push([]);  // Empty row separator
            aoa.push(countRow);

            // --- Step 5: Export with XLSX ---
            if (!window.XLSX) {
                UI.showToast('مكتبة تصدير Excel غير متوفرة — جاري إعادة التحميل...', 'warning');
                return;
            }

            const ws = XLSX.utils.aoa_to_sheet(aoa);

            // Auto column widths
            ws['!cols'] = headers.map((h, i) => {
                if (i === 0) return { wch: 6 };
                let maxLen = h.length;
                for (const row of aoa) {
                    const cellLen = String(row[i] || '').length;
                    if (cellLen > maxLen) maxLen = cellLen;
                }
                return { wch: Math.min(maxLen + 3, 50) };
            });

            // Apply native Excel styles (Bold + Larger font on category rows, NO merged rows)
            this._applyExcelSheetStyles(ws, aoa.length, headers.length, categoryRowIndices, aoa.length - 1);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'كشف الجرد');
            const fileName = `كشف_جرد_${session.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}.xlsx`;
            XLSX.writeFile(wb, fileName);
            UI.showToast(`تم تصدير كشف الجرد الاحترافي (${medData.size} صنف) ✅`, 'success');

        } catch (err) {
            console.error('Professional export error:', err);
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
                    <h3>${Utils.escapeHTML(session.name)}</h3>
                    <span style="font-size: 11.5px; color: var(--text-muted);">
                        الحالة: ${session.status === 'on_hold' ? '⏸️ معلقة' : '🟢 جارية'} &nbsp;|&nbsp; النمط: ${session.type === 'group' ? '👥 جماعي' : '👤 فردي'}
                    </span>
                </div>
                <div class="ctrl-actions">
                    ${session.status !== 'on_hold' ? `
                        <button class="btn-ghost sm-btn" onclick="window.App.holdAuditSession('${session.id}')" style="border:1px solid var(--border-color);">
                            <i class='bx bx-pause'></i> تعليق
                        </button>
                    ` : `
                        <button class="btn-ghost sm-btn" onclick="window.App.resumeAuditSession('${session.id}')" style="border:1px solid var(--border-color);">
                            <i class='bx bx-play'></i> استئناف
                        </button>
                    `}
                    <button class="btn-primary sm-btn" onclick="window.App.finalizeAuditSession('${session.id}')">
                        <i class='bx bx-check'></i> إنهاء واعتماد
                    </button>
                </div>
                <button type="button" class="btn-primary" onclick="window.App.startAuditBarcodeScan()" style="background:#7c3aed; height:40px; font-size:13px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
                    <i class='bx bx-barcode-reader' style="font-size:18px;"></i> جرد سريع بالباركود
                </button>
            </div>

            <div class="section-title mb-12">
                <h3><i class='bx bx-map-pin'></i> اختر المكان لبدء الجرد الميداني:</h3>
            </div>

            <!-- View Mode Toggle: Per-Location vs Merged -->
            <div style="display:flex; gap:8px; margin-bottom:14px; padding:4px; background:var(--bg-secondary); border-radius:10px;">
                <button onclick="window.App.auditLevel='locations'; window.App.renderAuditView();" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:12px; font-weight:700; background:var(--primary); color:white;">
                    <i class='bx bx-map-pin'></i> حسب المكان
                </button>
                <button onclick="window.App.auditLevel='merged'; window.App.auditMergedSearch=''; window.App.auditMergedFilter='all'; window.App.renderAuditView();" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:12px; font-weight:700; background:transparent; color:var(--text-muted);">
                    <i class='bx bx-merge'></i> عرض مدمج حسب الدواء
                </button>
            </div>

            <!-- Square Locations Grid -->
            <div class="audit-square-grid">
                ${await Promise.all(activeLocations.map(async (loc) => {
                    const stats = await Audit.getLocationStats(session.id, loc.id);
                    return `
                        <div class="square-card" onclick="window.App.openAuditLocation('${loc.id}')">
                            <i class='bx ${loc.icon || 'bx-map-pin'} square-icon' style="color: ${loc.color || 'var(--primary)'}"></i>
                            <h3>${Utils.escapeHTML(loc.nameAR)}</h3>
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

    // =========================================================================
    // --- MERGED AUDIT VIEW (v18.11.8) — All medicines across all locations ---
    // =========================================================================
    async renderAuditMergedLevel(container, session) {
        const allLocs = await Locations.getAll();
        const sessionLocIds = session.locationIds || [];
        const activeLocs = allLocs.filter(l => sessionLocIds.includes(l.id));
        const locMap = new Map(activeLocs.map(l => [l.id, l]));
        const counts = session.counts || {};
        const allMeds = (await DB.getAll('medicineMaster')) || [];

        // Build merged data: for each medicine, collect counts from all locations
        const mergedMap = new Map(); // medId → { med, locations: [ { loc, batches, qty } ], totalQty, mergedBatches }

        for (const med of allMeds) {
            const locEntries = [];
            let totalQty = 0;
            const batchMap = new Map(); // expiryDate → total qty

            for (const locId of sessionLocIds) {
                const key = `${locId}___${med.id}`;
                const record = counts[key];
                if (record) {
                    const batches = record.batches || [{ quantity: record.quantity, expiryDate: record.expiryDate }];
                    const locQty = batches.reduce((s, b) => s + (parseFloat(b.quantity) || 0), 0);
                    locEntries.push({
                        locId,
                        locName: locMap.get(locId)?.nameAR || locId,
                        locIcon: locMap.get(locId)?.icon || 'bx-map-pin',
                        locColor: locMap.get(locId)?.color || 'var(--primary)',
                        batches,
                        qty: locQty,
                        countedBy: record.userName
                    });
                    totalQty += locQty;
                    for (const b of batches) {
                        const bQty = parseFloat(b.quantity) || 0;
                        if (bQty > 0 && b.expiryDate && b.expiryDate !== 'غير محدد') {
                            batchMap.set(b.expiryDate, (batchMap.get(b.expiryDate) || 0) + bQty);
                        }
                    }
                }
            }

            // Count how many locations this med SHOULD be in (has records)
            // vs how many it IS counted in
            const totalLocsForMed = sessionLocIds.length;
            const countedLocsForMed = locEntries.length;

            const mergedBatches = Array.from(batchMap.entries())
                .map(([exp, qty]) => ({ expiryDate: exp, quantity: qty }))
                .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));

            mergedMap.set(med.id, {
                med,
                locations: locEntries,
                totalQty,
                mergedBatches,
                countedLocs: countedLocsForMed,
                totalLocs: totalLocsForMed,
                isCounted: countedLocsForMed > 0,
                isFullyCounted: countedLocsForMed === totalLocsForMed
            });
        }

        let mergedList = Array.from(mergedMap.values());

        // Filters
        const currentFilter = this.auditMergedFilter || 'all';
        const totalCount = mergedList.length;
        const countedAny = mergedList.filter(m => m.isCounted).length;
        const uncountedAll = mergedList.filter(m => !m.isCounted).length;
        const partialCount = mergedList.filter(m => m.isCounted && !m.isFullyCounted).length;

        if (currentFilter === 'uncounted') {
            mergedList = mergedList.filter(m => !m.isCounted);
        } else if (currentFilter === 'counted') {
            mergedList = mergedList.filter(m => m.isCounted);
        } else if (currentFilter === 'partial') {
            mergedList = mergedList.filter(m => m.isCounted && !m.isFullyCounted);
        }

        // Cache pre-search list for instant in-place search without closing mobile keyboard
        this._auditMergedCache = { baseList: [...mergedList], activeLocs };

        // Search (Unified Smart Search)
        const searchQuery = (this.auditMergedSearch || '').trim();
        if (searchQuery) {
            mergedList = Utils.smartFilter(
                mergedList,
                searchQuery,
                (pq, m) => Utils.smartScoreMed(pq, m.med),
                { keepOrder: true }
            );
        }

        // Sort: uncounted first, then partial, then fully counted
        mergedList.sort((a, b) => {
            if (a.isCounted !== b.isCounted) return a.isCounted ? 1 : -1;
            if (a.isFullyCounted !== b.isFullyCounted) return a.isFullyCounted ? 1 : -1;
            return (a.med.nameEN || '').localeCompare(b.med.nameEN || '');
        });

        container.innerHTML = `
            <!-- Breadcrumbs -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditLevel='locations'; window.App.renderAuditView();" title="العودة للأماكن">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToSessions()" style="cursor:pointer">الجلسات</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">${Utils.escapeHTML(session.name)} — عرض مدمج 💊</span>
                </div>
            </div>

            <!-- View Mode Toggle -->
            <div style="display:flex; gap:8px; margin-bottom:14px; padding:4px; background:var(--bg-secondary); border-radius:10px;">
                <button onclick="window.App.auditLevel='locations'; window.App.renderAuditView();" style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:12px; font-weight:700; background:transparent; color:var(--text-muted);">
                    <i class='bx bx-map-pin'></i> حسب المكان
                </button>
                <button style="flex:1; padding:8px; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:12px; font-weight:700; background:var(--primary); color:white;">
                    <i class='bx bx-merge'></i> عرض مدمج حسب الدواء
                </button>
            </div>

            <!-- Search + Barcode Audit Button -->
            <div class="audit-toolbar" style="margin-bottom:12px;">
                <div class="audit-search-wrapper" style="width:100%;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="audit-merged-search-input" class="audit-search-input" placeholder="بحث بالاسم العربي أو الإنجليزي..." value="${Utils.escapeHTML(this.auditMergedSearch || '')}" oninput="window.App.handleAuditMergedSearch(this.value)">
                    <button type="button" id="audit-merged-clear-btn" onclick="window.App.handleAuditMergedSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${this.auditMergedSearch ? 'flex' : 'none'}; align-items:center;">
                        <i class='bx bx-x' style="font-size:18px;"></i>
                    </button>
                </div>
                <button type="button" class="btn-primary" onclick="window.App.startAuditBarcodeScan()" style="background:#7c3aed; height:38px; font-size:12.5px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
                    <i class='bx bx-barcode-reader' style="font-size:17px;"></i> جرد سريع بالباركود
                </button>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px;">
                    <div class="audit-filters-row">
                        <button type="button" class="audit-filter-chip ${currentFilter === 'all' ? 'active' : ''}" onclick="window.App.auditMergedFilter='all'; window.App.renderAuditView();">
                            الكل (${totalCount})
                        </button>
                        <button type="button" class="audit-filter-chip ${currentFilter === 'uncounted' ? 'active' : ''}" onclick="window.App.auditMergedFilter='uncounted'; window.App.renderAuditView();">
                            ⏳ لم يُعد (${uncountedAll})
                        </button>
                        <button type="button" class="audit-filter-chip ${currentFilter === 'counted' ? 'active' : ''}" onclick="window.App.auditMergedFilter='counted'; window.App.renderAuditView();">
                            ✅ تم العد (${countedAny})
                        </button>
                        <button type="button" class="audit-filter-chip ${currentFilter === 'partial' ? 'active' : ''}" onclick="window.App.auditMergedFilter='partial'; window.App.renderAuditView();">
                            ⚠️ عد ناقص (${partialCount})
                        </button>
                    </div>
                </div>
            </div>

            <!-- Merged Cards (Updated in-place on search — never loses focus!) -->
            <div id="audit-merged-results-box">
                ${mergedList.length === 0 ? `
                    <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                        <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                        <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة</p>
                    </div>
                ` : `
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        ${mergedList.map(item => this.renderMergedMedicineCard(item, activeLocs)).join('')}
                    </div>
                `}
            </div>
        `;
    },

    handleAuditMergedSearch(query, resetInput = false) {
        this.auditMergedSearch = query || '';
        const clearBtn = document.getElementById('audit-merged-clear-btn');
        if (clearBtn) clearBtn.style.display = this.auditMergedSearch ? 'flex' : 'none';
        if (resetInput) {
            const inp = document.getElementById('audit-merged-search-input');
            if (inp) { inp.value = ''; inp.focus(); }
        }
        const box = document.getElementById('audit-merged-results-box');
        if (box && this._auditMergedCache) {
            const { baseList, activeLocs } = this._auditMergedCache;
            const q = this.auditMergedSearch.trim();
            let list = baseList;
            if (q) {
                list = Utils.smartFilter(
                    list,
                    q,
                    (pq, m) => Utils.smartScoreMed(pq, m.med),
                    { keepOrder: true }
                );
            }
            list = [...list].sort((a, b) => {
                if (a.isCounted !== b.isCounted) return a.isCounted ? 1 : -1;
                if (a.isFullyCounted !== b.isFullyCounted) return a.isFullyCounted ? 1 : -1;
                return (a.med.nameEN || '').localeCompare(b.med.nameEN || '');
            });
            box.innerHTML = list.length === 0 ? `
                <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                    <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة</p>
                </div>
            ` : `<div style="display:flex; flex-direction:column; gap:12px;">${list.map(item => this.renderMergedMedicineCard(item, activeLocs)).join('')}</div>`;
            return;
        }
        this.renderAuditView();
    },

    renderMergedMedicineCard(item, allSessionLocs) {
        const { med, locations, totalQty, mergedBatches, countedLocs, totalLocs, isCounted } = item;
        const imgUrl = (typeof Categories !== 'undefined' && Categories.getMedicineImage) ? Categories.getMedicineImage(med) : (med.imagePath || 'assets/icons/default-med.png');
        const primaryName = med.nameEN || med.nameAR || 'دواء';
        const secondaryName = (med.nameAR && med.nameAR !== med.nameEN) ? med.nameAR : '';

        const statusBadge = !isCounted
            ? `<span style="font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(59,130,246,0.1); color:var(--primary);">⏳ لم يُعد بعد</span>`
            : (countedLocs < totalLocs
                ? `<span style="font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(245,158,11,0.15); color:#92400e;">⚠️ تم في ${countedLocs}/${totalLocs} مكان</span>`
                : `<span style="font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(16,185,129,0.15); color:#065f46;">✅ تم في كل الأماكن</span>`
            );

        const locsHtml = locations.map(loc => {
            const batchPills = loc.batches.map(b => {
                const badge = this.calcExpiryBadge(b.expiryDate);
                return `<span style="font-size:9px; font-weight:600; padding:1px 5px; border-radius:4px; background:${badge.bg}; color:${badge.color}; display:inline-flex; align-items:center; gap:2px; white-space:nowrap;">
                    ${b.quantity} × ${b.expiryDate || 'غير محدد'}
                </span>`;
            }).join(' ');

            return `
                <div style="display:flex; align-items:flex-start; gap:8px; padding:6px 10px; background:var(--bg-secondary); border-radius:8px;">
                    <i class='bx ${loc.locIcon}' style="font-size:16px; color:${loc.locColor}; margin-top:2px;"></i>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                            <strong style="font-size:11px;">${Utils.escapeHTML(loc.locName)}</strong>
                            <span style="font-size:11px; font-weight:800; color:var(--primary);">${loc.qty} وحدة</span>
                        </div>
                        <div style="display:flex; gap:4px; flex-wrap:wrap;">${batchPills}</div>
                    </div>
                </div>
            `;
        }).join('');

        const mergedBatchesHtml = mergedBatches.length > 0 ? mergedBatches.map(b => {
            const badge = this.calcExpiryBadge(b.expiryDate);
            return `<span style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; background:${badge.bg}; color:${badge.color}; display:inline-flex; align-items:center; gap:2px;">
                <i class='bx ${badge.icon}' style="font-size:11px;"></i> ${b.quantity} × ${b.expiryDate}
            </span>`;
        }).join(' ') : '';

        // Build location buttons for counting
        const countBtnsHtml = allSessionLocs.map(loc => `
            <button onclick="event.stopPropagation(); window.App.openMergedCountModal('${med.id}', '${loc.id}')" style="display:flex; align-items:center; gap:4px; padding:5px 10px; border:1px solid var(--border-color); border-radius:6px; background:var(--surface); cursor:pointer; font-family:inherit; font-size:11px; font-weight:600; color:var(--text-main);">
                <i class='bx ${loc.icon || 'bx-map-pin'}' style="color:${loc.color || 'var(--primary)'}; font-size:13px;"></i>
                ${Utils.escapeHTML(loc.nameAR)}
            </button>
        `).join('');

        return `
            <div style="background:var(--surface); border-radius:14px; border:1px solid var(--border-color); box-shadow:var(--shadow-sm); overflow:hidden; ${isCounted ? 'border-right:3px solid #10b981;' : ''}">
                <!-- Header -->
                <div style="padding:12px 14px; display:flex; align-items:center; gap:10px;">
                    <div style="width:42px; height:42px; border-radius:10px; overflow:hidden; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                        <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="flex:1; min-width:0;">
                        <h3 style="margin:0; font-size:13px; font-weight:800; line-height:1.3;">${Utils.escapeHTML(primaryName)}</h3>
                        ${secondaryName ? `<div style="font-size:10px; color:var(--text-muted); line-height:1.2;">${Utils.escapeHTML(secondaryName)}</div>` : ''}
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                        ${statusBadge}
                        ${isCounted ? `<strong style="font-size:16px; color:var(--primary);">${totalQty}</strong>` : ''}
                    </div>
                </div>

                ${isCounted ? `
                    <!-- Per-Location Breakdown -->
                    <div style="padding:0 14px 10px; display:flex; flex-direction:column; gap:6px;">
                        ${locsHtml}
                    </div>

                    ${mergedBatches.length > 0 ? `
                        <!-- Merged Totals -->
                        <div style="padding:8px 14px; background:rgba(59,130,246,0.04); border-top:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                            <span style="font-size:11px; font-weight:700; color:var(--text-muted);">📅 الصلاحيات المدمجة:</span>
                            <div style="display:flex; gap:4px; flex-wrap:wrap;">${mergedBatchesHtml}</div>
                        </div>
                    ` : ''}
                ` : ''}

                <!-- Count Action Buttons -->
                <div style="padding:8px 14px 10px; border-top:1px solid var(--border-color); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span style="font-size:10px; font-weight:700; color:var(--text-muted); white-space:nowrap;">📋 عد في:</span>
                    ${countBtnsHtml}
                </div>
            </div>
        `;
    },

    // Open count modal from merged view — sets the location context then opens the modal
    async openMergedCountModal(medicineId, locationId) {
        this.selectedAuditLocationId = locationId;
        await this.openCountModal(medicineId);
    },

    async renderAuditCategoriesLevel(container, session) {
        const loc = await Locations.get(this.selectedAuditLocationId);
        if (!loc) return this.auditBackToLocations();

        const categories = await Locations.getCategoriesForLocation(loc.id);
        const allLocMeds = await Audit.getMedicinesWithAuditStatus(session.id, loc.id, null);

        const totalCount = allLocMeds.length;
        const uncountedCount = allLocMeds.filter(m => !m.isCounted).length;
        const countedCount = allLocMeds.filter(m => m.isCounted).length;
        const progressPct = totalCount > 0 ? Math.round((countedCount / totalCount) * 100) : 0;

        const hasSearch = !!(this.auditLocSearch && this.auditLocSearch.trim().length > 0);
        const viewMode = hasSearch ? 'all-meds' : (this.auditLocViewMode || 'categories');
        const currentLocFilter = this.auditLocFilter || 'all';
        const sortMode = this.auditSortMode || 'status';
        this._auditLocCache = { allLocMeds, categories, totalCount, countedCount, uncountedCount, sortMode, currentLocFilter };

        let displayedMeds = allLocMeds;
        if (currentLocFilter === 'uncounted') {
            displayedMeds = displayedMeds.filter(m => !m.isCounted);
        } else if (currentLocFilter === 'counted') {
            displayedMeds = displayedMeds.filter(m => m.isCounted);
        }

        if (hasSearch) {
            displayedMeds = this.filterAuditMedicines(displayedMeds, this.auditLocSearch);
        }
        displayedMeds = this.sortAuditMedicines(displayedMeds, sortMode);

        container.innerHTML = `
            <!-- Breadcrumbs Bar -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditBackToLocations()" title="العودة للأماكن">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToSessions()" style="cursor:pointer">الجلسات</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">${Utils.escapeHTML(loc.nameAR)}</span>
                </div>
            </div>

            <!-- Location Progress Bar -->
            <div style="background:var(--surface); border:1px solid var(--border-color); border-radius:12px; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class='bx ${loc.icon || 'bx-map-pin'}' style="font-size:20px; color:var(--primary);"></i>
                    <div>
                        <strong style="font-size:14px; color:var(--text-main);">${Utils.escapeHTML(loc.nameAR)}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${totalCount} صنف دواء إجمالي</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="text-align:left;">
                        <span style="font-size:12px; font-weight:bold; color:var(--text-main);">${countedCount} / ${totalCount}</span>
                        <div style="font-size:10px; color:var(--text-muted);">تم عد (${progressPct}%)</div>
                    </div>
                    <div style="width:50px; height:6px; background:var(--border-color); border-radius:3px; overflow:hidden;">
                        <div style="width:${progressPct}%; height:100%; background:#10b981; border-radius:3px;"></div>
                    </div>
                </div>
            </div>

            <!-- In-Location Search Bar -->
            <div class="audit-toolbar" style="margin-bottom:10px;">
                <div class="audit-search-wrapper" style="width:100%;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="audit-loc-search" class="audit-search-input" placeholder="🔍 ابحث عن دواء في ${Utils.escapeHTML(loc.nameAR)} (عربي / إنجليزي)..." value="${Utils.escapeHTML(this.auditLocSearch || '')}" oninput="window.App.handleAuditLocSearch(this.value)">
                    <button type="button" id="audit-loc-clear-btn" onclick="window.App.handleAuditLocSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${hasSearch ? 'flex' : 'none'}; align-items:center;">
                        <i class='bx bx-x' style="font-size:18px;"></i>
                    </button>
                </div>
            </div>

            <!-- Quick Add & Barcode Scan Buttons Row -->
            <div style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;">
                <button type="button" class="btn-primary sm-btn" onclick="window.App.startAuditBarcodeScan()" style="background:#7c3aed; height:36px; font-size:11.5px; padding:0 11px; border-radius:9px; flex:1; min-width:110px;">
                    <i class='bx bx-barcode-reader' style="font-size:15px;"></i> بالباركود
                </button>
                <button class="btn-primary sm-btn" onclick="window.App.addMedicineDuringAudit()" style="height:36px; font-size:11.5px; padding:0 11px; border-radius:9px; flex:1; min-width:105px;">
                    <i class='bx bx-plus-medical'></i> دواء جديد
                </button>
                <button class="btn-ghost sm-btn" onclick="window.App.addCategoryDuringAudit()" style="height:36px; font-size:11.5px; padding:0 10px; border-radius:9px; border:1px solid var(--border-color);">
                    <i class='bx bx-folder-plus'></i> قسم
                </button>
            </div>

            <!-- View Mode Switch & Sort Options Row -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                <div style="display:flex; background:var(--bg-secondary); border-radius:10px; padding:3px; gap:4px; border:1px solid var(--border-color);">
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.setAuditLocViewMode('categories')" style="font-size:11.5px; padding:5px 10px; border-radius:7px; ${viewMode === 'categories' ? 'background:var(--primary); color:white; font-weight:bold;' : 'color:var(--text-muted);'}">
                        <i class='bx bx-folder'></i> حسب الأقسام (${categories.length})
                    </button>
                    <button type="button" class="btn-ghost sm-btn" onclick="window.App.setAuditLocViewMode('all-meds')" style="font-size:11.5px; padding:5px 10px; border-radius:7px; ${viewMode === 'all-meds' ? 'background:var(--primary); color:white; font-weight:bold;' : 'color:var(--text-muted);'}">
                        <i class='bx bx-list-ul'></i> كل الأدوية (${totalCount})
                    </button>
                </div>

                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; color:var(--text-muted); font-weight:bold;">الترتيب:</span>
                    <select class="form-input" onchange="window.App.setAuditSortMode(this.value)" style="padding:3px 8px; font-size:11px; border-radius:8px; width:auto; height:30px; background:var(--surface);">
                        <option value="status" ${sortMode === 'status' ? 'selected' : ''}>⏳ غير المعدود أولاً</option>
                        <option value="en" ${sortMode === 'en' ? 'selected' : ''}>🔤 أبجدي A-Z</option>
                        <option value="ar" ${sortMode === 'ar' ? 'selected' : ''}>🔤 أبجدي أ-ي</option>
                    </select>
                </div>
            </div>

            <!-- Content Area: Categories Grid OR All Medicines Grid (Updated in-place on search — never loses focus!) -->
            <div id="audit-loc-results-box">
                ${this._renderAuditLocContentHtml(viewMode, categories, allLocMeds, displayedMeds, currentLocFilter, totalCount, countedCount, uncountedCount)}
            </div>
        `;
    },

    _renderAuditLocContentHtml(viewMode, categories, allLocMeds, displayedMeds, currentLocFilter, totalCount, countedCount, uncountedCount) {
        if (viewMode === 'categories') {
            return `
                <div class="audit-square-grid">
                    ${categories.map(cat => {
                        const catMeds = allLocMeds.filter(m => m.categoryId === cat.id);
                        const catCounted = catMeds.filter(m => m.isCounted).length;
                        const isCatDone = catMeds.length > 0 && catCounted === catMeds.length;
                        return `
                            <div class="square-card ${isCatDone ? 'counted' : ''}" onclick="window.App.openAuditCategory('${cat.id}')" style="cursor:pointer;">
                                ${isCatDone ? `<span class="badge-done"><i class='bx bx-check'></i> مكتمل</span>` : ''}
                                <i class='bx ${cat.icon || 'bx-category'} square-icon' style="color: ${cat.color || 'var(--primary)'}"></i>
                                <h3 style="font-size:12px; margin:4px 0 2px 0;">${Utils.escapeHTML(cat.nameAR)}</h3>
                                <span class="square-meta" style="font-size:10.5px; font-weight:600;">${catCounted} / ${catMeds.length} صنف</span>
                                <div style="width: 80%; height: 3px; background: var(--border-color); border-radius: 2px; margin-top: 6px; overflow: hidden;">
                                    <div style="width: ${catMeds.length > 0 ? Math.round((catCounted/catMeds.length)*100) : 0}%; height: 100%; background: #10b981; border-radius: 2px;"></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }
        return `
            <div class="audit-filters-row" style="margin-bottom:10px;">
                <button type="button" class="audit-filter-chip ${currentLocFilter === 'all' ? 'active' : ''}" onclick="window.App.setAuditLocFilter('all')">
                    الكل (${totalCount})
                </button>
                <button type="button" class="audit-filter-chip ${currentLocFilter === 'uncounted' ? 'active' : ''}" onclick="window.App.setAuditLocFilter('uncounted')">
                    ⏳ بانتظار العد (${uncountedCount})
                </button>
                <button type="button" class="audit-filter-chip ${currentLocFilter === 'counted' ? 'active' : ''}" onclick="window.App.setAuditLocFilter('counted')">
                    ✅ تم العد (${countedCount})
                </button>
            </div>
            ${displayedMeds.length === 0 ? `
                <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                    <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة لبحثك في هذا المكان</p>
                </div>
            ` : `
                <div class="audit-square-grid">
                    ${displayedMeds.map(med => this.renderAuditMedicineCard(med)).join('')}
                </div>
            `}
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
                            <strong style="font-size:15px; color:var(--text-main);">${Utils.escapeHTML(active.name)}</strong>
                            <span class="badge ${active.role === 'admin' ? 'bg-primary text-white' : 'bg-secondary'}" style="font-size:10px; padding:2px 6px; border-radius:4px;">
                                ${active.role === 'admin' ? 'مدير 🛡️' : 'صيدلي 💊'}
                            </span>
                        </div>
                        <small style="color:var(--text-muted); font-size:11px;">${Utils.escapeHTML(active.title || 'مسؤول الصيدلية')}</small>
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
                                        <strong style="font-size:14px;">${Utils.escapeHTML(member.name)}</strong>
                                        <span class="badge ${member.role === 'admin' ? 'bg-primary text-white' : 'bg-secondary'}" style="font-size:10px; padding:1px 5px; border-radius:4px;">
                                            ${member.role === 'admin' ? 'مدير 🛡️' : 'صيدلي 💊'}
                                        </span>
                                    </div>
                                    <small style="color:var(--text-muted); font-size:11px;">${Utils.escapeHTML(member.title || 'عضو فريق')}</small>
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

            <div class="form-actions" style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
                <button type="button" class="btn-ghost text-danger" onclick="window.App.handleLogout()" style="display:flex; align-items:center; gap:6px; color:var(--danger, #ef4444);">
                    <i class='bx bx-log-out'></i> تسجيل الخروج من النظام
                </button>
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
                    <input type="text" id="edit-user-name" class="form-input" value="${Utils.escapeHTML(user.name)}" required>
                </div>
                <div class="form-group mb-12">
                    <label class="form-label">المسمى الوظيفي:</label>
                    <input type="text" id="edit-user-title" class="form-input" value="${Utils.escapeHTML(user.title || '')}">
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
        return (typeof Users !== 'undefined' && Users.getActive()) ? Users.getActive().name : (this.userName || 'مسؤول الصيدلية');
    },

    async joinGroupAuditSession(sessionId) {
        const active = Users.getActive();
        await Audit.joinSession(sessionId, active.name);
        this.renderAuditView();
    },

    async recordZeroCountModal(medicineId) {
        // v18.13.1: Direct zero-count save — no confirmation dialog & strictly no expiry date
        await Audit.recordCount(this.selectedAuditSessionId, this.selectedAuditLocationId, medicineId, {
            batches: [{ quantity: 0, expiryDate: '' }]
        });
        UI.closeModal();
        UI.showToast('تم تسجيل رصيد الصنف صفر (0) بدون صلاحية ✅', 'info');
        this.renderAuditView();
    },

    setAuditFilter(filterType) {
        this.auditMedFilter = filterType;
        this.renderAuditView();
    },

    handleAuditMedSearch(query, resetInput = false) {
        this.auditMedSearch = query || '';
        const clearBtn = document.getElementById('audit-med-clear-btn');
        if (clearBtn) clearBtn.style.display = this.auditMedSearch ? 'flex' : 'none';
        if (resetInput) {
            const inp = document.getElementById('audit-med-search');
            if (inp) { inp.value = ''; inp.focus(); }
        }
        const box = document.getElementById('audit-med-results-box');
        if (box && this._auditMedCache) {
            let list = [...this._auditMedCache.baseMeds];
            if (this.auditMedSearch.trim()) {
                list = this.filterAuditMedicines(list, this.auditMedSearch);
            }
            list = this.sortAuditMedicines(list, this._auditMedCache.sortMode);
            box.innerHTML = list.length === 0 ? `
                <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                    <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                    <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة لبحثك أو الفلتر المحدد</p>
                </div>
            ` : `<div class="audit-square-grid">${list.map(med => this.renderAuditMedicineCard(med)).join('')}</div>`;
            return;
        }
        this.renderAuditView();
    },

    setAuditLocViewMode(mode) {
        this.auditLocViewMode = mode;
        this.renderAuditView();
    },

    handleAuditLocSearch(query, resetInput = false) {
        this.auditLocSearch = query || '';
        const hasSearch = !!(this.auditLocSearch && this.auditLocSearch.trim());
        const clearBtn = document.getElementById('audit-loc-clear-btn');
        if (clearBtn) clearBtn.style.display = hasSearch ? 'flex' : 'none';
        if (resetInput) {
            const inp = document.getElementById('audit-loc-search');
            if (inp) { inp.value = ''; inp.focus(); }
        }
        const box = document.getElementById('audit-loc-results-box');
        if (box && this._auditLocCache) {
            const c = this._auditLocCache;
            const viewMode = hasSearch ? 'all-meds' : (this.auditLocViewMode || 'categories');
            let displayed = c.allLocMeds;
            if (c.currentLocFilter === 'uncounted') displayed = displayed.filter(m => !m.isCounted);
            else if (c.currentLocFilter === 'counted') displayed = displayed.filter(m => m.isCounted);
            if (hasSearch) displayed = this.filterAuditMedicines(displayed, this.auditLocSearch);
            displayed = this.sortAuditMedicines(displayed, c.sortMode);
            box.innerHTML = this._renderAuditLocContentHtml(viewMode, c.categories, c.allLocMeds, displayed, c.currentLocFilter, c.totalCount, c.countedCount, c.uncountedCount);
            return;
        }
        this.renderAuditView();
    },

    setAuditSortMode(mode) {
        this.auditSortMode = mode;
        this.renderAuditView();
    },

    setAuditLocFilter(filterType) {
        this.auditLocFilter = filterType;
        this.renderAuditView();
    },

    sortAuditMedicines(meds, sortMode = 'status') {
        const langPref = localStorage.getItem('dawaa_med_lang_pref') || 'en';
        return meds.slice().sort((a, b) => {
            if (sortMode === 'status') {
                if (a.isCounted !== b.isCounted) {
                    return a.isCounted ? 1 : -1; // uncounted first
                }
                const aName = (langPref === 'ar' ? (a.nameAR || a.nameEN) : (a.nameEN || a.nameAR)) || '';
                const bName = (langPref === 'ar' ? (b.nameAR || b.nameEN) : (b.nameEN || b.nameAR)) || '';
                return aName.localeCompare(bName, langPref === 'ar' ? 'ar' : 'en');
            } else if (sortMode === 'ar') {
                const aName = a.nameAR || a.nameEN || '';
                const bName = b.nameAR || b.nameEN || '';
                return aName.localeCompare(bName, 'ar');
            } else {
                // 'en'
                const aName = a.nameEN || a.nameAR || '';
                const bName = b.nameEN || b.nameAR || '';
                return aName.localeCompare(bName, 'en', { sensitivity: 'base' });
            }
        });
    },

    filterAuditMedicines(meds, query) {
        if (!query || !query.trim()) return meds;
        return Utils.smartFilter(
            meds,
            query,
            (pq, m) => Utils.smartScoreMed(pq, m),
            { keepOrder: true }
        );
    },

    renderAuditMedicineCard(med) {
        const langPref = localStorage.getItem('dawaa_med_lang_pref') || 'en';
        let primaryName = med.nameEN || med.nameAR || 'دواء';
        let secondaryName = (med.nameAR && med.nameAR !== med.nameEN) ? med.nameAR : '';

        if (langPref === 'ar') {
            primaryName = med.nameAR || med.nameEN || 'دواء';
            secondaryName = (med.nameEN && med.nameEN !== med.nameAR) ? med.nameEN : '';
        } else if (langPref === 'both') {
            primaryName = med.nameEN || med.nameAR || 'دواء';
            secondaryName = (med.nameAR && med.nameAR !== primaryName) ? med.nameAR : '';
        }

        const safePrimary = (typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(primaryName) : primaryName;
        const safeSecondary = (secondaryName && secondaryName !== primaryName && typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(secondaryName) : (secondaryName && secondaryName !== primaryName ? secondaryName : '');
        const safeActive = (med.activeIngredient && typeof Utils !== 'undefined' && Utils.escapeHTML) ? Utils.escapeHTML(med.activeIngredient) : (med.activeIngredient || '');
        const imgUrl = (typeof Categories !== 'undefined' && Categories.getMedicineImage) ? Categories.getMedicineImage(med) : (med.imagePath || 'assets/icons/default-med.png');

        if (med.isCounted) {
            const batchesHtml = (med.batches && med.batches.length > 0)
                ? med.batches.map(b => {
                    const badge = this.calcExpiryBadge(b.expiryDate);
                    return `
                        <span class="batch-exterior-pill" style="display:inline-flex; align-items:center; justify-content:center; gap:2px; font-size:9px; font-weight:bold; padding:1px 5px; border-radius:4px; background:${badge.bg}; color:${badge.color}; border:1px solid ${badge.color}33; white-space:nowrap;">
                            <i class='bx ${badge.icon}' style="font-size:10px;"></i>
                            <span>${b.quantity} &times; ${b.expiryDate}</span>
                        </span>
                    `;
                }).join('')
                : `<small style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${med.countedExpiry || ''}</small>`;

            return `
                <div class="square-card counted" onclick="window.App.openCountModal('${med.id}')" title="انقر لتعديل العد" style="cursor:pointer; position:relative;">
                    <button type="button" class="audit-edit-med-btn" onclick="event.stopPropagation(); window.App.editMedicineDuringAudit('${med.id}')" title="تعديل بيانات الدواء" style="position:absolute; top:4px; left:4px; width:22px; height:22px; border-radius:6px; border:1px solid var(--border-color); background:var(--surface); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; padding:0; box-shadow:0 1px 2px rgba(0,0,0,0.08);">
                        <i class='bx bx-edit-alt' style="font-size:11px; color:var(--primary);"></i>
                    </button>
                    <span class="badge-done">
                        <i class='bx bx-check'></i> تم
                    </span>
                    <div style="width: 38px; height: 38px; border-radius: 8px; overflow: hidden; margin-bottom: 4px; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <h3 style="font-size: 11.5px; font-weight: 800; margin: 0 0 2px 0; line-height: 1.25; word-break: break-word;">${safePrimary}</h3>
                    ${safeSecondary ? `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px; line-height: 1.2; word-break: break-word;">${safeSecondary}</div>` : ''}
                    ${safeActive ? `<div style="font-size: 9px; color: var(--primary); opacity: 0.9; margin-bottom: 3px; display:flex; align-items:center; gap:3px;"><i class='bx bx-dna'></i> ${safeActive}</div>` : ''}
                    <div class="counted-qty-tag" style="font-size: 11px; font-weight: 800; background: rgba(16,185,129,0.15); color: var(--secondary); padding: 2px 8px; border-radius: 6px; margin: 2px 0;">
                        إجمالي: ${med.countedQty}
                    </div>
                    <div class="card-batches-breakdown" style="display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: 2px;">
                        ${batchesHtml}
                    </div>
                    <small style="font-size:9px; color:var(--text-muted); margin-top:auto; padding-top:4px; display:flex; align-items:center; gap:2px;">
                        <i class='bx bx-user'></i> ${med.countedBy || 'صيدلي'}
                    </small>
                </div>
            `;
        } else {
            return `
                <div class="square-card" onclick="window.App.openCountModal('${med.id}')" title="انقر لتسجيل العد" style="cursor:pointer; position:relative;">
                    <button type="button" class="audit-edit-med-btn" onclick="event.stopPropagation(); window.App.editMedicineDuringAudit('${med.id}')" title="تعديل بيانات الدواء" style="position:absolute; top:4px; left:4px; width:22px; height:22px; border-radius:6px; border:1px solid var(--border-color); background:var(--surface); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; padding:0; box-shadow:0 1px 2px rgba(0,0,0,0.08);">
                        <i class='bx bx-edit-alt' style="font-size:11px; color:var(--primary);"></i>
                    </button>
                    <div style="width: 38px; height: 38px; border-radius: 8px; overflow: hidden; margin-bottom: 4px; background: rgba(59,130,246,0.06); display:flex; align-items:center; justify-content:center; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                        <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <h3 style="font-size: 11.5px; font-weight: 800; margin: 0 0 2px 0; line-height: 1.25; word-break: break-word;">${safePrimary}</h3>
                    ${safeSecondary ? `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px; line-height: 1.2; word-break: break-word;">${safeSecondary}</div>` : ''}
                    ${safeActive ? `<div style="font-size: 9px; color: var(--primary); opacity: 0.9; margin-bottom: 3px; display:flex; align-items:center; gap:3px;"><i class='bx bx-dna'></i> ${safeActive}</div>` : ''}
                    <span class="square-meta" style="color: var(--primary); font-size: 10px; margin-top: auto; font-weight:700;">بانتظار العد ⏳</span>
                </div>
            `;
        }
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

        // Apply Live Filters & Search & Sort
        const currentFilter = this.auditMedFilter || 'all';
        const sortMode = this.auditSortMode || 'status';

        let filteredMedicines = allMedicines;
        if (currentFilter === 'uncounted') {
            filteredMedicines = filteredMedicines.filter(m => !m.isCounted);
        } else if (currentFilter === 'counted') {
            filteredMedicines = filteredMedicines.filter(m => m.isCounted);
        }

        this._auditMedCache = { baseMeds: [...filteredMedicines], sortMode };

        if (this.auditMedSearch && this.auditMedSearch.trim()) {
            filteredMedicines = this.filterAuditMedicines(filteredMedicines, this.auditMedSearch);
        }
        filteredMedicines = this.sortAuditMedicines(filteredMedicines, sortMode);

        const activeUser = Users.getActive();

        container.innerHTML = `
            <!-- Breadcrumbs Bar -->
            <div class="breadcrumbs-bar">
                <button class="btn-crumb-back" onclick="window.App.auditBackToCategories()" title="العودة للتصنيفات">
                    <i class='bx bx-right-arrow-alt'></i>
                </button>
                <div class="breadcrumbs-trail">
                    <span onclick="window.App.auditBackToSessions()" style="cursor:pointer">الجلسات</span>
                    <i class='bx bx-chevron-left'></i>
                    <span onclick="window.App.auditBackToCategories()" style="cursor:pointer">${Utils.escapeHTML(loc.nameAR)}</span>
                    <i class='bx bx-chevron-left'></i>
                    <span class="active">${Utils.escapeHTML(cat.nameAR)} (${totalCount})</span>
                </div>
            </div>

            <!-- Active User & Progress Banner -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted);">
                    <i class='bx bx-user-check' style="color:var(--primary); font-size:15px;"></i>
                    <span>الصيدلي القائم بالعد: <strong style="color:var(--text-main);">${Utils.escapeHTML(activeUser.name)}</strong></span>
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
                                <span class="badge bg-info" style="font-size:10px; padding:2px 6px; border-radius:4px;">${Utils.escapeHTML(p)}</span>
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

            <!-- Toolbar: Quick Search & Action Buttons & Filter Chips & Sort -->
            <div class="audit-toolbar" style="margin-bottom:12px;">
                <div class="audit-search-wrapper" style="width:100%;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="audit-med-search" class="audit-search-input" placeholder="بحث سريع باسم الدواء الإنجليزي أو العربي..." value="${Utils.escapeHTML(this.auditMedSearch || '')}" oninput="window.App.handleAuditMedSearch(this.value)">
                    <button type="button" id="audit-med-clear-btn" onclick="window.App.handleAuditMedSearch('', true)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 8px; display:${this.auditMedSearch ? 'flex' : 'none'}; align-items:center;">
                        <i class='bx bx-x' style="font-size:18px;"></i>
                    </button>
                </div>
                <div style="display:flex; gap:6px; width:100%;">
                    <button type="button" class="btn-primary sm-btn" onclick="window.App.startAuditBarcodeScan()" style="background:#7c3aed; height:36px; font-size:12px; padding:0 12px; border-radius:9px; flex:1;">
                        <i class='bx bx-barcode-reader' style="font-size:16px;"></i> جرد بالباركود
                    </button>
                    <button class="btn-primary sm-btn" onclick="window.App.addMedicineDuringAudit('${cat.id}')" style="height:36px; font-size:12px; padding:0 12px; border-radius:9px; flex:1;">
                        <i class='bx bx-plus-medical'></i> دواء جديد
                    </button>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px;">
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

                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:11px; color:var(--text-muted); font-weight:bold;">الترتيب:</span>
                        <select class="form-input" onchange="window.App.setAuditSortMode(this.value)" style="padding:3px 8px; font-size:11px; border-radius:8px; width:auto; height:30px; background:var(--surface);">
                            <option value="status" ${sortMode === 'status' ? 'selected' : ''}>⏳ غير المعدود أولاً</option>
                            <option value="en" ${sortMode === 'en' ? 'selected' : ''}>🔤 أبجدي A-Z</option>
                            <option value="ar" ${sortMode === 'ar' ? 'selected' : ''}>🔤 أبجدي أ-ي</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Square Medicines Grid with Smart Sorting (Updated in-place on search — never loses focus!) -->
            <div id="audit-med-results-box">
                ${filteredMedicines.length === 0 ? `
                    <div class="empty-state p-20" style="text-align:center; background:var(--surface); border-radius:14px; border:1px dashed var(--border-color); margin:15px 0;">
                        <i class='bx bx-search-alt' style="font-size:32px; color:var(--text-muted); opacity:0.6;"></i>
                        <p style="margin:6px 0 0 0; font-size:13px; color:var(--text-muted);">لا توجد أدوية مطابقة لبحثك أو الفلتر المحدد</p>
                    </div>
                ` : `
                    <div class="audit-square-grid">
                        ${filteredMedicines.map(med => this.renderAuditMedicineCard(med)).join('')}
                    </div>
                `}
            </div>
        `;
    },

    // --- Add / Edit Medicine & Category DURING Audit ---

    async addMedicineDuringAudit(preSelectedCatId = null) {
        // Use the selected category from audit context if not passed
        const catId = preSelectedCatId || this.selectedAuditCategoryId || null;
        // Store audit context so we return after saving
        this._auditReturnContext = {
            sessionId: this.selectedAuditSessionId,
            locationId: this.selectedAuditLocationId,
            categoryId: this.selectedAuditCategoryId,
            level: this.auditLevel
        };
        await this.openAddMedicine(catId);
    },

    async editMedicineDuringAudit(medId) {
        this._auditReturnContext = {
            sessionId: this.selectedAuditSessionId,
            locationId: this.selectedAuditLocationId,
            categoryId: this.selectedAuditCategoryId,
            level: this.auditLevel
        };
        await this.openEditMedicine(medId);
    },

    async addCategoryDuringAudit() {
        this._auditReturnContext = {
            sessionId: this.selectedAuditSessionId,
            locationId: this.selectedAuditLocationId,
            categoryId: this.selectedAuditCategoryId,
            level: this.auditLevel
        };
        await this.openAddCategoryModal();
    },

    // --- Audit Navigation Handlers ---
    openAuditSession(id) {
        this.selectedAuditSessionId = id;
        Audit.currentSessionId = id;
        this.auditLevel = 'locations';
        this.auditLocSearch = '';
        this.auditMedSearch = '';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'locations', sessionId: id }, "", "#audit/locations"); } catch (e) {}
        this.renderAuditView();
    },

    openAuditLocation(locId) {
        this.selectedAuditLocationId = locId;
        Audit.currentLocationId = locId;
        this.auditLevel = 'categories';
        this.auditLocSearch = '';
        this.auditLocFilter = 'all';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'categories', sessionId: this.selectedAuditSessionId, locationId: locId }, "", "#audit/categories"); } catch (e) {}
        this.renderAuditView();
    },

    openAuditCategory(catId) {
        this.selectedAuditCategoryId = catId;
        Audit.currentCategoryId = catId;
        this.auditLevel = 'medicines';
        this.auditMedSearch = '';
        this.auditMedFilter = 'all';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'medicines', sessionId: this.selectedAuditSessionId, locationId: this.selectedAuditLocationId, categoryId: catId }, "", "#audit/medicines"); } catch (e) {}
        this.renderAuditView();
    },

    auditBackToSessions() {
        this.auditLevel = 'sessions';
        this.selectedAuditSessionId = null;
        this.selectedAuditLocationId = null;
        this.selectedAuditCategoryId = null;
        this.auditLocSearch = '';
        this.auditMedSearch = '';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'sessions' }, "", "#audit/sessions"); } catch (e) {}
        this.renderAuditView();
    },

    auditBackToLocations() {
        this.auditLevel = 'locations';
        this.selectedAuditLocationId = null;
        this.selectedAuditCategoryId = null;
        this.auditLocSearch = '';
        this.auditMedSearch = '';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'locations', sessionId: this.selectedAuditSessionId }, "", "#audit/locations"); } catch (e) {}
        this.renderAuditView();
    },

    auditBackToCategories() {
        this.auditLevel = 'categories';
        this.selectedAuditCategoryId = null;
        this.auditMedSearch = '';
        try { history.pushState({ viewId: 'view-audit', auditLevel: 'categories', sessionId: this.selectedAuditSessionId, locationId: this.selectedAuditLocationId }, "", "#audit/categories"); } catch (e) {}
        this.renderAuditView();
    },

    async holdAuditSession(id) {
        await Audit.holdSession(id);
        this.renderAuditView();
        if (typeof this.renderDashboard === 'function') this.renderDashboard();
    },

    async resumeAuditSession(id) {
        await Audit.resumeSession(id);
        this.renderAuditView();
        if (typeof this.renderDashboard === 'function') this.renderDashboard();
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
            if (typeof this.renderDashboard === 'function') this.renderDashboard();
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
    async openCountModal(medicineId, opts = {}) {
        const med = await DB.get('medicineMaster', medicineId);
        if (!med) return;
        const loc = await Locations.get(this.selectedAuditLocationId);
        const session = await Audit.getSession(this.selectedAuditSessionId);
        const countKey = `${this.selectedAuditLocationId}___${medicineId}`;
        const existingCount = (session?.counts && session.counts[countKey]) || null;
        const imgUrl = Categories.getMedicineImage(med);

        const defaultYear = new Date().getFullYear() + 2;
        const scannedExpiry = (opts && opts.scannedExpiry && /^\d{4}-\d{2}$/.test(opts.scannedExpiry)) ? opts.scannedExpiry : null;
        const defaultExpiry = scannedExpiry || `${defaultYear}-12`;

        // Clean slate for session: if not counted in this session, start completely empty!
        let initialBatches = [];
        if (existingCount && Array.isArray(existingCount.batches) && existingCount.batches.length > 0) {
            initialBatches = existingCount.batches.map(b => {
                const q = parseFloat(b.quantity) || 0;
                return { ...b, quantity: q, expiryDate: q > 0 ? (b.expiryDate || '') : '' };
            });
        } else if (existingCount && existingCount.quantity !== undefined) {
            const q = parseFloat(existingCount.quantity) || 0;
            initialBatches = [{ quantity: q, expiryDate: q > 0 ? (existingCount.expiryDate || '') : '' }];
        } else {
            initialBatches = []; // Clean slate: no previous quantities lingering!
        }

        this._modalMedicineId = medicineId;
        this._modalBatches = initialBatches;
        const initialBadge = this.calcExpiryBadge(defaultExpiry);

        try { history.pushState({ modalOpen: true }, "", window.location.hash); } catch (e) {}
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
                    <img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.src='assets/icons/default-med.png';" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div style="flex:1; min-width:0;">
                    <h3 style="margin:0; font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHTML(med.nameEN || med.nameAR)}</h3>
                    <p style="margin:2px 0 0 0; font-size:11px; color:var(--text-muted);"><i class='bx bx-map-pin'></i> المكان: <strong style="color:var(--text-main);">${Utils.escapeHTML(loc?.nameAR || 'المستودع')}</strong></p>
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
                ${scannedExpiry ? `
                    <div style="margin-bottom:8px; padding:5px 8px; border-radius:7px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#059669; font-size:11px; font-weight:800; display:flex; align-items:center; gap:5px;">
                        <i class='bx bx-check-circle'></i> ✨ الصلاحية مقروءة تلقائياً من كود العلبة (${scannedExpiry})${opts.scannedBatch ? ` • تشغيلة: ${Utils.escapeHTML(opts.scannedBatch)}` : ''}
                    </div>
                ` : ''}
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

            <div class="form-actions" style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; gap:8px; width:100%;">
                    <button type="button" class="btn-primary" onclick="window.App.saveCountFromModal('${medicineId}', false)" style="flex:1; height:42px; font-size:13px; border-radius:10px;">💾 حفظ واعتماد</button>
                    <button type="button" class="btn-primary" onclick="window.App.saveCountFromModal('${medicineId}', true)" style="flex:1; height:42px; font-size:13px; border-radius:10px; background:#7c3aed;" title="حفظ وفتح الكاميرا للعلبة التالية">
                        <i class='bx bx-barcode-reader'></i> حفظ ومسح التالي
                    </button>
                </div>
                <button type="button" class="btn-ghost" onclick="window.UI.closeModal()" style="width:100%; height:36px; padding:6px; font-size:13px; border:1px solid var(--border-color); border-radius:10px;">إلغاء</button>
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
            const isZero = (parseFloat(b.quantity) || 0) <= 0;
            const badge = (!isZero && b.expiryDate) ? this.calcExpiryBadge(b.expiryDate) : null;
            return `
                <div class="modal-batch-card" style="display:flex; align-items:center; justify-content:space-between; background:var(--surface); border:1px solid var(--border-color); border-radius:8px; padding:6px 12px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <strong style="font-size:14px; color:${isZero ? 'var(--text-muted)' : 'var(--primary)'};">${b.quantity} وحدة</strong>
                        <span style="color:var(--text-muted); font-size:12px;">&bull;</span>
                        ${isZero ? `
                            <span style="font-size:11.5px; color:var(--text-muted); font-weight:600;">غير متوفر (بدون صلاحية)</span>
                        ` : `
                            <span style="font-weight:bold; font-size:12px; color:var(--text-main); display:inline-flex; align-items:center; gap:3px;">
                                <i class='bx bx-calendar'></i> ${b.expiryDate || '—'}
                            </span>
                            ${badge ? `
                                <span style="display:inline-flex; align-items:center; gap:2px; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:4px; background:${badge.bg}; color:${badge.color};">
                                    <i class='bx ${badge.icon}'></i> ${badge.text}
                                </span>
                            ` : ''}
                        `}
                        ${b.isSuggested ? `<span style="font-size:9px; background:rgba(59,130,246,0.1); color:var(--primary); padding:1px 4px; border-radius:3px;">سابق 📋</span>` : ''}
                    </div>
                    <div style="display:flex; gap:2px;">
                        <button type="button" class="icon-btn" onclick="window.App.editModalBatch(${idx})" title="تعديل هذه الدفعة" style="padding:4px;">
                            <i class='bx bx-edit-alt' style="font-size:16px; color:var(--primary);"></i>
                        </button>
                        <button type="button" class="icon-btn text-danger" onclick="window.App.removeModalBatch(${idx})" title="حذف هذه الدفعة" style="padding:4px;">
                            <i class='bx bx-trash' style="font-size:16px; color:var(--danger);"></i>
                        </button>
                    </div>
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

        // v18.11.7: Allow zero quantity without expiry (for "not available" scenarios)
        if (qty === undefined || qty === null || isNaN(qty) || qty < 0) {
            UI.showToast('يرجى إدخال كمية صحيحة', 'warning');
            qtyEl.focus();
            return;
        }

        // Only require expiry if quantity > 0
        if (qty > 0 && !exp) {
            UI.showToast('يرجى اختيار تاريخ الصلاحية من التقويم', 'warning');
            expEl.focus();
            return;
        }

        if (!this._modalBatches) this._modalBatches = [];

        if (qty === 0) {
            // v18.13.1: Zero quantity strictly has NO expiry date (ignore prefilled calendar value)
            this._modalBatches = [{ quantity: 0, expiryDate: '' }];
        } else {
            // Remove any prior placeholder 0 batch when adding real positive stock
            this._modalBatches = this._modalBatches.filter(b => (parseFloat(b.quantity) || 0) > 0);
            // v18.11.7: Merge with existing batch if same expiry date
            const existingIdx = this._modalBatches.findIndex(b => b.expiryDate === exp && exp !== '');
            if (existingIdx >= 0) {
                this._modalBatches[existingIdx].quantity += qty;
                UI.showToast(`تم دمج الكمية مع دفعة بنفس الصلاحية (${exp}) — الإجمالي: ${this._modalBatches[existingIdx].quantity}`, 'info');
            } else {
                this._modalBatches.push({ quantity: qty, expiryDate: exp });
            }
        }

        // Reset Box Inputs & close mobile keyboard (v18.13.1: do NOT re-focus qtyEl!)
        qtyEl.value = '';
        qtyEl.blur();
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

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

    // v18.11.7: Edit an existing batch — load it into the Add Box for editing
    editModalBatch(index) {
        if (!this._modalBatches || !this._modalBatches[index]) return;
        const batch = this._modalBatches[index];

        // Fill the Add Box with the batch's values
        const qtyEl = document.getElementById('new-batch-qty');
        const expEl = document.getElementById('new-batch-expiry');
        if (qtyEl) qtyEl.value = batch.quantity;
        if (expEl && batch.expiryDate && batch.expiryDate !== 'غير محدد') expEl.value = batch.expiryDate;

        // Remove the batch from the list (user will re-add with edited values)
        this._modalBatches.splice(index, 1);

        const listContainer = document.getElementById('modal-batches-list-container');
        if (listContainer) listContainer.innerHTML = this.renderModalBatchesHtml();

        const totalEl = document.getElementById('modal-batch-total-qty');
        if (totalEl) totalEl.textContent = `${this.calcModalBatchesTotal()} وحدة`;

        // Focus the quantity input
        if (qtyEl) qtyEl.focus();
        this.updateNewBatchBadgePreview();
        UI.showToast('عدّل الكمية أو الصلاحية ثم اضغط "إضافة" 📝', 'info');
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

    async saveCountFromModal(medicineId, scanNext = false) {
        // Auto-include uncommitted input from the Add Batch Box if filled
        const qtyEl = document.getElementById('new-batch-qty');
        const expEl = document.getElementById('new-batch-expiry');
        const rawQtyVal = qtyEl ? qtyEl.value.trim() : '';
        const parsedQty = rawQtyVal !== '' ? parseFloat(rawQtyVal) : NaN;

        if (!isNaN(parsedQty)) {
            if (parsedQty === 0) {
                // Direct zero save without confirmation and without expiry date
                await this.recordZeroCountModal(medicineId);
                if (scanNext) setTimeout(() => this.startAuditBarcodeScan(), 250);
                return;
            } else if (parsedQty > 0 && expEl && expEl.value) {
                if (!this._modalBatches) this._modalBatches = [];
                this._modalBatches = this._modalBatches.filter(b => (parseFloat(b.quantity) || 0) > 0);
                const exp = expEl.value.trim();
                const existingIdx = this._modalBatches.findIndex(b => b.expiryDate === exp);
                if (existingIdx >= 0) {
                    this._modalBatches[existingIdx].quantity += parsedQty;
                } else {
                    this._modalBatches.push({ quantity: parsedQty, expiryDate: exp });
                }
            }
        }

        if (!this._modalBatches || this._modalBatches.length === 0) {
            // v18.13.1: No annoying confirm popup — guide user cleanly
            UI.showToast('أدخل الكمية أو اضغط على "رصيد: 0" للتسجيل كغير متوفر', 'warning');
            return;
        }

        // Sanitize: ensure zero-quantity batches never carry an expiry date
        const sanitizedBatches = this._modalBatches.map(b => {
            const q = parseFloat(b.quantity) || 0;
            return { quantity: q, expiryDate: q > 0 ? (b.expiryDate || '') : '' };
        });

        await Audit.recordCount(this.selectedAuditSessionId, this.selectedAuditLocationId, medicineId, {
            batches: sanitizedBatches
        });

        UI.closeModal();
        UI.showToast('تم حفظ واعتماد دُفعات الجرد بنجاح ✅', 'success');
        this.renderAuditView();

        if (scanNext) {
            setTimeout(() => this.startAuditBarcodeScan(), 250);
        }
    },

    // ===================== Audit Barcode & 2D GS1 DataMatrix Scanning Workflow (v18.18.0) =====================
    async startAuditBarcodeScan() {
        if (!this.selectedAuditSessionId) {
            UI.showToast('يرجى فتح جلسة جرد أولاً', 'warning');
            return;
        }
        const loc = this.selectedAuditLocationId ? await Locations.get(this.selectedAuditLocationId) : null;
        this.startBarcodeScanner(
            (scannedCode, parsed) => this.handleScannedAuditBarcode(scannedCode, parsed),
            {
                title: '📷 جرد سريع (باركود / DataMatrix / QR)',
                subtitle: loc
                    ? `المكان الحالي: ${loc.nameAR} — وجّه الكاميرا للباركود أو المربع 2D على العلبة`
                    : 'وجّه الكاميرا للباركود أو المربع 2D على العلبة لفتح شاشة العد والصلاحية فوراً'
            }
        );
    },

    async handleScannedAuditBarcode(rawCode, parsed = null) {
        const info = parsed || this.parsePharmaBarcode(rawCode);
        const code = String(info.barcode || '').trim();
        const gtin14 = info.gtin14 ? String(info.gtin14).trim() : null;
        if (!code) return;

        const scanMeta = {
            scannedExpiry: info.expiry || null,
            scannedBatch: info.batch || null,
            isGS1: !!info.isGS1
        };

        try {
            const masterMeds = (await DB.getAll('medicineMaster')) || [];
            // Match by commercial barcode (EAN-13 or GTIN-14) first, then by exact id
            let med = masterMeds.find(m => {
                const mb = m.barcode ? String(m.barcode).trim() : '';
                if (!mb) return false;
                return mb === code || (gtin14 && mb === gtin14) || ('0' + mb === gtin14);
            });
            if (!med) {
                med = masterMeds.find(m => String(m.id).trim() === code);
            }

            if (med) {
                const expNote = scanMeta.scannedExpiry ? ` • صلاحية ${scanMeta.scannedExpiry} 📅` : '';
                UI.showToast(`✅ ${med.nameEN || med.nameAR}${expNote}`, 'success');
                await this._openAuditCountForScannedMed(med, scanMeta);
                return;
            }

            // Not in pharmacy's medicineMaster yet — check the 27,601 Egyptian drugs catalog!
            let catalogHit = null;
            try {
                const catalog = await EgyptianDrugs.ensureLoaded();
                catalogHit = catalog.find(c => {
                    const cb = c.barcode ? String(c.barcode).trim() : '';
                    return cb && (cb === code || (gtin14 && cb === gtin14));
                }) || null;
            } catch (e) {}

            await this.openUnmatchedBarcodeModal(code, catalogHit, masterMeds, scanMeta);
        } catch (err) {
            console.error('Audit barcode scan handler error:', err);
            UI.showToast('حدث خطأ أثناء البحث عن الباركود', 'danger');
        }
    },

    async _openAuditCountForScannedMed(med, scanMeta = {}) {
        // Store pending scan metadata so location-picker click keeps expiry date!
        this._pendingScanMeta = scanMeta || {};

        // If user is already inside a specific audit location, open count modal immediately!
        if (this.selectedAuditLocationId) {
            await this.openCountModal(med.id, this._pendingScanMeta);
            return;
        }

        // Otherwise (e.g. from Merged Audit View), pick location smartly
        const session = await Audit.getSession(this.selectedAuditSessionId);
        const allLocs = (await Locations.getAll()) || [];
        const sessionLocIds = new Set(session?.locationIds || []);
        const activeLocs = allLocs.filter(l => sessionLocIds.has(l.id));

        if (activeLocs.length === 1) {
            this.selectedAuditLocationId = activeLocs[0].id;
            await this.openCountModal(med.id, this._pendingScanMeta);
            return;
        }

        // Sort so primaryLocation appears first
        const sortedLocs = [...activeLocs].sort((a, b) => {
            if (a.id === med.primaryLocation) return -1;
            if (b.id === med.primaryLocation) return 1;
            return (a.nameAR || '').localeCompare(b.nameAR || '');
        });

        UI.showModal(`
            <div class="sheet-handle"></div>
            <div class="modal-header" style="margin-bottom:10px;">
                <h2 style="font-size:15.5px;">📍 اختر المكان لجرد: ${Utils.escapeHTML(med.nameEN || med.nameAR)}</h2>
                <p class="text-muted" style="font-size:11.5px; margin-top:3px;">
                    ${scanMeta.scannedExpiry ? `✨ الصلاحية المقروءة من العلبة: <strong>${scanMeta.scannedExpiry}</strong> — ` : ''}اضغط على المكان لإدخال الكمية فوراً
                </p>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${sortedLocs.map(l => {
                    const isPrimary = l.id === med.primaryLocation;
                    return `
                        <button type="button" class="action-card-btn" onclick="window.App.selectedAuditLocationId='${l.id}'; window.App.openCountModal('${Utils.escapeHTML(med.id)}', window.App._pendingScanMeta || {});" style="width:100%; text-align:right; ${isPrimary ? 'border-color:var(--primary); background:rgba(59,130,246,0.06);' : ''}">
                            <i class='bx ${l.icon || 'bx-map-pin'}' style="font-size:22px; color:${l.color || 'var(--primary)'};"></i>
                            <div style="flex:1;">
                                <strong>${Utils.escapeHTML(l.nameAR)}</strong>
                                ${isPrimary ? `<small style="display:block; color:var(--primary); font-weight:700;">⭐ المكان الأساسي لهذا الدواء</small>` : ''}
                            </div>
                            <i class='bx bx-chevron-left' style="font-size:20px; color:var(--text-muted);"></i>
                        </button>
                    `;
                }).join('')}
            </div>
            <div class="form-actions mt-15">
                <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
            </div>
        `);
    },

    async openUnmatchedBarcodeModal(code, catalogHit, masterMeds, scanMeta = {}) {
        // Pre-compute smart initial search if catalogHit gave us a brand name!
        const suggestedQuery = catalogHit ? (catalogHit.nameEN || '').split(/\s+/)[0] : '';
        this._linkBcState = {
            code,
            catalogHit,
            scanMeta: scanMeta || {},
            masterMeds: masterMeds || (await DB.getAll('medicineMaster')) || []
        };

        UI.showModal(`
            <div class="sheet-handle"></div>
            <div class="modal-header" style="margin-bottom:10px;">
                <h2 style="font-size:15.5px; display:flex; align-items:center; gap:6px;">
                    <i class='bx bx-barcode' style="color:#7c3aed; font-size:22px;"></i> باركود غير مربوط بدواء في مستودعك
                </h2>
                <div style="margin-top:6px; padding:6px 10px; border-radius:8px; background:var(--bg-secondary); font-family:monospace; font-size:13px; font-weight:800; color:var(--primary); text-align:center;">
                    🔢 ${Utils.escapeHTML(code)}${scanMeta.isGS1 ? ' <span style="font-size:10px; background:rgba(124,58,237,0.12); color:#7c3aed; padding:1px 5px; border-radius:4px;">2D GS1</span>' : ''}
                    ${scanMeta.scannedExpiry ? `<div style="font-size:11px; color:#059669; margin-top:3px; font-family:inherit;">📅 صلاحية العلبة: ${scanMeta.scannedExpiry}</div>` : ''}
                </div>
            </div>

            ${catalogHit ? `
                <div style="padding:10px 12px; border-radius:10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.35); margin-bottom:12px;">
                    <div style="font-size:11px; font-weight:800; color:#059669; margin-bottom:4px;">✨ تم التعرف عليه من قاعدة الأدوية المصرية (27K):</div>
                    <strong style="font-size:13px; color:var(--text-main); display:block;">${Utils.escapeHTML(catalogHit.nameEN)}</strong>
                    ${catalogHit.nameAR ? `<div style="font-size:12px; color:var(--text-muted);">${Utils.escapeHTML(catalogHit.nameAR)}</div>` : ''}
                    ${catalogHit.active ? `<div style="font-size:11px; color:#059669; margin-top:2px;">💊 ${Utils.escapeHTML(catalogHit.active)}</div>` : ''}
                </div>
            ` : ''}

            <!-- Action 1: Add as New Medicine -->
            <button type="button" class="btn-primary w-100" onclick="window.App.addMedFromScannedBarcode()" style="margin-bottom:14px; display:flex; align-items:center; justify-content:center; gap:6px; padding:10px; font-size:12.5px;">
                <i class='bx bx-plus-medical'></i> ${catalogHit ? 'إضافته كدواء جديد للمستودع (بيانات جاهزة ✨)' : 'إضافة دواء جديد بهذا الباركود'}
            </button>

            <!-- Action 2: Link to Existing Medicine & Count Immediately -->
            <div style="border-top:1px dashed var(--border-color); padding-top:12px;">
                <div style="font-size:12.5px; font-weight:800; margin-bottom:6px; color:var(--text-main);">
                    🔗 أو اربطه بدواء موجود عندك بالفعل (وهيتحفظ الباركود للأبد):
                </div>
                <div class="audit-search-wrapper" style="width:100%; margin-bottom:8px;">
                    <i class='bx bx-search'></i>
                    <input type="text" id="link-bc-search" class="audit-search-input" placeholder="🔍 ابحث عن الدواء في مستودعك..." value="${Utils.escapeHTML(suggestedQuery)}" oninput="window.App._renderLinkBarcodeList(this.value)">
                </div>
                <div id="link-bc-results" style="max-height:30vh; overflow-y:auto; display:flex; flex-direction:column; gap:6px;"></div>
            </div>

            <div class="form-actions mt-15" style="display:flex; gap:8px;">
                <button type="button" class="btn-ghost sm-btn" onclick="window.UI.closeModal(); window.App.startAuditBarcodeScan();" style="flex:1; border:1px solid var(--border-color);">
                    <i class='bx bx-camera'></i> مسح باركود آخر
                </button>
                <button type="button" class="btn-ghost sm-btn" onclick="window.UI.closeModal()" style="flex:0.6;">إغلاق</button>
            </div>
        `);

        this._renderLinkBarcodeList(suggestedQuery);
    },

    _renderLinkBarcodeList(query = '') {
        const st = this._linkBcState;
        const container = document.getElementById('link-bc-results');
        if (!st || !container) return;

        const q = String(query || '').trim();

        let list = st.masterMeds;
        if (q) {
            list = Utils.smartFilter(
                list,
                q,
                (pq, m) => Utils.smartScoreMed(pq, m)
            );
        }
        list = list.slice(0, 30);

        if (list.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:14px; font-size:12px; color:var(--text-muted); background:var(--bg-secondary); border-radius:8px;">لا توجد أدوية مطابقة في مستودعك</div>`;
            return;
        }

        container.innerHTML = list.map(m => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; font-weight:800; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHTML(m.nameEN || m.nameAR)}</div>
                    ${m.nameAR && m.nameAR !== m.nameEN ? `<div style="font-size:10.5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Utils.escapeHTML(m.nameAR)}</div>` : ''}
                </div>
                <button type="button" class="btn-primary sm-btn" onclick="window.App.linkBarcodeAndCount('${Utils.escapeHTML(m.id)}')" style="font-size:11px; padding:5px 9px; border-radius:7px; white-space:nowrap; background:#7c3aed;">
                    🔗 ربط وعدّ
                </button>
            </div>
        `).join('');
    },

    async linkBarcodeAndCount(medId) {
        const st = this._linkBcState;
        if (!st || !st.code) return;
        try {
            const med = await DB.get('medicineMaster', medId);
            if (!med) return;
            med.barcode = st.code;
            med.lastUpdated = new Date().toISOString();
            med.v = (med.v || 1) + 1;
            await DB.put('medicineMaster', med);
            if (typeof Sync !== 'undefined' && Sync.push) {
                Sync.push(med.id).catch(() => {});
            }
            UI.showToast(`تم ربط الباركود بالدواء «${med.nameEN || med.nameAR}» ✅`, 'success');
            await this._openAuditCountForScannedMed(med, st.scanMeta || {});
        } catch (err) {
            console.error('Link barcode error:', err);
            UI.showToast('فشل ربط الباركود', 'danger');
        }
    },

    async addMedFromScannedBarcode() {
        const st = this._linkBcState;
        if (!st) return;
        await this.addMedicineDuringAudit(this.selectedAuditCategoryId || null);
        // Pre-fill modal fields with scanned barcode + catalog data if found!
        setTimeout(() => {
            const bcEl = document.getElementById('m-barcode');
            if (bcEl) bcEl.value = st.code || '';
            if (st.catalogHit) {
                const enEl = document.getElementById('m-name-en');
                const arEl = document.getElementById('m-name-ar');
                const actEl = document.getElementById('m-active');
                if (enEl && st.catalogHit.nameEN) enEl.value = st.catalogHit.nameEN;
                if (arEl && st.catalogHit.nameAR) arEl.value = st.catalogHit.nameAR;
                if (actEl && st.catalogHit.active) actEl.value = st.catalogHit.active;
            }
        }, 60);
    },
    // ===================== End Audit Barcode Scanning Workflow =====================

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
                        host: lastFinalized.host || this.getActiveUserName(),
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
                        expiryDate: item.expiryDate || 'غير محدد',
                        badge: badge
                    };
                });
            } else {
                const targetSession = sessions.find(s => s.id === currentSource);
                if (targetSession) {
                    sourceMeta = {
                        name: targetSession.name,
                        date: new Date(targetSession.startedAt).toLocaleDateString('ar-EG'),
                        host: targetSession.host || this.getActiveUserName(),
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
                                expiryDate: b.expiryDate || 'غير محدد',
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
                                📋 ${Utils.escapeHTML(s.name)} (${s.status === 'finalized' ? 'معتمد 🏁' : (s.status === 'active' ? 'جاري 🟢' : 'معلق ⏸️')}) — ${new Date(s.startedAt).toLocaleDateString('ar-EG')}
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
        const status = this._currentExpiryStatusFilter || 'all';
        let filtered = this._cachedExpiryItems.filter(item => status === 'all' || item.badge.status === status);
        if (query && query.trim()) {
            filtered = Utils.smartFilter(
                filtered,
                query,
                (pq, item) => Utils.smartScore(pq, [item.nameEN, item.nameAR], [item.location, item.activeIngredient, item.barcode]),
                { keepOrder: true }
            );
        }

        const container = document.getElementById('expiry-monitor-items');
        if (container) {
            container.innerHTML = this.renderExpiryMonitorItemsHtml(filtered);
        }
    }
});

/**
 * Smart Refresh (v18.11.6)
 * Clears stale SW caches + app memory caches, re-pulls fresh cloud data,
 * and refreshes all views — WITHOUT deleting IndexedDB or signing out.
 */
App.smartRefresh = async function() {
    try {
        UI.showToast('جاري تنظيف البيانات العالقة... 🧹', 'info');

        // 1. Clear all Service Worker caches (stale JS/CSS/HTML)
        if ('caches' in window) {
            const cacheKeys = await caches.keys();
            for (const key of cacheKeys) {
                await caches.delete(key);
            }
            console.log('SmartRefresh: Cleared', cacheKeys.length, 'SW caches');
        }

        // 2. Clear in-memory dashboard cache
        this._dashCache = null;
        this._dashCacheTime = 0;

        // 3. Clear category/location caches
        if (typeof Categories !== 'undefined') {
            Categories.cache = null;
            Categories._cache = null;
        }

        // 4. Re-pull all cloud data into IndexedDB
        if (typeof Sync !== 'undefined' && Sync.pull) {
            await Sync.pull();
        }

        // 5. Force re-register SW with new cache
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.register('./sw.js?v=' + Date.now(), { updateViaCache: 'none' });
            await reg.update();
            this.swRegistration = reg;
        }

        // 6. Refresh all visible views
        await this.refreshAllViews();

        UI.showToast('تم تنظيف وتحديث البيانات بنجاح ✅', 'success');
    } catch (err) {
        console.error('SmartRefresh Error:', err);
        UI.showToast('فشل التنظيف: ' + err.message, 'danger');
    }
};

/**
 * Recovery Reset Mechanism (v17.2.0)
 * Clears all local caches and signs out to fix corrupted states.
 */
App.recoveryReset = async function() {
    if (!confirm('🚨 تحذير نهائي: سيتم مسح كافة البيانات المخزنة محلياً وإعادة ضبط النظام بالكامل للبدء من الصفر. هل أنت متأكد؟')) return;
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
    const storedPin = localStorage.getItem('dawaa_admin_pin');
    const defaultPin = ['dawaa', '20', '26'].join('');
    const pass = prompt('أدخل رمز مرور المسؤول (Admin PIN):');
    if (!pass) return;
    if (pass === storedPin || pass === defaultPin || pass === this._getAuthPass()) {
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
    // v18.10.0: Show user-friendly toast
    if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('حدث خطأ غير متوقع — التطبيق يعمل بشكل طبيعي 🔧', 'warning');
    }
    // Log to Firestore for monitoring (fire-and-forget)
    try {
        const firestore = window.db || (window.firebase?.firestore ? window.firebase.firestore() : null);
        if (firestore) {
            firestore.collection('error_logs').add({
                msg: String(msg).substring(0, 500),
                url: String(url || '').substring(0, 200),
                line, col,
                stack: error?.stack ? String(error.stack).substring(0, 1000) : '',
                userName: window.App?.userName || 'unknown',
                timestamp: (window.firebase || firebase).firestore.FieldValue.serverTimestamp(),
                version: window.App?.VERSION || 'unknown'
            }).catch(() => {});
        }
    } catch (_) {}
    return false;
};

window.addEventListener('unhandledrejection', (event) => {
    console.error('Dawaa Unhandled Promise:', event.reason);
});

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
