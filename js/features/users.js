// js/features/users.js
import { UI } from '../core/ui.js';

/**
 * Team & Users Management Feature (v18.4.0)
 * Manages active user profiles, switching counting roles, and team collaboration in audits.
 */

const DEFAULT_TEAM = [
    { id: 'user_khaled', name: 'د. خالد', role: 'admin', title: 'مدير الصيدلية والنظام', icon: 'bx-shield-quarter', color: '#3b82f6' },
    { id: 'user_ahmed', name: 'د. أحمد', role: 'staff', title: 'صيدلي أول - مسؤول الصرف', icon: 'bx-capsule', color: '#10b981' },
    { id: 'user_sara', name: 'د. سارة', role: 'staff', title: 'صيدلانية - قسم الأمصال والتبريد', icon: 'bx-fridge', color: '#06b6d4' },
    { id: 'user_emergency', name: 'فني الطوارئ', role: 'staff', title: 'مسؤول سيارة الإسعاف والطوارئ', icon: 'bx-ambulance', color: '#f59e0b' }
];

export const Users = {
    STORAGE_KEY: 'dawaa_team_members',
    ACTIVE_KEY: 'dawaa_active_user',

    init() {
        this.ensureDefaultTeam();
    },

    ensureDefaultTeam() {
        const existing = localStorage.getItem(this.STORAGE_KEY);
        if (!existing) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(DEFAULT_TEAM));
        }
        if (!localStorage.getItem(this.ACTIVE_KEY)) {
            localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(DEFAULT_TEAM[0]));
        }
    },

    getAll() {
        this.ensureDefaultTeam();
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || DEFAULT_TEAM;
        } catch (e) {
            return DEFAULT_TEAM;
        }
    },

    getActive() {
        this.ensureDefaultTeam();
        try {
            const active = JSON.parse(localStorage.getItem(this.ACTIVE_KEY));
            return active || DEFAULT_TEAM[0];
        } catch (e) {
            return DEFAULT_TEAM[0];
        }
    },

    setActive(user) {
        if (!user) return;
        localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(user));
        
        // Sync with global window.App context
        if (window.App) {
            window.App.user = {
                uid: user.id,
                displayName: user.name,
                email: `${user.id}@dawaa.local`,
                role: user.role
            };
            window.App.userRole = user.role;
            window.App.userName = user.name;
        }

        const nameEl = document.getElementById('display-user-name');
        if (nameEl) nameEl.textContent = user.name;

        UI.showToast(`تم تعيين المستخدم الحالي: ${user.name} 👤`, 'success');
        return user;
    },

    addUser({ name, title, role = 'staff' }) {
        if (!name || !name.trim()) {
            UI.showToast('يرجى إدخال اسم العضو', 'warning');
            return null;
        }
        const team = this.getAll();
        const newUser = {
            id: `user_${Date.now()}`,
            name: name.trim(),
            title: title ? title.trim() : (role === 'admin' ? 'مدير صيدلية' : 'صيدلي ميداني'),
            role: role,
            icon: role === 'admin' ? 'bx-shield-quarter' : 'bx-user',
            color: role === 'admin' ? '#8b5cf6' : '#10b981'
        };
        team.push(newUser);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(team));
        UI.showToast(`تمت إضافة ${newUser.name} إلى فريق العمل بنجاح ✅`, 'success');
        return newUser;
    },

    updateUser(id, { name, title, role }) {
        let team = this.getAll();
        const idx = team.findIndex(u => u.id === id);
        if (idx === -1) return null;
        if (name && name.trim()) team[idx].name = name.trim();
        if (title !== undefined) team[idx].title = title.trim();
        if (role) {
            team[idx].role = role;
            team[idx].icon = role === 'admin' ? 'bx-shield-quarter' : 'bx-user';
            team[idx].color = role === 'admin' ? '#8b5cf6' : '#10b981';
        }
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(team));
        
        const active = this.getActive();
        if (active.id === id) {
            this.setActive(team[idx]);
        }
        UI.showToast(`تم تحديث بيانات ${team[idx].name} بنجاح ✨`, 'success');
        return team[idx];
    },

    deleteUser(id) {
        const active = this.getActive();
        if (active.id === id) {
            UI.showToast('لا يمكن حذف المستخدم النشط حالياً', 'warning');
            return false;
        }
        let team = this.getAll();
        team = team.filter(u => u.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(team));
        UI.showToast('تم حذف المستخدم من الفريق', 'info');
        return true;
    }
};
