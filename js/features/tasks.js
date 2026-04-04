import { Sync } from '../core/sync.js';
import { UI } from '../core/ui.js';
import { DB } from '../core/db.js';

export const TaskManager = {
    activeTasks: [],
    currentTask: null,
    currentLocation: null, // For Multi-Location individual flow
    
    init() {
        console.log('TaskManager: Initializing Unified Engine...');
        this.listenForTasks();
    },

    listenForTasks() {
        if (!window.App?.user) return;
        const userId = window.App.user.displayName || window.App.user.email;
        
        Sync.subscribeToUserTasks(userId, (tasks) => {
            this.activeTasks = tasks;
            this.renderAssignedTaskPrompt();
            if (this.currentTask) {
                const updated = tasks.find(t => t.id === this.currentTask.id);
                if (updated) this.currentTask = updated;
            }
        });
    },

    async renderAssignedTaskPrompt() {
        // Dashboard Card
        const container = document.getElementById('assigned-task-container');
        if (!container) return;

        if (this.activeTasks.length > 0) {
            const task = this.activeTasks[this.activeTasks.length - 1]; // Latest active task
            container.innerHTML = `
                <div class="active-inventory-card mt-20" onclick="window.App.runTask('${task.id}')">
                    <div class="card-glow"></div>
                    <div class="card-content">
                        <div class="card-header">
                            <span class="status-badge pulse">جاري الجرد</span>
                            <h3>📦 جرد نشط: ${task.location_name || (task.location_ids ? task.location_ids.join(' + ') : 'متعدد')}</h3>
                        </div>
                        <div class="card-body">
                            <div class="progress-wrap">
                                <div class="progress-bar" style="width: ${task.progress || 0}%"></div>
                            </div>
                            <div class="progress-stats">
                                <span>التقدم: ${task.progress || 0}%</span>
                                <button class="continue-btn">استكمال العد <i class='bx bx-right-arrow-alt'></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '';
        }
    },

    async runTask(taskId) {
        const task = this.activeTasks.find(t => t.id === taskId);
        if (!task) return;
        
        this.currentTask = task;
        // For individual multi-location, set first location as default
        if (task.location_ids && task.location_ids.length > 0) {
            this.currentLocation = task.location_ids[0];
        } else {
            this.currentLocation = task.location_name;
        }

        UI.switchView('view-task-runner');
        this.renderTaskRunnerHeader();
        this.renderTaskList();
    },

    renderTaskRunnerHeader() {
        const task = this.currentTask;
        if (!task) return;

        const header = document.querySelector('#view-task-runner .view-header');
        if (!header) return;

        const locations = task.location_ids || [task.location_name];
        
        header.innerHTML = `
            <div class="task-info-bar">
                <div class="location-toggle-wrap">
                    ${locations.map(loc => `
                        <button class="loc-toggle-btn ${this.currentLocation === loc ? 'active' : ''}" 
                                onclick="window.App.switchTaskLocation('${loc}')">
                            ${loc}
                        </button>
                    `).join('')}
                </div>
                <p id="tr-session-name" class="text-muted small">المهمة: ${task.id.split('_')[1]}</p>
            </div>
            <button class="btn-primary sm-btn" onclick="window.App.finishTask()">إنهاء المهمة ✅</button>
        `;
    },

    switchLocation(loc) {
        this.currentLocation = loc;
        this.renderTaskRunnerHeader();
        this.renderTaskList();
        UI.showToast(`تحويل الجرد لـ: ${loc}`, 'info');
    },

    async renderTaskList(searchQuery = '') {
        const container = document.getElementById('tr-items-list');
        if (!container) return;

        let medicines = await DB.getAll('medicineMaster');
        
        if (searchQuery) {
            medicines = medicines.filter(m => 
                m.nameEN.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (m.nameAR && m.nameAR.includes(searchQuery))
            );
        }

        medicines.sort((a,b) => a.nameEN.localeCompare(b.nameEN));

        container.innerHTML = medicines.map(m => `
            <div class="task-count-card" id="tr-card-${m.id}">
                <div class="task-med-info">
                    <h3>${m.nameEN}</h3>
                    <p>${m.nameAR || ''}</p>
                </div>
                <div class="task-count-input-wrap">
                    <input type="number" 
                           class="big-qty-input" 
                           placeholder="0" 
                           id="qty-${m.id}"
                           onchange="window.App.saveTaskCount('${m.id}', this.value)">
                </div>
            </div>
        `).join('');
    },

    async saveTaskCount(productId, quantity) {
        if (!this.currentTask || !this.currentLocation) return;
        
        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty < 0) return;

        // Push with Mandatory Location Context
        await Sync.pushTaskCount(this.currentTask.id, productId, qty, this.currentLocation);
        
        const card = document.getElementById(`tr-card-${productId}`);
        if (card) card.classList.add('done');
        
        UI.showToast('تم الحفظ', 'success');
    },

    async openCreateInventory() {
        UI.showModal(`
            <div class="modal-header"><h2>إنشاء عملية جرد جديدة</h2></div>
            <div class="creation-choice-grid">
                <button class="choice-btn individual" onclick="window.App.uiCreateIndividual()">
                    <i class='bx bx-user'></i>
                    <span>👤 جرد فردي (إكسبريس)</span>
                    <p>أنت وحدك لمكان أو أكثر</p>
                </button>
                <button class="choice-btn group" onclick="window.App.uiCreateGroup()">
                    <i class='bx bx-group'></i>
                    <span>👥 جرد جماعي (فريق)</span>
                    <p>توزيع المهام على الفريق</p>
                </button>
            </div>
        `);
    },

    async uiCreateIndividual() {
        const locations = ['صيدلية', 'مخزن', 'ثلاجة', 'دولاب الطوارئ', 'دولاب الاستقبال', 'إسعاف'];
        UI.showModal(`
            <div class="modal-header"><h2>جرد فردي: اختر الأماكن</h2></div>
            <div class="form-group mb-15">
                <label class="form-label">تسمية الجلسة:</label>
                <input type="text" id="session-name-input" class="form-input" value="جرد فردي - ${new Date().toLocaleDateString('ar-EG')}" required>
            </div>
            <div class="location-multi-select">
                <button class="btn-ghost sm-btn mb-10" onclick="window.App.toggleAllLocations(true)">اختيار الكل</button>
                <div class="loc-check-list">
                    ${locations.map(loc => `
                        <label class="loc-check-item">
                            <input type="checkbox" class="loc-checkbox" value="${loc}" checked>
                            <span>${loc}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="form-actions mt-20">
                <button class="btn-primary w-100" onclick="window.App.submitIndividualInventory()">بدء الجرد الفردي 🚀</button>
            </div>
        `);
    },

    async submitIndividualInventory() {
        const name = document.getElementById('session-name-input').value;
        const selected = Array.from(document.querySelectorAll('.loc-checkbox:checked')).map(cb => cb.value);
        
        if (selected.length === 0) return UI.showToast('اختر مكاناً واحداً على الأقل', 'warning');

        UI.showToast('جاري التحضير...', 'info');
        const taskId = 'task_' + Math.random().toString(36).substr(2, 9);
        const sessionId = 'session_' + Date.now();
        
        // Push direct to Firestore
        const userId = window.App.user.displayName || window.App.user.email;
        await Sync.createStructuredSession(name, [{ user_id: userId, location: 'متعدد', individual: true, location_ids: selected }]);
        
        UI.closeModal();
        UI.showToast('بالتوفيق في المهمة! ✅', 'success');
    }
};
