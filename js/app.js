// js/app.js
import { DB } from './db.js';
import { UI } from './ui.js';

/**
 * Dawaa App Controller
 * Main business logic and data orchestration.
 */

const App = {
    async init() {
        try {
            await DB.init();
            UI.init();
            this.setupAppListeners();
            this.renderDashboard();
            this.registerServiceWorker();
            console.log('Dawaa App: Initialized successfully.');
        } catch (err) {
            console.error('Dawaa App: Init failed.', err);
        }
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(() => console.log('SW Registered'))
                .catch(err => console.error('SW Registration Failed', err));
        }
    },

    setupAppListeners() {
        // App is already global, no need to re-assign if done at top-level
        console.log('Dawaa App: App listeners configured.');
    },

    async handleFilteredExport() {
        const location = document.getElementById('export-filter-location').value;
        const type = document.getElementById('export-filter-type').value;
        this.exportToExcel('custom', { location, type });
    },

    inventoryTab: 'detailed',
    async switchInventoryTab(tab) {
        this.inventoryTab = tab;
        const btns = document.querySelectorAll('.toggle-btn');
        btns.forEach(b => b.classList.toggle('active', (tab === 'detailed' && b.innerText.includes('تفصيلي')) || (tab === 'aggregated' && b.innerText.includes('تجميعي'))));
        
        const inventory = await DB.getAll('inventory');
        this.renderInventoryList(inventory, 'inventory-items-list', false, tab === 'aggregated');
    },

    async handleGlobalSearch(query) {
        if (!query) {
            this.renderDashboard();
            return;
        }
        
        const inventory = await DB.getAll('inventory');
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));
        
        const lowQuery = query.toLowerCase();
        const filtered = inventory.filter(item => {
            const master = masterMap.get(item.medicineId);
            if (!master) return false;
            return (master.nameEN && master.nameEN.toLowerCase().includes(lowQuery)) || 
                   (master.nameAR && master.nameAR.includes(query)) ||
                   (master.activeIngredient && master.activeIngredient.toLowerCase().includes(lowQuery));
        });

        this.renderInventoryList(filtered, 'dashboard-inventory-list', false);
    },

    // --- Master Data (Medicines & Supplies Registry) ---

    async addMasterItem(data) {
        // data: { id, nameEN, nameAR, activeIngredient, type }
        if (!data.id) data.id = crypto.randomUUID();
        await DB.add('medicineMaster', data);
        UI.showToast(`تمت إضافة "${data.nameAR}" بنجاح`, 'success');
    },

    async getMasterSuggestions(query) {
        if (!query || query.length < 1) return [];
        const all = await DB.getAll('medicineMaster');
        const lowQuery = query.toLowerCase();
        
        return all.filter(m => 
            (m.nameEN && m.nameEN.toLowerCase().startsWith(lowQuery)) || 
            (m.nameAR && m.nameAR.startsWith(query)) ||
            (m.activeIngredient && m.activeIngredient.toLowerCase().includes(lowQuery))
        ).slice(0, 10); // Limit results for performance
    },

    // --- Inventory Management ---

    async addInventoryEntry(entry) {
        // entry: { id, medicineId, location, quantity, expiryDate, type }
        if (!entry.id) entry.id = crypto.randomUUID();
        await DB.add('inventory', entry);
        UI.showToast('تم تسجيل الجرد بنجاح', 'success');
        this.renderDashboard();
    },

    async deleteInventoryEntry(id) {
        if (confirm('هل أنت متأكد من رغبتك في حذف هذا السجل؟')) {
            await DB.delete('inventory', id);
            UI.showToast('تم الحذف بنجاح', 'info');
            this.renderDashboard();
            // Also re-render current view if not dashboard
            if (UI.currentView !== 'dashboard') {
                UI.renderCurrentView();
            }
        }
    },

    // --- View Renderers ---

    async renderDashboard() {
        const totalItemsEl = document.getElementById('stat-total-items');
        const expiringItemsEl = document.getElementById('stat-expiring-items');
        const lowStockEl = document.getElementById('stat-low-stock'); // We will add this to HTML
        
        const inventory = await DB.getAll('inventory');
        if (totalItemsEl) totalItemsEl.textContent = inventory.length;

        // Logic for expiring and low stock
        const today = new Date();
        const threeMos = new Date(); threeMos.setMonth(threeMos.getMonth() + 3);
        const sixMos = new Date(); sixMos.setMonth(sixMos.getMonth() + 6);

        const expiringCount = inventory.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMos).length;
        const lowStockCount = inventory.filter(i => (parseInt(i.quantity) || 0) < 5).length; // Assumption: 5 is threshold

        if (expiringItemsEl) expiringItemsEl.textContent = expiringCount;
        if (lowStockEl) lowStockEl.textContent = lowStockCount;

        this.renderInventoryList(inventory, 'dashboard-inventory-list', true);
    },

    async renderInventoryList(items, containerId, limit = false, aggregate = false) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class='bx bx-layer-plus'></i><p>لا يوجد جرد حالياً</p></div>`;
            return;
        }

        let displayItems = limit ? items.slice(-5).reverse() : items;
        
        // Load master info for each item to show names
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));

        if (aggregate) {
            const aggregated = new Map();
            items.forEach(item => {
                const key = item.medicineId;
                if (!aggregated.has(key)) {
                    aggregated.set(key, { ...item, quantity: 0, locations: new Set(), expiries: [] });
                }
                const entry = aggregated.get(key);
                entry.quantity += parseInt(item.quantity) || 0;
                entry.locations.add(item.location);
                if (item.expiryDate) entry.expiries.push(item.expiryDate);
            });
            displayItems = Array.from(aggregated.values()).map(e => ({
                ...e,
                location: Array.from(e.locations).join('، '),
                expiryDate: e.expiries.sort()[0] || 'N/A' // Show earliest expiry
            }));
        }

        container.innerHTML = displayItems.map(item => {
            const master = masterMap.get(item.medicineId) || { nameAR: 'غير معروف', nameEN: 'Unknown' };
            const expiryStatus = this.getExpiryStatus(item.expiryDate);
            
            return `
                <div class="inventory-card ${expiryStatus.class}">
                    <div class="card-icon"><i class='bx ${item.type === 'supply' ? 'bx-plug' : 'bx-capsule'}'></i></div>
                    <div class="card-info">
                        <h3>${master.nameEN} <span class="ar-name">/ ${master.nameAR}</span></h3>
                        <div class="card-meta">
                            <span><i class='bx bx-map-pin'></i> ${item.location}</span>
                            <span><i class='bx bx-purchase-tag-alt'></i> ${item.quantity}</span>
                        </div>
                    </div>
                    <div class="card-expiry">
                        <span class="expiry-date">${item.expiryDate || 'N/A'} ${aggregate ? '📅' : ''}</span>
                        <div class="card-actions">
                            ${!aggregate ? `<button class="icon-btn delete-btn" onclick="window.deleteEntry('${item.id}')"><i class='bx bx-trash'></i></button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    getExpiryStatus(dateStr) {
        if (!dateStr) return { class: '', label: 'بدون تاريخ' };
        const expiry = new Date(dateStr);
        const today = new Date();
        
        // Accurate month diff
        const diffTime = expiry - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const diffMonths = diffDays / 30;

        if (diffTime < 0) return { class: 'status-expired', label: 'منتهي الصلاحية' };
        if (diffMonths < 3) return { class: 'status-critical', label: 'حرج (< 3 شهور)' };
        if (diffMonths < 6) return { class: 'status-warning', label: 'تنبيه (< 6 شهور)' };
        
        return { class: 'status-safe', label: 'سليم الصلاحية' };
    },

    // --- Modals Flows ---

    openQuickAddStock() {
        UI.showModal(`
            <div class="modal-header">
                <h2>إضافة جرد جديد ( Stock Entry )</h2>
            </div>
            <form id="form-add-stock" onsubmit="event.preventDefault(); window.submitNewStock();">
                <div class="form-group">
                    <label>ابحث عن الدواء/المستلزم:</label>
                    <div class="autocomplete">
                        <input type="text" id="search-master" placeholder="اكتب اسم الدواء..." required oninput="window.handleMasterInput(this.value)">
                        <div id="autocomplete-list" class="autocomplete-items"></div>
                    </div>
                    <button type="button" class="text-btn sm-btn" onclick="window.openAddMasterItem()">➕ غير مسجل؟ أضفه الآن</button>
                </div>
                <input type="hidden" id="selected-medicine-id">
                <input type="hidden" id="selected-medicine-type">
                
                <div class="form-row">
                    <div class="form-group">
                        <label>المكان:</label>
                        <input type="text" id="stock-location" placeholder="مثلاً: الثلاجة، الرف A" required>
                    </div>
                    <div class="form-group">
                        <label>الكمية:</label>
                        <input type="number" id="stock-quantity" placeholder="0" required min="1">
                    </div>
                </div>
                
                <div class="form-group">
                    <label>تاريخ الصلاحية:</label>
                    <input type="month" id="stock-expiry">
                </div>

                <div class="form-actions">
                    <button type="submit" class="btn-primary">حفظ الجرد</button>
                    <button type="button" class="btn-ghost" onclick="UI.closeModal()">إلغاء</button>
                </div>
            </form>
        `);
    },
    async exportToExcel(type, options = {}) {
        const inventory = await DB.getAll('inventory');
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));
        
        let dataToExport = [];
        const today = new Date();
        const sixMos = new Date(); sixMos.setMonth(sixMos.getMonth() + 6);

        if (type === 'full') {
            dataToExport = inventory;
        } else if (type === 'emergency') {
            dataToExport = inventory.filter(i => i.type === 'emergency');
        } else if (type === 'expiring') {
            dataToExport = inventory.filter(i => i.expiryDate && new Date(i.expiryDate) < sixMos);
        } else if (type === 'custom') {
            dataToExport = inventory.filter(i => {
                const matchLoc = options.location === 'all' || i.location === options.location;
                const matchType = options.type === 'all' || i.type === options.type;
                return matchLoc && matchType;
            });
        }

        if (dataToExport.length === 0) {
            UI.showToast('لا توجد بيانات للتصدير في هذا القسم', 'info');
            return;
        }

        // Prepare rows for SheetJS
        const rows = dataToExport.map(item => {
            const master = masterMap.get(item.medicineId) || {};
            return {
                'الأصناف (English)': master.nameEN || 'N/A',
                'الأصناف (العربية)': master.nameAR || 'N/A',
                'المادة الفعالة': master.activeIngredient || '-',
                'المكان / الموقع': item.location,
                'الكمية المتاحة': item.quantity,
                'تاريخ الصلاحية': item.expiryDate || '-',
                'النوع': item.type === 'medicine' ? 'دواء' : (item.type === 'supply' ? 'مستلزم' : 'طوارئ')
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
        
        // Save file
        const fileName = `Dawaa_Inventory_${type}_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        UI.showToast(`تم تصدير ملف الإكسيل بنجاح`, 'success');
    }
};

// --- Window Attachments for Form Binding ---

window.handleMasterInput = async (val) => {
    const list = document.getElementById('autocomplete-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (val.length < 1) return;

    const matches = await App.getMasterSuggestions(val);
    matches.forEach(m => {
        const div = document.createElement('div');
        div.innerHTML = `<strong>${m.nameEN}</strong> - ${m.nameAR}`;
        div.onclick = () => {
            document.getElementById('search-master').value = `${m.nameEN} / ${m.nameAR}`;
            document.getElementById('selected-medicine-id').value = m.id;
            document.getElementById('selected-medicine-type').value = m.type;
            list.innerHTML = '';
        };
        list.appendChild(div);
    });
};

window.openAddMasterItem = () => {
    UI.showModal(`
        <div class="modal-header">
            <h2>إضافة بند جديد للمستودع</h2>
        </div>
        <form id="form-master-add" onsubmit="event.preventDefault(); window.submitToMaster();">
            <div class="form-group">
                <label>الاسم بالإنجليزي:</label>
                <input type="text" id="master-en" placeholder="e.g. Panadol Extra" required>
            </div>
            <div class="form-group">
                <label>الاسم بالعربي:</label>
                <input type="text" id="master-ar" placeholder="مثلاً: بنادول إكسترا" required>
            </div>
            <div class="form-group">
                <label>المادة الفعالة (إختياري):</label>
                <input type="text" id="master-ing" placeholder="Paracetamol">
            </div>
            <div class="form-group">
                <label>فئة البند:</label>
                <select id="master-type">
                    <option value="medicine">دواء طبيعي</option>
                    <option value="emergency">دواء طوارئ (هام)</option>
                    <option value="supply">مستلزم طبي</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-primary">حفظ في المستودع</button>
                <button type="button" class="btn-ghost" onclick="window.openQuickAdd()">رجوع للجرد</button>
            </div>
        </form>
    `);
};

window.submitToMaster = async () => {
    const nameEN = document.getElementById('master-en').value;
    const nameAR = document.getElementById('master-ar').value;
    const ingredient = document.getElementById('master-ing').value;
    const type = document.getElementById('master-type').value;

    await App.addMasterItem({
        id: crypto.randomUUID(),
        nameEN, nameAR, activeIngredient: ingredient, 
        type, 
        lastUpdated: new Date().toISOString()
    });
    
    // Go back to quick add
    window.openQuickAdd();
};

window.submitNewStock = async () => {
    const medicineId = document.getElementById('selected-medicine-id').value;
    if (!medicineId) {
        alert('من فضلك اختر دواء من القائمة أو أضف دواء جديداً');
        return;
    }

    const type = document.getElementById('selected-medicine-type').value;
    const location = document.getElementById('stock-location').value;
    const quantity = parseInt(document.getElementById('stock-quantity').value);
    const expiryDate = document.getElementById('stock-expiry').value;

    await App.addInventoryEntry({
        medicineId, location, quantity, expiryDate, type
    });

    UI.closeModal();
};

// Booting the App
window.App = App;
window.openQuickAdd = () => App.openQuickAddStock();
window.switchView = (viewId) => UI.switchView(viewId);
window.switchInventoryTab = (tab) => App.switchInventoryTab(tab);
window.handleSearch = (val) => App.handleGlobalSearch(val);
window.deleteEntry = (id) => App.deleteInventoryEntry(id);
window.handleFilteredExport = () => App.handleFilteredExport();

document.addEventListener('DOMContentLoaded', () => App.init());
export { App };
