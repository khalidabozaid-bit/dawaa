# 🛡️ Dawaa Master Protocol (SYSTEM_PROTOCOL v18.3.0) 🛡️

This document is the **Source of Truth** for the Dawaa PWA architecture. It serves as a mandatory pre-flight checklist and operational manual for any AI assistant or developer working on the codebase.

---

## 🚀 1. Pre-Flight Checklist (Mandatory before every Push)

Before finalizing any task, ensure the following steps are verified:

- [ ] **Universal Version Bump**:
    - Update `App.VERSION` in `js/app.js`.
    - Update `CACHE_NAME` in `sw.js` (must match VERSION).
    - Update footer text in `index.html`.
    - Update Header version span in `index.html` (Line 73).
- [ ] **Cloud Sync Verification**:
    - Every data mutation (DB.put/add/delete) must be followed by `Sync.push(id)` if it needs to persist in Firestore.
- [ ] **UI/UX Consistency**:
    - Use `UI.showToast(msg, type)` for all async operation status.
    - Ensure Arabic/English naming consistency in modals.
- [ ] **Clean Code**:
    - No dangling braces or corrupted logic (Check for search/replace overlaps).
    - Verify `window.App` and `window.UI` bindings.

---

## 🗺️ 2. System Architecture Map

### Critical Logic Locations:
| Key | Location | Line (Approx) |
| :--- | :--- | :--- |
| **App Version** | `js/app.js` | ~18 |
| **Service Worker Cache** | `sw.js` | ~2 |
| **Footer Version** | `index.html` | ~310 |
| **Sync Triggers** | `js/core/sync.js` | Master Sync Logic |
| **Inventory Actions** | `js/features/inventory.js` | Core CRUD |
| **Category Actions** | `js/features/categories.js` | Master Registry |
| **Task Management** | `js/features/tasks.js` | v16 Task Engine |

---

## 🚦 3. Synchronization Log (Persistence Matrix)

The following actions **MUST** trigger a Cloud Push:
- [x] Adding/Editing/Deleting Medicine (`medicineMaster`)
- [x] Adding Inventory Entries (`inventory_counts`)
- [x] **Moving Medicine Category** (`executeTransfer` -> `Sync.push`)
- [x] Task/Session Lifecycle changes.

---

## 🧠 4. Lessons Learned & Error Log (Project History)

### Lesson 01: The v16.2.4 "Stuck at v14" incident
- **Context**: Code was updated but Service Worker didn't trigger an update.
- **Root Cause**: `CACHE_NAME` in `sw.js` was stagnant.
- **Resolution**: **Universal Version Bump** protocol established. Always update `sw.js` for ANY logic change to ensure PWA Refresh.

### Lesson 02: Broken Medicine Transfer
- **Context**: Transferring a medicine to another category failed or didn't persist.
- **Root Cause**: `undefined catId` crash and missing `Sync.push`.
- **Resolution**: Refined `executeTransfer` with direct `Sync.push` call and sanitizing variable scopes.

### Lesson 03: Service Worker Update Loop (v16.2.6)
- **Context**: Users seeing "Updated" but version remains old (e.g., stuck at v14).
- **Root Cause**: `sw.js` was included in `ASSETS_TO_CACHE`, causing the browser to cache the installer itself.
- **Resolution**: **NEVER** include `./sw.js` in the assets list. Always force `sw.js` to bypass cache (via fetch headers or simple removal from cache list).

### Lesson 04: Unified v17.2.0 Consolidation
- **Context**: Inconsistent version references across files (`16.2.6`, `17.1.6`, `17.2.0`).
- **Root Cause**: Partial upgrades left query strings and constants out of sync.
- **Resolution**: Strict single-version consolidation across `sw.js`, `index.html`, `js/app.js` and ES module imports.

### Lesson 05: Modernized 3-View Architecture & Instant Stock Controls (v17.2.3)
- **Context**: Cluttered navigation (5 confusing tabs), disconnected inventory vs. catalog, and non-interactive item rows.
- **Resolution**:
  - Streamlined to 3 clear views: الرئيسية (Dashboard), المستودع (Warehouse), الإعدادات (Settings & Reports), plus floating central Quick Add (+).
  - Integrated `getCurrentStockProducts()` so catalog medicines are never hidden if inventory table was freshly initialized.
  - Implemented interactive touch stock counters (`+` / `-`) with immediate IndexedDB update and cloud synchronization.
  - Wired direct one-click Excel reports (`full`, `expiring`, `low-stock`) using SheetJS.

### Lesson 06: Dedicated Hierarchical Audit Engine & Warehouse Multi-Dimensional Hub (v18.0.1)
- **Context**: Conflation of general warehouse catalog management with field audit stocktaking.
- **Resolution**:
  - Separated concerns into 4 clear bottom navigation tabs: الرئيسية (Dashboard), الجرد (Audit Hub), المستودع (Warehouse Hub), الإعدادات (Settings).
  - Warehouse Hub expanded into 3 dimensions via segmented controls: الأدوية (Medicines), التصنيفات (Categories), أماكن التخزين (Locations).
  - Added dynamic storage location management (صيدلية، ثلاجة، دولاب...) with per-location category restrictions.
  - Built 5-level hierarchical audit workflow:
    1. الجلسات (Sessions: Individual / Group, Hold ⏸️, Resume ▶️, Finalize 🏁)
    2. الأماكن المحددة (Square Locations Grid with Progress %)
    3. التصنيفات المرتبطة بالمكان (Square Categories Grid)
    4. أدوية القسم مع الفرز الذكي (Smart Sorting: Uncounted on top, Counted sinking to bottom with ✅ and count)
    5. نافذة تسجيل العد السريع (Quick Count Modal with quantity and expiry date)

### Lesson 07: Pure Master Warehouse, Multi-Batch Audit (Colors #2 & Auto-Suggest #4), Dedicated Expiry Monitor, and Complete Dark/Light Theme Overhaul (v18.1.0)
- **Context**: User feedback emphasized that the Warehouse is a pure master catalog database (no daily stock counters or expiry dates), location cards should only show clean names, categories should drill down into their medicines with move/add/delete actions, audit counting requires multi-batch entries with dynamic expiry color codes (User Selection #2) and auto-suggest of previous batches (User Selection #4), expiry monitoring belongs in a separate dedicated screen outside the warehouse, and the dark/light theme toggle was malfunctioning due to class mismatches (`dark-mode` vs `dark-theme`) and missing styles.
- **Resolution**:
  - Master Warehouse (`#wh-meds-section`): Removed +/- stock buttons and single expiry dates. Added clear Arabic/English names, prominent category tags with icons, and action menus (`نقل إلى تصنيف آخر`, `تعديل الدواء`, `حذف`).
  - Storage Locations Grid: Cleaned square cards to display only the location name and icon without clutter.
  - Interactive Category Drill-Down: Clicking a category card opens a full view of medicines inside that category, with actions to add a medicine to this category, move a medicine to another category, edit, or delete.
  - Multi-Batch Audit Counting (Selections #2 & #4):
    - Replaced single count with a dynamic multi-row batch table supporting different quantities and expiry dates with a `+ إضافة دفعة أخرى` button.
    - Implemented Selection #4: Auto-suggests and prefills previously known batches and expiry dates from the system inventory so staff only verify/adjust quantities.
    - Implemented Selection #2: Dynamic live color indicator badge on expiry date inputs (🔴 Red for <= 3 months or expired, 🟡 Yellow for 3-6 months, 🟢 Green for > 6 months) with live countdown in months.
    - Added live cumulative total quantity calculator.
  - Dedicated Expiry Monitor Screen: Built standalone view/modal accessible via Dashboard stat card and quick actions, displaying all medicines chronologically by earliest expiration date with KPI status cards (حرجة، تنبيه، صالحة), filter tabs, and real-time search.
  - Dark/Light Mode Theme Overhaul: Unified `dark-mode` and `dark-theme` classes across `ui.js` and `dark.css`, updated header and settings icons simultaneously, and provided full dark theme overrides for all cards, forms, inputs, modals, and segmented controls.

### Lesson 08: Exterior Batch Pills, Native Calendar Pickers, Warehouse Dropdown Filter, and Audit Origin Reference (v18.2.0)
- **Context**: Practical operational refinements requested by user:
  1. Multi-batch count modal required a clear separated "Add Batch Box" (`صندوق إضافة دفعة جديدة`) at the bottom rather than confusing in-place rows.
  2. Exterior medicine cards in audit needed to display total quantity and each batch breakdown (`[ 10 × 2026-03 🔴 ]`, `[ 15 × 2027-12 🟢 ]`) with color status directly on the card without opening the modal.
  3. Date inputs were difficult to type on mobile, needing native calendar/month pickers (`<input type="month">`) plus quick year shortcuts (`+1سنة`, `+2سنة`).
  4. Warehouse category chips were cut off when many categories existed; replaced by a clean category dropdown selector displaying all categories with icons and counts.
  5. Expiry Monitor needed clear attribution to which audit session the data is based on ("مرتكزة على أنهي جرد"), along with a session switcher dropdown and metadata.
- **Resolution**:
  - Audit Exterior Card: Counted cards render prominent total count and individual color-coded batch pill badges.
  - Multi-Batch Modal: Designed dedicated Add Batch Box at the bottom with `<input type="month">` native picker and quick year shortcuts, keeping the current batches neatly listed at the top.
  - Warehouse Category Filter: Replaced horizontal chips with full `#category-dropdown-select` containing every category and its medicine count.
  - Expiry Monitor: Added Audit Origin Reference Box showing session name, host, date, and status, with full dropdown support to switch between live stock and past audits.

### Lesson 09: Complete Audit Session Lifecycle (Edit, Delete, Archive, Report) and Strict Audit Independence (v18.3.0)
- **Context**: User asked where the audit goes after saving, required each audit to be completely independent without inheriting previous session quantities ("مالقيش كميات الي فاتت"), and needed full audit session management: editing sessions, deleting sessions, archiving completed sessions, and inspecting past audit breakdowns.
- **Resolution**:
  - Audit Independence: Each audit session is strictly scoped to its own counts. In any new session, medicine counts start blank (0 batches), ensuring true physical auditing.
  - Audit Destination Transparency: Finalizing an audit updates active inventory stock with actual counted batches and stamps a permanent historical record in `audit_sessions` archive.
  - Session Management:
    - Edit Session (`openEditAuditSessionModal`): rename session, switch type (individual/group), and re-assign storage locations.
    - Archive / Unarchive (`archiveAuditSession` / `unarchiveAuditSession`): move finished sessions to the historical archive or restore them.
    - Delete Session (`deleteAuditSession`): permanently remove session and its count records with double confirmation.
    - Session Report & Excel (`openAuditReportModal` / `exportAuditSession`): inspect full item breakdown for any past session with direct Excel export.

---

## 🎯 5. Tech Debt & Roadmap

- [ ] **Push Notifications**: Implement Firebase Cloud Messaging (FCM).
- [x] **Offline Guard**: Implemented real-time network status indicator badge & automatic reconnect sync (v17.2.0).
- [x] **Unified 3-View Warehouse Flow & Interactive Counters**: Completed in v17.2.3.
- [x] **Hierarchical Audit Workflow & Full Storage Location Management**: Completed in v18.0.1.
- [x] **Multi-Batch Audit with Auto-Suggest & Color Coding, Dedicated Expiry Monitor, Master Warehouse**: Completed in v18.1.0.
- [x] **Exterior Batch Pills, Calendar Picker, Category Dropdown, and Audit Reference in Expiry Monitor**: Completed in v18.2.0.
- [x] **Audit Session CRUD, Archiving, Dedicated Session Reports, and Strict Independence**: Completed in v18.3.0.
- [ ] **Conflict Solver**: Implement smarter "Multi-user edit" resolution.

---
**Status**: ACTIVE 🛡️🏗️🛡️🚀🔥
**Last Updated**: v18.3.0 (Unified Master Protocol)
