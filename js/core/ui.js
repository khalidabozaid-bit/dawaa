// js/core/ui.js
import { Utils } from './utils.js';

/**
 * Dawaa UI Controller (v16.0.6 Absolute Sync)
 * Handles view switching, modals, and dynamic rendering.
 */

export const UI = {
    currentView: 'dashboard',

    init() {
        console.log('Dawaa UI: Booting...');
        window.UI = UI; 
        
        // Robust Listener Binding 🛡️
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
    },

    setupEventListeners() {
        console.log('Dawaa UI: Binding Events...');
        
        // Bottom Nav Switching
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(btn => {
            // Remove old listeners if any (Mashawiri Style Protection)
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', () => {
                const target = newBtn.dataset.target;
                this.switchView(`view-${target}`);
                
                // Update active state
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                newBtn.classList.add('active');
            });
        });
        
        // Global Modal Close
        const modalOverlay = document.getElementById('modal-container');
        if (modalOverlay) {
            modalOverlay.onclick = (e) => {
                if (e.target === modalOverlay) this.closeModal();
            };
        }
    },

    switchView(viewId, push = true) {
        const viewName = viewId.replace('view-', '');
        this.currentView = viewName;
        console.log(`UI: Switching to ${viewName}`);

        // Visual switch
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active');
            window.scrollTo(0, 0);
        }

        // History Management
        if (push) {
            history.pushState({ viewId }, "", `#${viewName}`);
        }

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
            case 'reports':
                // Shared view or specific logic
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
            total: document.getElementById('total-meds'),
            low: document.getElementById('low-stock-count'),
            expiring: document.getElementById('expired-count')
        };

        if (elements.total) elements.total.textContent = stats.totalItems || 0;
        if (elements.low) elements.low.textContent = stats.lowStockCount || 0;
        if (elements.expiring) elements.expiring.textContent = stats.expiringCount || 0;
    },

    showModal(contentHtml) {
        const container = document.getElementById('modal-container');
        if (!container) return;

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
        
        requestAnimationFrame(() => {
            container.classList.add('show');
            const sheet = container.querySelector('.bottom-sheet');
            if (sheet) sheet.classList.add('show');
        });
    },

    closeModal() {
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
        toast.className = `toast toast-${type} show`;
        toast.innerHTML = `
            <i class='bx ${type === 'success' ? 'bx-check-circle' : 'bx-info-circle'}'></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

window.UI = UI;

window.toggleTheme = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dawaa-theme', isDark ? 'dark' : 'light');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = isDark ? 'bx bx-sun' : 'bx bx-moon';
};

// Initial Theme Check
if (localStorage.getItem('dawaa-theme') === 'dark') {
    document.body.classList.add('dark-mode');
}
