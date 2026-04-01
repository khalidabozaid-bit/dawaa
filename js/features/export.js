import { DB } from '../core/db.js';

/**
 * Excel Export Feature
 * Integrates with SheetJS (XLSX) to generate medical inventory reports.
 */

export const Exporter = {
    async exportToExcel(type = 'full', options = {}) {
        console.log(`Dawaa Exporter: Starting ${type} export...`);
        
        let data = await DB.getAll('inventory');
        const masterData = await DB.getAll('medicineMaster');
        const masterMap = new Map(masterData.map(m => [m.id, m]));

        // Filter logic
        if (type === 'expiring') {
            const sixMonthsAway = new Date();
            sixMonthsAway.setMonth(sixMonthsAway.getMonth() + 6);
            data = data.filter(item => item.expiryDate && new Date(item.expiryDate) <= sixMonthsAway);
        } else if (type === 'low-stock') {
            data = data.filter(item => item.quantity <= 5);
        } else if (type === 'custom') {
            data = data.filter(i => {
                const matchLoc = options.location === 'all' || i.location === options.location;
                const matchType = options.type === 'all' || i.type === options.type;
                return matchLoc && matchType;
            });
        }

        if (data.length === 0) {
            alert('لا توجد بيانات لتصديرها لهذا النوع من التقارير');
            return;
        }

        // Transform for Excel
        const worksheetData = data.map(item => {
            const master = masterMap.get(item.medicineId) || {};
            return {
                'الأصناف (الاسم)': master.nameEN || 'Unknown',
                'الاسم بالعربي': master.nameAR || 'غير معروف',
                'الموقع': item.location,
                'الكمية الحالية': item.quantity,
                'تاريخ الصلاحية': item.expiryDate || 'N/A',
                'التصنيف': master.category || 'N/A',
                'التاريخ المسجل': item.timestamp ? new Date(item.timestamp).toLocaleDateString('ar-EG') : '-'
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
        
        const fileName = `Dawaa_Inventory_${type}_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.xlsx`;
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
