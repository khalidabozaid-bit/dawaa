// js/core/ui.js
import { Utils } from './utils.js';

/**
 * Dawaa UI Controller
 * Handles view switching, modals, and dynamic rendering.
 */

export const UI = {
    currentView: 'dashboard',

    init() {
        window.UI = UI; // Early binding
        this.setupEventListeners();
        console.log('Dawaa UI: Ready.');
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

        // Visual switch
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active');
            window.scrollTo(0, 0);
        }

        // Trigger render
        this.renderCurrentView();
    },

    renderCurrentView() {
        const App = window.App;
        if (!App) return;

        switch(this.currentView) {
            case 'dashboard':
                App.renderDashboard();
                break;
            case 'inventory':
                App.renderInventory();
                break;
            case 'smart-inventory':
                App.renderSmartInventory();
                break;
            case 'master':
                App.renderMasterData();
                break;
            case 'settings':
                this.updateSettingsIcons();
                break;
        }
    },

    updateSettingsIcons() {
        const isDark = document.body.classList.contains('dark-mode');
        const icon = document.getElementById('settings-theme-icon');
        if (icon) icon.className = isDark ? 'bx bx-sun' : 'bx bx-moon';
    },

    updateDashboardStats(stats) {
        const elements = {
            total: document.getElementById('stat-total-items'),
            low: document.getElementById('stat-low-stock'),
            expiring: document.getElementById('stat-expiring-items')
        };

        if (elements.total) elements.total.textContent = stats.totalItems || 0;
        if (elements.low) elements.low.textContent = stats.lowStockCount || 0;
        if (elements.expiring) elements.expiring.textContent = stats.expiringCount || 0;
    },

    renderReportsMenu() {
        const container = document.getElementById('reports-container');
        if (!container) return;

        container.innerHTML = `
            <div class="view-header">
                <h2>📈 التقارير والتصدير</h2>
            </div>
            <div class="reports-grid">
                <div class="report-card" onclick="window.App.export('full')">
                    <div class="report-icon primary"><i class='bx bxs-file-export'></i></div>
                    <div class="report-info">
                        <h3>جرد كلي (Excel)</h3>
                        <p>تصدير كافة الأصناف المتاحة في جميع المواقع</p>
                    </div>
                </div>
                <div class="report-card" onclick="window.App.export('expiring')">
                    <div class="report-icon warning"><i class='bx bx-time-five'></i></div>
                    <div class="report-info">
                        <h3>تنبيه الصلاحية</h3>
                        <p>الأصناف التي تنتهي صلاحيتها قريباً</p>
                    </div>
                </div>
                <div class="report-card" onclick="window.App.export('low-stock')">
                    <div class="report-icon danger"><i class='bx bx-trending-down'></i></div>
                    <div class="report-info">
                        <h3>النواقص</h3>
                        <p>الأصناف التي وصلت للحد الأدنى</p>
                    </div>
                </div>
            </div>
        `;
    },

    // --- Modal & Sheet System ---

    showModal(contentHtml) {
        console.log('UI: Opening Modal...');
        const container = document.getElementById('modal-container');
        if (!container) {
            console.error('UI: modal-container element not found in DOM!');
            return;
        }

        // Clean previous content
        container.innerHTML = '';
        container.classList.remove('show');

        // Inject new content
        container.innerHTML = `
            <div class="bottom-sheet">
                <div class="sheet-header">
                    <div class="sheet-handle"></div>
                    <button class="close-btn" onclick="window.UI.closeModal()"><i class='bx bx-x'></i></button>
                </div>
                <div class="sheet-content">
                    ${contentHtml}
                </div>
            </div>
        `;
        
        // Use a tiny delay to ensure CSS transition works
        requestAnimationFrame(() => {
            container.classList.add('show');
            const sheet = container.querySelector('.bottom-sheet');
            if (sheet) sheet.classList.add('show');
        });

        container.onclick = (e) => {
            if (e.target === container) this.closeModal();
        };
    },

    closeModal() {
        console.log('UI: Closing Modal...');
        const container = document.getElementById('modal-container');
        if (!container) return;

        const sheet = container.querySelector('.bottom-sheet');
        if (sheet) sheet.classList.remove('show');
        
        setTimeout(() => {
            container.classList.remove('show');
            container.innerHTML = '';
        }, 300);
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const isError = type === 'danger';
        toast.innerHTML = `
            <i class='bx ${type === 'success' ? 'bx-check-circle' : 'bx-info-circle'}'></i>
            <span>${message}</span>
            ${isError ? `<button class="toast-copy-btn" onclick="UI.copyErrorReport('${message}')"><i class='bx bx-copy'></i></button>` : ''}
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        
        if (!isError) {
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        } else {
            // Keep error toasts longer or until closed (optional)
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 6000);
            }, 6000);
        }
    },

    copyErrorReport(msg) {
        const report = `DAWAA ERROR REPORT\nMsg: ${msg}\nUA: ${navigator.userAgent}\nTime: ${new Date().toISOString()}`;
        navigator.clipboard.writeText(report).then(() => {
            this.showToast('تم نسخ تقرير الخطأ', 'success');
        });
    }
};

// Global Bindings
window.UI = UI;

// Global Theme Toggle
window.toggleTheme = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dawaa-theme', isDark ? 'dark' : 'light');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = isDark ? 'bx bx-sun' : 'bx bx-moon';
};

// Init theme from preference
if (localStorage.getItem('dawaa-theme') === 'dark') {
    document.body.classList.add('dark-mode');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = 'bx bx-sun';
}
