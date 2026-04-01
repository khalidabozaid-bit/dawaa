import { DB } from './core/db.js';
import { UI } from './core/ui.js';
import { Inventory } from './features/inventory.js';
import { Categories } from './features/categories.js';
import { Exporter } from './features/export.js';
import { Utils } from './core/utils.js';
import { Sync } from './core/sync.js';
import { auth, db, storage } from './core/firebase-config.js';

/**
 * Dawaa App Orchestrator (v9.9.6 - Unified Visualizer)
 * Cloud Storage & Intelligent Push Enabled.
 */

const App = {
    inventoryTab: 'detailed',
    selectedCategoryId: null, 

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




    async init() {
        console.log('Dawaa App: Booting with Auth (v9.0.0)...');
        window.App = App;
        window.UI = UI;

        // Initialize Services
        await DB.init();
        await Categories.seedInitialData();
        UI.init();
        this.registerServiceWorker();

        // Auth Monitor (The Heart of v9.0.0)
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log('Auth: User active:', user.email);
                await this.handleUserSession(user);
            } else {
                console.log('Auth: No session found.');
                this.showLogin();
            }
        });

        // Navigation & Hardware Back Button (Mashawiri Style)
        window.onpopstate = (event) => {
            const container = document.getElementById('modal-container');
            if (container && container.classList.contains('show')) {
                UI.closeModal();
                history.pushState(event.state, "", window.location.hash); // Keep state to allow second back button
                return;
            }

            if (event.state && event.state.viewId) {
                UI.switchView(event.state.viewId, false); // Switch without pushing new state
            } else {
                UI.switchView('view-dashboard', false);
            }
        };

        // Initialize first state
        history.replaceState({ viewId: 'view-dashboard' }, "", "#dashboard");

        // Service Worker Management (Mashawiri Style)
        this.initServiceWorker();
    },

    initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('SW: Registered.');
            this.swRegistration = reg; // Store globally

            // Silence checking logic (v9.8.5)
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('SW: Update available (Digital Silence).');
                    }
                });
            });
        });

        // Listen for the skipWaiting trigger to reload
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
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                await db.collection('users').doc(user.uid).set(profile);
                profileDoc = await db.collection('users').doc(user.uid).get();
                localStorage.removeItem('dawaa-temp-name');
            }

            const profile = profileDoc.data();
            
            // 3. Set App Context (v9.9.0)
            this.user = profile;
            this.userRole = profile.role;

            
            // 4. Update UI
            document.getElementById('display-user-name').textContent = profile.displayName || profile.email;
            this.hideLogin();
            this.renderDashboard();
            this.updateAdminUI();
            
            // 5. Initial Pull (Automatic)
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
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    console.log('SW: Registered.');
                }).catch(err => console.error('SW: Registration Error.', err));
            });
        }
    },

    // Service Worker update logic moved to App.checkUpdate (v9.9.7 Architect)


    // --- View Renderers ---

    async renderDashboard() {
        try {
            const inventory = await DB.getAll('inventory');
            const sixMonthsAway = new Date();
            sixMonthsAway.setMonth(sixMonthsAway.getMonth() + 6);

            const stats = {
                totalItems: inventory.length,
                lowStockCount: inventory.filter(i => i.quantity <= 5).length,
                expiringCount: inventory.filter(i => i.expiryDate && new Date(i.expiryDate) <= sixMonthsAway).length
            };

            UI.updateDashboardStats(stats);
            // Categories and Inventory list removed from dashboard for a 'Clean' look (v6.3)
        } catch (err) {
            console.error(err);
        }
    },

    async renderInventory(type = 'detailed') {
        try {
            const container = document.getElementById('inventory-list');
            if (!container) return;

            this.renderCategoryChips(); // Refresh filters

            let data = await DB.getAll('inventory');
            const masterData = await DB.getAll('medicineMaster');
            const masterMap = new Map(masterData.map(m => [m.id, m]));
            
            // 1. Initial Filtering by Type
            if (type === 'expiry') {
                const sixMonths = new Date();
                sixMonths.setMonth(sixMonths.getMonth() + 6);
                data = data.filter(i => i.expiryDate && new Date(i.expiryDate) <= sixMonths);
            } else if (type === 'low-stock') {
                data = await Inventory.getAggregatedStock();
                data = data.filter(i => (i.totalQuantity || 0) <= 5);
            }

            // 2. Secondary Filtering by Category (Efficiency Protocol)
            if (this.selectedCategoryId) {
                data = data.filter(i => {
                    const m = masterMap.get(i.medicineId || i.id);
                    return m && m.categoryId === this.selectedCategoryId;
                });
            }

            this.renderInventoryList(data, 'inventory-items-list', type === 'low-stock');
        } catch (err) {
            console.error('Inventory Render Error:', err);
        }
    },


    async renderCategoryChips() {
        const container = document.getElementById('category-chips');
        if (!container) return;

        try {
            const cats = await Categories.getAllSorted();
            container.innerHTML = `
                <div class="category-chip ${!this.selectedCategoryId ? 'active' : ''}" onclick="window.App.filterByCategory(null)">
                    <i class='bx bx-category'></i> <span>الكل</span>
                </div>
                ${cats.map(c => `
                    <div class="category-chip ${this.selectedCategoryId === c.id ? 'active' : ''}" onclick="window.App.filterByCategory('${c.id}')">
                        <i class='bx ${c.icon}'></i> <span>${c.nameAR}</span>
                    </div>
                `).join('')}
            `;
        } catch (err) {
            console.error(err);
        }
    },

    filterByCategory(catId) {
        this.selectedCategoryId = catId;
        this.renderInventory();
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

    async renderMasterData() {
        try {
            const container = document.getElementById('master-items-list');
            if (!container) return;

            const master = await DB.getAll('medicineMaster');
            const cats = await Categories.getAllSorted();
            const catMap = new Map(cats.map(c => [c.id, c]));

            if (master.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>لا يوجد بيانات أدوية</p></div>';
                return;
            }

            container.innerHTML = master.sort((a, b) => (a.id || '').localeCompare(b.id || '')).map(m => {
                const cat = catMap.get(m.categoryId) || { nameAR: m.categoryId, icon: 'bx-package', color: '#64748b' };
                const hasImg = m.imagePath && m.imagePath.includes('base64');
                const isGlobal = m.syncStatus === 'global';
                const isAdmin = this.userRole === 'admin';
                
                return `
                    <div class="inventory-card ${isGlobal ? 'status-safe' : 'status-warning'}">
                        <span class="sync-badge ${isGlobal ? 'global' : 'local'}">
                            <i class='bx ${isGlobal ? 'bx-cloud-check' : 'bx-time-five'}'></i>
                        </span>
                        <div class="card-img">
                            ${hasImg ? `<img src="${m.imagePath}">` : `<div class="default-med-icon mini"><i class='bx bx-capsule'></i></div>`}
                        </div>
                        <div class="card-info">
                            <h3>${m.nameEN} <span class="ar-name">/ ${m.nameAR || ''}</span></h3>
                            <div class="card-meta">
                                <span><i class='bx bx-barcode'></i> ${m.id}</span>
                                <span><i class='bx bx-purchase-tag-alt'></i> ${cat.nameAR}</span>
                            </div>
                        </div>
                        <div class="card-actions-float">
                            ${isAdmin && !isGlobal ? `<button class="icon-btn sync-btn" onclick="window.Sync.push('${m.id}')" title="نشر عالمي"><i class='bx bx-cloud-upload'></i></button>` : ''}
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
            const medicines = await Categories.getMedicinesByCategoryId(catId);
            const info = await Categories.getInfo(catId);

            UI.showModal(`
                <div class="modal-header">
                    <h2>${info.nameAR}</h2>
                    <div class="header-btns">
                        <button class="btn-primary sm-btn" onclick="window.App.openTransferMedicine('${catId}')">➕ إضافة / نقل</button>
                    </div>
                </div>
                <div class="medicine-selection-grid">
                    ${medicines.map(m => {
                        const hasImage = m.imagePath && m.imagePath.includes('base64');
                        const imgSrc = hasImage ? m.imagePath : '';
                        return `
                            <div class="med-card-btn" onclick="window.App.openEntryForm('${m.id}')">
                                <div class="med-image">
                                    ${hasImage ? `<img src="${imgSrc}">` : `<div class="default-med-icon"><i class='bx bx-capsule'></i></div>`}
                                </div>
                                <div class="med-info-overlay">
                                    <h4>${m.nameEN} <span class="med-id-badge">#${m.id}</span></h4>
                                    <span class="med-active-sub">${m.activeIngredient || ''}</span>
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
            const allMeds = await DB.getAll('medicineMaster');
            const medicines = allMeds
                .filter(m => m.categoryId === catId)
                .sort((a, b) => (a.nameEN || '').localeCompare(b.nameEN || '')); // Alphabetic Sort (v6.6.2)
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
                    <button class="btn-ghost" onclick="window.App.openCategory('${targetCatId}')">رجوع</button>
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
                        <span class="search-sub">من قسم: ${m.categoryId}</span>
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
            await DB.put('medicineMaster', med);
            
            UI.showToast(`تم نقل ${med.nameEN} بنجاح`, 'success');
            this.openCategory(targetCatId); // Refresh category view
        } catch (err) {
            UI.showToast('فشل عملية النقل', 'danger');
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
            UI.showModal(`
                <div class="sheet-handle"></div>
                <div class="modal-header"><h2>إضافة جرد جديد ( Stock Entry )</h2></div>
                <form id="form-inventory" onsubmit="event.preventDefault(); window.App.saveEntry('${medicineId}');">
                    <div class="form-group">
                        <label class="form-label">ابحث عن الدواء/المستلزم:</label>
                        <input type="text" class="form-input" value="${med.nameEN}" readonly>
                        <button type="button" class="text-btn" style="text-align:right" onclick="window.App.openAddMedicine()">+ غير مسجل؟ أضفه الآن</button>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">المكان:</label>
                            <input type="text" id="entry-location" class="form-input" placeholder="مثلاً: الثلاجة، الرف A" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">الكمية:</label>
                            <input type="number" id="entry-qty" class="form-input" value="0" required>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">تاريخ الصلاحية:</label>
                        <input type="month" id="entry-expiry" class="form-input" required>
                    </div>

                    <div class="form-actions mt-20">
                        <button type="submit" class="btn-primary">حفظ الجرد</button>
                        <button type="button" class="btn-ghost" onclick="window.UI.closeModal()">إلغاء</button>
                    </div>
                </form>
            `);
        } catch (err) {
            UI.showToast('خطأ في تحميل النموذج', 'danger');
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

                    <div class="form-group">
                        <label class="form-label">الاسم بالإنجليزية:</label>
                        <input type="text" id="m-name-en" class="form-input" placeholder="e.g. Panadol Extra" required>
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
            this.renderMasterData();

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
            this.renderMasterData();

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



    async deleteMasterMedicine(id) {
        if (confirm('هل أنت متأكد؟ سيتم حذف الصنف من المستودع نهائياً.')) {
            try {
                await Categories.deleteMedicine(id);
                UI.showToast('تم الحذف', 'info');
                UI.closeModal();
                this.renderMasterData();
            } catch (err) {
                UI.showToast(err.message, 'danger');
            }
        }
    },

    async saveEntry(medicineId) {
        try {
            const data = {
                medicineId,
                location: document.getElementById('entry-location').value.trim(),
                quantity: parseFloat(document.getElementById('entry-qty').value) || 0,
                expiryDate: document.getElementById('entry-expiry').value,
                dateAdded: new Date().toISOString()
            };

            await Inventory.addEntry(data);
            UI.showToast('تم حفظ الجرد بنجاح', 'success');
            UI.closeModal();
            UI.renderCurrentView();
        } catch (err) {
            UI.showToast('فشل حفظ الجرد', 'danger');
        }
    },

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
        if (!query) {
            this.selectedCategoryId = null; // Clear filter on empty search
            return this.renderInventory();
        }

        try {
            const inventory = await DB.getAll('inventory');
            const masterData = await DB.getAll('medicineMaster');
            const masterMap = new Map(masterData.map(m => [m.id, m]));
            
            // 1. Filter Inventory
            const filteredInventory = inventory.filter(i => {
                const m = masterMap.get(i.medicineId);
                return m && (
                    m.nameEN.toLowerCase().includes(query.toLowerCase()) || 
                    (m.nameAR && m.nameAR.includes(query)) ||
                    (m.activeIngredient && m.activeIngredient.toLowerCase().includes(query.toLowerCase()))
                );
            });

            // 2. If results are low, search Master Data (Smart Lookup)
            let masterResults = [];
            if (filteredInventory.length < 5) {
                masterResults = masterData.filter(m => 
                    m.nameEN.toLowerCase().includes(query.toLowerCase()) || 
                    (m.nameAR && m.nameAR.includes(query))
                ).filter(m => !filteredInventory.some(i => i.medicineId === m.id));
            }

            this.renderSearchResults(filteredInventory, masterResults.slice(0, 5), masterMap);
        } catch (err) {
            console.error(err);
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
        if (!query) return this.renderMasterData();
        try {
            const results = await Categories.searchMaster(query);
            const container = document.getElementById('master-items-list');
            if (!container) return;

            const cats = await Categories.getAllSorted();
            const catMap = new Map(cats.map(c => [c.id, c]));
            
            container.innerHTML = results.map(m => {
                const cat = catMap.get(m.categoryId) || { nameAR: m.categoryId, icon: 'bx-package', color: '#ccc' };
                const imgSrc = Categories.getMedicineImage(m, cat);
                return `
                    <div class="inventory-card">
                        <div class="card-img mini"><img src="${imgSrc}" onerror="this.src='assets/icons/default-med.png'"></div>
                        <div class="card-info">
                            <h3>${m.nameEN}</h3>
                            <p class="card-meta"><span>${m.activeIngredient || ''}</span></p>
                        </div>
                        <div class="card-actions-float">
                            <button class="icon-btn" onclick="window.App.openEditMedicine('${m.id}')"><i class='bx bx-edit-alt'></i></button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error(err);
        }
    },

    openQuickAdd() {
        UI.showModal(`
            <div class="modal-header"><h2>جرد سريع</h2></div>
            <div class="search-bar mb-20">
                <i class='bx bx-search'></i>
                <input type="text" placeholder="ابحث باسم الدواء..." oninput="window.App.handleQuickSearch(this.value)">
            </div>
            <div id="quick-search-results" class="items-list mini"></div>
            <button class="btn-ghost mt-20" onclick="window.UI.closeModal()">إلغاء</button>
        `);
    },

    async handleQuickSearch(val) {
        if (!val) { document.getElementById('quick-search-results').innerHTML = ''; return; }
        try {
            const results = await Categories.searchMaster(val);
            const container = document.getElementById('quick-search-results');
            if (!container) return;
            
            container.innerHTML = results.slice(0, 5).map(m => `
                <div class="search-result-item" onclick="window.App.openEntryForm('${m.id}')">
                    <i class='bx bx-capsule'></i>
                    <div class="search-info">
                        <span class="search-name">${m.nameEN}</span>
                        <span class="search-sub">${m.activeIngredient || ''}</span>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            console.error(err);
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
};
window.handleSearch = (query) => App.handleGlobalSearch(query);
window.toggleTheme = () => {
    UI.toggleTheme();
    if (typeof UI.updateSettingsIcons === 'function') UI.updateSettingsIcons();
};

// --- Settings Logic ---
App.handleBackup = async function() {
    try {
        UI.showToast('جاري تحضير الملف...', 'info');
        const data = {
            categories: await DB.getAll('categories'),
            medicineMaster: await DB.getAll('medicineMaster'),
            inventory: await DB.getAll('inventory'),
            exportDate: new Date().toISOString(),
            version: '9.8.0'
        };







        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dawaa_backup_${new Date().toISOString().split('T')[0]}.dawaa`;
        a.click();
        URL.revokeObjectURL(url);
        UI.showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (err) {
        UI.showToast('فشل التصدير: ' + err.message, 'danger');
    }
};

App.handleRestore = async function(input) {
    if (!input.files || !input.files[0]) return;
    if (!confirm('تحذير: سيتم مسح البيانات الحالية واستبدالها بالنسخة المرفوعة. هل أنت متأكد؟')) return;

    try {
        UI.showToast('جاري استعادة البيانات...', 'info');
        const file = input.files[0];
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                await DB.clear('categories');
                await DB.clear('medicineMaster');
                await DB.clear('inventory');

                for (const cat of data.categories) await DB.put('categories', cat);
                for (const med of data.medicineMaster) await DB.put('medicineMaster', med);
                for (const inv of data.inventory) await DB.put('inventory', inv);

                UI.showToast('تمت استعادة البيانات بنجاح!', 'success');
                setTimeout(() => window.location.reload(), 1500);
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

App.checkUpdate = async function() {
    // Stage 2: Execute Update (Second Click)
    if (this.updateState === 'ready' && this.pendingRegistration) {
        const reg = this.pendingRegistration;
        const worker = reg.waiting || reg.installing || reg.active;
        if (worker) {
            UI.showToast('جاري تثبيت التحديث وإعادة التشغيل... ⏳', 'info');
            worker.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(() => window.location.reload(), 2000);
        }
        return;
    }

    // Stage 1: Check for Updates (First Click)
    this.updateStatus('جاري البحث عن تحديثات...');
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                await reg.update();
                const newWorker = reg.waiting || reg.installing;
                if (newWorker) {
                    this.updateState = 'ready';
                    this.pendingRegistration = reg;
                    // Transformation Protocol (v9.9.7 Architect)
                    this.updateStatus('تحديث جاهز! اضغط هنا مرة أخرى للتثبيت 🚀');
                    const btn = document.querySelector('.setting-card .bx-refresh')?.closest('.setting-card');
                    if (btn) btn.style.background = 'var(--primary-light)'; 
                    return;
                }
                this.updateStatus('أنت تستخدم أحدث نسخة بالفعل ✅');
                this.updateState = 'check';
                setTimeout(() => this.updateStatus('البحث عن إصدارات جديدة متوفرة'), 4000);
            }
        } catch (err) {
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
        
        // 1. Try to Login
        try {
            await auth.signInWithEmailAndPassword(email, this.SILENT_PASS);
            UI.showToast(`أهلاً بك مجدداً يا ${name}!`, 'success');
        } catch (loginErr) {
            // 2. If user doesn't exist, Create Account
            if (loginErr.code === 'auth/user-not-found' || loginErr.code === 'auth/invalid-credential') {
                await auth.createUserWithEmailAndPassword(email, this.SILENT_PASS);
                UI.showToast('تم إنشاء حسابك بنجاح! ✨', 'success');
            } else {
                throw loginErr;
            }
        }
    } catch (err) {
        console.error('Auth Error:', err);
        let msg = 'خطأ في الدخول';
        if (err.code === 'auth/operation-not-allowed') msg = 'يرجى تفعيل البريد الإلكتروني في كونسول فيربيس';
        if (err.code === 'auth/network-request-failed') msg = 'تأكد من اتصالك بالإنترنت';
        UI.showToast(`${msg} (${err.code || err.message})`, 'danger');
    }
};


App.handleLogout = async function() {
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

App.updateAdminUI = function() {
    const isAdmin = this.userRole === 'admin';
    const statusText = document.getElementById('admin-status-text');
    const icon = document.getElementById('admin-icon');
    
    if (statusText) statusText.textContent = isAdmin ? 'وضع المدير (مفعل)' : 'صلاحيات الموظف (مفعلة)';
    if (icon) icon.className = isAdmin ? 'bx bxs-shield-check' : 'bx bx-user';
    
    // Update Master Data View to show publish buttons if admin
    if (window.UI && UI.currentView === 'master') App.renderMasterData();
};


// Sync UI functions removed in v9.9.0 - Absolute Essence Protocol


// Global Error Monitor
window.onerror = (msg, url, line, col, error) => {
    console.error('Dawaa Global Catch:', { msg, url, line, error });
    if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`خطأ تقني: ${msg.split(':')[0]}`, 'danger');
    }
    return false;
};

document.addEventListener('DOMContentLoaded', () => App.init());
export { App };
