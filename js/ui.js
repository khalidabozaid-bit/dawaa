// js/ui.js
/**
 * Dawaa Inventory UI Controller
 * Handles view switching, modals, and dynamic rendering.
 */

export const UI = {
    currentView: 'dashboard',

    init() {
        this.setupEventListeners();
        this.renderCurrentView();
    },

    setupEventListeners() {
        // Bottom Nav Switching
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                this.switchView(`view-${target}`);
                
                // Update active state
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    },

    switchView(viewId) {
        const viewName = viewId.replace('view-', '');
        this.currentView = viewName;

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        // Trigger view-specific rendering
        this.renderCurrentView();
    },

    renderCurrentView() {
        console.log(`Dawaa UI: Rendering ${this.currentView} view...`);
        
        // Map views to app renderers
        switch(this.currentView) {
            case 'dashboard':
                window.App.renderDashboard();
                break;
            case 'inventory':
                window.App.switchInventoryTab(window.App.inventoryTab || 'detailed');
                break;
            case 'emergency':
                this.renderSpecializedView('emergency', 'emergency-items-list');
                break;
            case 'supplies':
                this.renderSpecializedView('supply', 'supplies-items-list');
                break;
            case 'master':
                this.renderMasterDataView();
                break;
            case 'reports':
                this.renderReportsView();
                break;
        }
    },

    async renderSpecializedView(type, containerId) {
        const inventory = await window.DawaaDB.getAll('inventory');
        const filtered = inventory.filter(i => i.type === type);
        window.App.renderInventoryList(filtered, containerId);
    },

    async renderMasterDataView() {
        const container = document.getElementById('master-items-list');
        if (!container) return;
        const masterData = await window.DawaaDB.getAll('medicineMaster');
        
        if (masterData.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class='bx bx-data'></i><p>لم يتم تسجيل أدوية في المستودع بعد</p></div>`;
            return;
        }

        container.innerHTML = masterData.map(m => `
            <div class="inventory-card">
                <div class="card-icon"><i class='bx bx-bookmark'></i></div>
                <div class="card-info">
                    <h3>${m.nameEN} <span class="ar-name">/ ${m.nameAR}</span></h3>
                    <div class="card-meta">
                        <span><i class='bx bx-dna'></i> ${m.activeIngredient || 'بدون مادة فعالة'}</span>
                        <span><i class='bx bx-category'></i> ${m.type}</span>
                    </div>
                </div>
            </div>
        `).join('');
    },

    async renderReportsView() {
        const container = document.getElementById('view-reports');
        if (!container) return;

        // Fetch locations for filter
        const inventory = await window.DawaaDB.getAll('inventory');
        const locations = Array.from(new Set(inventory.map(i => i.location))).filter(l => l);

        container.innerHTML = `
            <div class="view-header">
                <h2>📊 تقارير وإحصائيات الإكسيل</h2>
            </div>

            <div class="filter-section card">
                <h3>تخصيص التصدير (فلترة)</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label>المكان:</label>
                        <select id="export-filter-location">
                            <option value="all">الكل (All Locations)</option>
                            ${locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>التصنيف:</label>
                        <select id="export-filter-type">
                            <option value="all">الكل (All Types)</option>
                            <option value="medicine">الأدوية فقط</option>
                            <option value="supply">المستلزمات فقط</option>
                            <option value="emergency">الطوارئ فقط</option>
                        </select>
                    </div>
                </div>
                <button class="btn-primary" onclick="window.App.handleFilteredExport()">
                    <i class='bx bx-download'></i> تصدير البيانات المفلترة
                </button>
            </div>

            <div class="reports-grid">
                <div class="report-card" onclick="window.App.exportToExcel('full')">
                    <div class="report-icon"><i class='bx bxs-file-export'></i></div>
                    <div class="report-info">
                        <h3>تقرير الجرد الكلي</h3>
                        <p>تصدير كافة الأرصدة الحالية في ملف واحد</p>
                    </div>
                </div>
                <div class="report-card" onclick="window.App.exportToExcel('emergency')">
                    <div class="report-icon" style="background: #fee2e2; color: #ef4444;"><i class='bx bxs-error-circle'></i></div>
                    <div class="report-info">
                        <h3>تقرير أدوية الطوارئ</h3>
                        <p>تصدير نواقص وأرصدة الطوارئ فقط</p>
                    </div>
                </div>
                <div class="report-card" onclick="window.App.exportToExcel('expiring')">
                    <div class="report-icon" style="background: #fef3c7; color: #d97706;"><i class='bx bx-calendar-exclamation'></i></div>
                    <div class="report-info">
                        <h3>تقرير تنبيه الصلاحية</h3>
                        <p>الأدوية التي ستنتهي خلال 6 أشهر</p>
                    </div>
                </div>
            </div>
        `;
    },

    // --- Modal System ---

    showModal(contentHtml) {
        const container = document.getElementById('modal-container');
        if (!container) return;

        container.innerHTML = `
            <div class="bottom-sheet show">
                <div class="sheet-handle"></div>
                <div class="sheet-content">
                    ${contentHtml}
                </div>
            </div>
        `;
        container.classList.add('show');
        
        // Background click to close
        container.onclick = (e) => {
            if (e.target === container) this.closeModal();
        };
    },

    closeModal() {
        const container = document.getElementById('modal-container');
        if (container) {
            container.classList.remove('show');
            setTimeout(() => container.innerHTML = '', 300);
        }
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class='bx ${type === 'success' ? 'bx-check-circle' : 'bx-info-circle'}'></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }
};

window.toggleTheme = () => {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.className = isDark ? 'bx bx-sun' : 'bx bx-moon';
    }
};

window.openQuickAdd = () => {
   // Logic will be handled in app.js
};
