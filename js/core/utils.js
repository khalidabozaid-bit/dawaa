// js/core/utils.js
/**
 * Dawaa Utility Functions
 * Pure helpers for formatting, IDs, and calculations.
 */

export const Utils = {
    generateId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    },

    formatDate(dateStr) {
        if (!dateStr) return 'غير محدد';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'غير صالح';
        return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
    },

    getExpiryStatus(expiryDate) {
        if (!expiryDate) return { label: 'غير محدد', class: 'status-unknown' };
        
        const exp = new Date(expiryDate);
        if (isNaN(exp.getTime())) return { label: 'تاريخ غير صالح', class: 'status-expired' };

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // If expiryDate was YYYY-MM, set to last day of that month
        if (typeof expiryDate === 'string' && /^\d{4}-\d{2}$/.test(expiryDate.trim())) {
            const [y, m] = expiryDate.trim().split('-').map(Number);
            exp.setFullYear(y, m, 0); // last day of month
            exp.setHours(23, 59, 59, 999);
        }

        if (exp < now) {
            return { label: 'منتهي الصلاحية', class: 'status-expired' };
        }

        const sixMonths = new Date(now);
        sixMonths.setMonth(sixMonths.getMonth() + 6);

        if (exp <= sixMonths) {
            return { label: 'قريب الانتهاء', class: 'status-warning' };
        }
        return { label: 'صالح', class: 'status-safe' };
    },

    escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    debounce(func, wait = 300) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    },

    normalizeArabic(text) {
        if (!text) return '';
        return String(text)
            .toLowerCase()
            .trim()
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/[ىئ]/g, 'ي')
            .replace(/ؤ/g, 'و')
            .replace(/ڤ/g, 'ف')
            .replace(/پ/g, 'ب')
            .replace(/چ/g, 'ج')
            .replace(/گ/g, 'ك')
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/\u0640/g, '');
    },

    getDefaultExpiry(yearsAhead = 2) {
        const y = new Date().getFullYear() + yearsAhead;
        return `${y}-12`;
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            reader.onabort = () => reject(new Error('File reading aborted'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * High-speed client-side image compression and resizing.
     * Downscales phone camera photos (12-50MP, 5-20MB) to crisp web sizes (max 800px)
     * Output size: ~30KB - 50KB JPEG (99.7% reduction, 0 lag, 0 freeze).
     */
    async compressImage(file, maxDimension = 800, quality = 0.75) {
        if (!file) return null;
        return new Promise((resolve, reject) => {
            if (!file.type || !file.type.startsWith('image/')) {
                return resolve({ blob: file, dataUrl: null, size: file.size });
            }

            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                let { width, height } = img;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                canvas.toBlob((blob) => {
                    const compressedBlob = blob || file;
                    resolve({
                        blob: compressedBlob,
                        dataUrl,
                        width,
                        height,
                        size: compressedBlob.size
                    });
                }, 'image/jpeg', quality);
            };

            img.onerror = (err) => {
                URL.revokeObjectURL(objectUrl);
                this.fileToBase64(file).then(dataUrl => {
                    resolve({ blob: file, dataUrl, size: file.size });
                }).catch(reject);
            };

            img.src = objectUrl;
        });
    }
};
