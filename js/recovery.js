/**
 * Dawaa Recovery Mode (v1.0.0)
 * Designed to revive the app when the main engine fails.
 */

export const Recovery = {
    enabled: localStorage.getItem('dawaa_recovery_mode') === 'true',

    log(step, msg) {
        console.log(`%c[RECOVERY STEP ${step}]`, 'background: #ff0000; color: #ffffff; font-weight: bold; padding: 2px 5px;', msg);
    },

    async initUIOnly(AppInstance) {
        this.log(1, 'Starting Recovery UI Boot...');
        
        try {
            // 1. Force Body Visible
            document.body.style.opacity = '1';
            document.body.style.visibility = 'visible';
            this.log(2, 'Body visibility forced.');

            // 2. Mock UI if needed or use existing UI
            import('./core/ui.js').then(({ UI }) => {
                this.log(3, 'UI Module loaded. Forcing Dashboard.');
                window.UI = UI;
                UI.init();
                UI.switchView('view-dashboard');
                this.log(4, 'Switched to Dashboard.');
            });

            // 3. Attach Emergency Listeners
            this.attachEmergencyListeners(AppInstance);
            this.log(5, 'Emergency listeners attached.');

            // 4. Update Header
            const nameDisplay = document.getElementById('display-user-name');
            if (nameDisplay) nameDisplay.textContent = 'وضع الاستعادة (Recovery)';
            
            this.log(6, 'Recovery UI Ready.');
            
        } catch (e) {
            console.error('RECOVERY BOOT FAILED', e);
        }
    },

    attachEmergencyListeners(App) {
        // Manual binding for critical navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.onclick = (e) => {
                const target = item.getAttribute('data-target');
                this.log('NAV', `Navigating to ${target}`);
                if (window.UI) window.UI.switchView(`view-${target}`);
            };
        });

        // Search Bar Emergency Bind
        const search = document.getElementById('global-search');
        if (search) {
            search.oninput = (e) => {
                this.log('SEARCH', `Searching for: ${e.target.value}`);
                // Simple feedback to show it's alive
                if (e.target.value.length > 2) {
                   console.log('Recovery Search Active:', e.target.value);
                }
            };
        }
    }
};
