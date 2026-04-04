import { DB } from '../core/db.js';
import { Sync } from '../core/sync.js';
import { UI } from '../core/ui.js';
import { Inventory } from './inventory.js';

/**
 * Audit Management Service (v11.0.0 Architectural Sovereign)
 * Handles lifecycle, presence, and session state.
 */
export const Audit = {
    activeSession: null,
    isJoined: false,

    async start(mode, user) {
        if (mode === 'team' && window.App?.userRole !== 'admin') {
            return UI.showToast('صلاحيات المدير مطلوبة لبدء جرد جماعي ⚖️', 'warning');
        }
        
        const name = prompt('أدخل اسم عملية الجرد (مثلاً: جرد الرفوف الأمامية):');
        if (!name) return null;

        const session = {
            id: 'audit_' + Date.now(),
            name: name,
            type: mode,
            host: user.displayName || user.email,
            participants: [user.displayName || user.email],
            startTime: new Date().toISOString()
        };

        if (mode === 'team') {
            await DB.put('audits', session);
            Sync.broadcastAuditStatus(session);
        }
        
        return session;
    },

    async join(userName) {
        if (await Sync.joinAudit(userName)) {
            this.isJoined = true;
            return true;
        }
        return false;
    },

    async end() {
        if (!confirm('هل أنت متأكد من إنهاء عملية الجرد الحالية؟')) return false;
        Sync.broadcastAuditStatus(null);
        return true;
    },

    /**
     * Operational Analytics (v12.0.0 Command Hub)
     */
    async getSessionStats(auditId) {
        if (!auditId) return { totalEntries: 0, totalUnits: 0, uniqueCount: 0 };
        
        const entries = await Inventory.getEntriesByAudit(auditId);
        const uniqueMeds = new Set(entries.map(e => e.medicineId));
        
        const totalUnits = entries.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0), 0);
        
        // Leaderboard & Location Matrix
        let parts = {};
        let locs = {};

        entries.forEach(e => {
            let uName = e.userName && e.userName.trim() ? e.userName : 'عضو خفي';
            parts[uName] = (parts[uName] || 0) + 1; // Count of successful additions

            let lName = e.location || 'غير محدد';
            locs[lName] = (locs[lName] || 0) + 1;
        });

        return {
            totalEntries: entries.length,
            totalUnits: totalUnits,
            uniqueCount: uniqueMeds.size,
            participantsStatus: Object.entries(parts)
                                    .map(([name, count]) => ({name, count}))
                                    .sort((a,b)=> b.count - a.count), // Sort by highest
            locations: Object.entries(locs)
                                    .map(([name, count]) => ({name, count}))
                                    .sort((a,b)=> b.count - a.count)
        };
    }
};
