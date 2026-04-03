// js/core/ui.js
import { Utils } from './utils.js';

/**
 * Dawaa UI Controller (v16.0.7 Emergency Bridge)
 * Handles view switching, modals, and dynamic rendering.
 */

export const UI = {
    currentViewId: 'view-dashboard',

    init() {
        console.log('Dawaa UI: Booting Emergency Bridge...');
        window.UI = UI; 
        
        // 🛡️ الربط الفوري والمباشر للأحداث
        this.setupEventListeners();
    },

    setupEventListeners() {
        console.log('Dawaa UI: Binding Logic to DOM...');
        
        // Bottom Nav Switching
        const navItems = document.querySelectorAll('.nav-item');
        if (navItems.length === 0) {
            console.warn('UI: No nav-items found yet. Re-trying in 500ms...');
            setTimeout(() => this.setupEventListeners(), 500);
            return;
        }

        navItems.forEach(btn => {
            // Cloning to clear legacy listeners
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', () => {
                const target = newBtn.dataset.target;
                this.switchView(`view-${target}`);
                
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                newBtn.classList.add('active');
            });
        });
        
        const modalOverlay = document.getElementById('modal-container');
        if (modalOverlay) {
            modalOverlay.onclick = (e) => {
                if (e.target === modalOverlay) this.closeModal();
            };
        }
    },

    switchView(viewId, push = true) {
        if (!viewId) return;
        this.currentViewId = viewId;
        const viewName = viewId.replace('view-', '');
        console.log(`UI: Shifting to ${viewName}`);

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active');
            window.scrollTo(0, 0);
        }

        if (push) {
            history.pushState({ viewId }, "", `#${viewName}`);
        }

        this.renderCurrentView();
    },

    renderCurrentView() {
        const App = window.App;
        if (!App) return;

        if (this.currentViewId === 'view-dashboard') App.renderDashboard();
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
                <div class="sheet-header"><div class="sheet-handle"></div></div>
                <div class="sheet-content">${contentHtml}</div>
                <button class="modal-close-v16" onclick="window.UI.closeModal()"><i class='bx bx-x'></i></button>
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
        toast.innerHTML = `<span>${message}</span>`;
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
};

if (localStorage.getItem('dawaa-theme') === 'dark') {
    document.body.classList.add('dark-mode');
}
