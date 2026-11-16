import { DB } from '../core/db.js';
import { Inventory } from './inventory.js';

/**
 * Excel Export Feature
 * Integrates with SheetJS (XLSX) to generate medical inventory reports.
 */

export const Exporter = {
    async exportToExcel(typeOrData = 'full', optionsOrFileName = {}) {
        if (typeof XLSX === 'undefined') {
            alert('أداة تصدير Excel غير متوفرة حالياً، يرجى التحقق من اتصال الإنترنت');
            return;
        }

        // Case A: Passed raw report array
        if (Array.isArray(typeOrData)) {
            if (typeOrData.length === 0) {
                alert('لا توجد بيانات لتصديرها');
                return;
            }
            const fileName = (typeof optionsOrFileName === 'string' && optionsOrFileName.trim()) 
                ? (optionsOrFileName.endsWith('.xlsx') ? optionsOrFileName : `${optionsOrFileName}.xlsx`)
                : `Dawaa_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
            const worksheet = XLSX.utils.json_to_sheet(typeOrData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
            XLSX.writeFile(workbook, fileName);
            return;
        }

        // Case B: Passed report type filter string
        const type = typeof typeOrData === 'string' ? typeOrData : 'full';
        const options = (typeof optionsOrFileName === 'object' && optionsOrFileName !== null) ? optionsOrFileName : {};
        
        let stockProducts = await Inventory.getCurrentStockProducts();
        let data = [...stockProducts];

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
                const matchLoc = !options.location || options.location === 'all' || (i.location === options.location);
                return matchLoc;
            });
        }

        if (data.length === 0) {
            alert('لا توجد بيانات لتصديرها لهذا النوع من التقارير');
            return;
        }

        const worksheetData = data.map(item => ({
            'اسم الدواء (إنجليزي)': item.nameEN || 'Unknown',
            'اسم الدواء (عربي)': item.nameAR || '-',
            'التصنيف': item.categoryId || 'عام',
            'الكمية المتوفرة': item.totalQuantity !== undefined ? item.totalQuantity : (item.quantity || 0),
            'تاريخ الصلاحية': item.earliestExpiry || item.expiryDate || 'N/A',
            'الموقع بالمستودع': item.location || 'المستودع الرئيسي'
        }));

        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
        
        const typeArabic = type === 'expiring' ? 'تنبيه_الصلاحيات' : (type === 'low-stock' ? 'الأرصدة_الحرجة' : 'المخزون_الشامل');
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
