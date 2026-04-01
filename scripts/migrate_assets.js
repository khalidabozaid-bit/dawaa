// scripts/migrate_assets.js
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '../database/manifest.json');
const TARGET_DIR = path.join(__dirname, '../assets/products');

if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });

const PREFIX_MAP = {
    'Antibiotics': 'A',
    'NSAID': 'B',
    'Anti-Flu': 'C',
    'Laryng.': 'D',
    'Local Prep': 'E',
    'GIT Prep': 'F',
    'Respiratory': 'G',
    'Eye-Ear-Nose': 'H',
    'Injections': 'I',
    'Consumables': 'J'
};

const SYNC_MEDICINES = [];

function migrate() {
    console.log('--- Dawaa Asset Migration ---');
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error('Manifest not found at:', MANIFEST_PATH);
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const categories = manifest.categories;

    for (const catKey in categories) {
        const cat = categories[catKey];
        const prefix = PREFIX_MAP[catKey] || 'X';
        console.log(`Processing Category: ${catKey} (Prefix: ${prefix})`);

        cat.medicines.forEach((med, idx) => {
            const num = (idx + 1).toString().padStart(2, '0');
            const newId = `${prefix}${num}`;
            const oldPath = path.join(__dirname, '..', med.imagePath);
            const newPath = path.join(TARGET_DIR, `${newId}.png`);

            console.log(`  -> Moving ${med.name} to ${newId}`);

            if (fs.existsSync(oldPath)) {
                fs.copyFileSync(oldPath, newPath);
                console.log(`     [OK] Copied image.`);
            } else {
                console.warn(`     [WARN] Image not found: ${oldPath}`);
            }

            SYNC_MEDICINES.push({
                id: newId,
                nameEN: med.name,
                nameAR: med.name,
                activeIngredient: med.active || '',
                categoryId: catKey,
                type: med.type || 'medicine',
                imagePath: `assets/products/${newId}.png`
            });
        });
    }

    // Output for seed_data.js
    console.log('\n--- Migration Results for SEED_MEDICINES ---');
    const seedContent = `export const SEED_MEDICINES = ${JSON.stringify(SYNC_MEDICINES, null, 4)};`;
    fs.writeFileSync(path.join(__dirname, '../js/core/seed_data.js'), generateSeedDataFile(SYNC_MEDICINES));
    console.log('Seed data updated successfully.');
}

function generateSeedDataFile(meds) {
    return `// js/core/seed_data.js
export const CATEGORY_MAP = {
    'Antibiotics': { ar: 'مضادات حيوية', icon: 'bx-dna', color: '#3b82f6', prefix: 'A' },
    'NSAID': { ar: 'مسكنات وآلام', icon: 'bx-plus-medical', color: '#ef4444', prefix: 'B' },
    'Anti-Flu': { ar: 'أدوية البرد', icon: 'bx-wind', color: '#06b6d4', prefix: 'C' },
    'Laryng.': { ar: 'أذن وحنجرة', icon: 'bx-microphone-off', color: '#8b5cf6', prefix: 'D' },
    'Local Prep': { ar: 'كريمات ودهانات', icon: 'bx-spray-can', color: '#10b981', prefix: 'E' },
    'GIT Prep': { ar: 'أدوية المعدة', icon: 'bx-dish', color: '#f59e0b', prefix: 'F' },
    'Respiratory': { ar: 'جهاز تنفسي', icon: 'bx-mask', color: '#6366f1', prefix: 'G' },
    'Eye-Ear-Nose': { ar: 'قطرات عيون وأذن', icon: 'bx-bullseye', color: '#ec4899', prefix: 'H' },
    'Injections': { ar: 'حقن', icon: 'bx-injection', color: '#f43f5e', prefix: 'I' },
    'Consumables': { ar: 'مستلزمات طبية', icon: 'bx-package', color: '#64748b', prefix: 'J' }
};

export const SEED_MEDICINES = ${JSON.stringify(meds, null, 4)};
`;
}

migrate();
