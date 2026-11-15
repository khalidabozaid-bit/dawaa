import { DB } from '../core/db.js';
import { Inventory } from './inventory.js';

/**
 * Excel Export Feature
 * Integrates with SheetJS (XLSX) to generate medical inventory reports.
 */

export const Exporter = {
    async exportToExcel(type = 'full', options = {}) {
        console.log(`Dawaa Exporter: Starting ${type} export...`);
        
        let stockProducts = await Inventory.getCurrentStockProducts();
        let data = [...stockProducts];

        // Filter logic
        if (type === 'expiring') {
            const sixMonthsAway = new Date();
            sixMonthsAway.setMonth(sixMonthsAway.getMonth() + 6);
            data = data.filter(item => {
                const exp = item.earliestExpiry || item.expiryDate;
                return exp && new Date(exp) <= sixMonthsAway;
            });
        } else if (type === 'low-stock') {
            data = data.filter(item => (item.totalQuantity !== undefined ? item.totalQuantity : item.quantity || 0) <= 5);
        } else if (type === 'custom') {
            data = data.filter(i => {
                const matchLoc = options.location === 'all' || (i.location === options.location);
                return matchLoc;
            });
        }

        if (data.length === 0) {
            alert('لا توجد بيانات لتصديرها لهذا النوع من التقارير');
            return;
        }

        // Transform for Excel
        const worksheetData = data.map(item => {
            return {
                'اسم الدواء (إنجليزي)': item.nameEN || 'Unknown',
                'اسم الدواء (عربي)': item.nameAR || '-',
                'التصنيف': item.categoryId || 'عام',
                'الكمية المتوفرة': item.totalQuantity !== undefined ? item.totalQuantity : (item.quantity || 0),
                'تاريخ الصلاحية': item.earliestExpiry || item.expiryDate || 'N/A',
                'الموقع بالمستودع': (item.entries && item.entries[0] && item.entries[0].location) || item.location || 'المستودع الرئيسي'
            };
        });

        // Use Global XLSX (exposed by script tag)
        if (typeof XLSX === 'undefined') {
            alert('أداة تصدير Excel غير متوفرة حالياً، يرجى التحقق من اتصال الإنترنت');
            return;
        }

        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
        
        const typeArabic = type === 'expiring' ? 'تنبيه_الصلاحيات' : (type === 'low-stock' ? 'الارصدة_الحرجة' : 'المخزون_الشامل');
        const fileName = `Dawaa_${typeArabic}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    },

    async exportBackupJSON() {
        console.log('Dawaa Exporter: Creating full JSON backup...');
        const backup = {
            version: '4.0',
            exportedAt: new Date().toISOString(),
            categories: await DB.getAll('categories'),
            medicineMaster: await DB.getAll('medicineMaster'),
            inventory: await DB.getAll('inventory')
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Dawaa_Backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async importBackupJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.categories || !data.medicineMaster || !data.inventory) {
                        throw new Error('ملف النسخة الاحتياطية غير صالح');
                    }

                    // Confirm before clearing
                    if (!confirm('سيتم استبدال كافة البيانات الحالية بالنسخة الاحتياطية. هل أنت متأكد؟')) {
                        return resolve(false);
                    }

                    // Import to DB
                    for (const cat of data.categories) await DB.put('categories', cat);
                    for (const med of data.medicineMaster) await DB.put('medicineMaster', med);
                    for (const inv of data.inventory) await DB.put('inventory', inv);

                    resolve(true);
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }
};
