# 🛡️ Dawaa Master Protocol (SYSTEM_PROTOCOL v16.2.5) 🛡️

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

---

## 🎯 5. Tech Debt & Roadmap

- [ ] **Push Notifications**: Implement Firebase Cloud Messaging (FCM).
- [ ] **Offline Guard**: Improve UI indicators when Firestore is unreachable.
- [ ] **Conflict Solver**: Implement smarter "Multi-user edit" resolution.

---
**Status**: ACTIVE 🛡️🏗️🛡️🚀🔥
**Last Updated**: v16.2.5 (Established Master Protocol)
