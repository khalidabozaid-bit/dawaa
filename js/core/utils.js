// js/core/utils.js
/**
 * Dawaa Utility Functions
 * Pure helpers for formatting, IDs, and calculations.
 */

export const Utils = {
    generateId() {
        return crypto.randomUUID();
    },

    formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
    },

    getExpiryStatus(expiryDate) {
        if (!expiryDate) return { label: 'غير محدد', class: 'status-unknown' };
        
        const now = new Date();
        const exp = new Date(expiryDate);
        const diffMonths = (exp.getFullYear() - now.getFullYear()) * 12 + (exp.getMonth() - now.getMonth());

        if (diffMonths < 0) return { label: 'منتهي', class: 'status-expired' };
        if (diffMonths <= 6) return { label: 'قريب الانتهاء', class: 'status-warning' };
        return { label: 'صالح', class: 'status-safe' };
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }
};
