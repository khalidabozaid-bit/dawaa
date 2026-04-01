const fs = require('fs');
const path = require('path');

// Mocking the data since we can't import ES modules easily in a simple script
const CATEGORY_MAP = {
    'Antibiotics': { ar: 'مضادات حيوية' },
    'NSAID': { ar: 'مسكنات وآلام' },
    'Anti-Flu': { ar: 'أدوية البرد' },
    'Laryng.': { ar: 'أذن وحنجرة' },
    'Local Prep': { ar: 'كريمات ودهانات' },
    'GIT Prep': { ar: 'أدوية المعدة' },
    'Respiratory': { ar: 'جهاز تنفسي' },
    'Eye-Ear-Nose': { ar: 'قطرات عيون وأذن' },
    'Injections': { ar: 'حقن' },
    'Consumables': { ar: 'مستلزمات طبية' }
};

const SEED_MEDICINES = [
    { name: "Hibiotic 1 gm tab", category: "Antibiotics", type: "medicine" },
    { name: "augmentin 1 GM", category: "Antibiotics", type: "medicine" },
    { name: "xithrone 500 tab (5 tab)", category: "Antibiotics", type: "medicine" },
    { name: "Ciprofar 500", category: "Antibiotics", type: "medicine" },
    { name: "Flumox 500", category: "Antibiotics", type: "medicine" },
    { name: "dalacin c 300", category: "Antibiotics", type: "medicine" },
    { name: "Paracetamol", category: "Antibiotics", type: "medicine" },
    { name: "Panadol Advance / dolipran", category: "Antibiotics", type: "medicine" },
    { name: "bi-profenid", category: "NSAID", type: "medicine" },
    { name: "flotac cap", category: "NSAID", type: "medicine" },
    { name: "Ketofan 50 mg cap", category: "NSAID", type: "medicine" },
    { name: "Cataflam 50mg tab.", category: "NSAID", type: "medicine" },
    { name: "Catafast Sachets", category: "NSAID", type: "medicine" },
    { name: "celebrex 200 mg", category: "NSAID", type: "medicine" },
    { name: "Myofen", category: "NSAID", type: "medicine" },
    { name: "Ms.Relaxan Dimra", category: "NSAID", type: "medicine" },
    { name: "multirelax 5 MG", category: "NSAID", type: "medicine" },
    { name: "Relaxon cap", category: "NSAID", type: "medicine" },
    { name: "Alphintern", category: "NSAID", type: "medicine" },
    { name: "Panadol cold & Flu", category: "Anti-Flu", type: "medicine" },
    { name: "DECANSET", category: "Anti-Flu", type: "medicine" },
    { name: "telefast 180 mg", category: "Anti-Flu", type: "medicine" },
    { name: "claritin", category: "Anti-Flu", type: "medicine" },
    { name: "zyrtec", category: "Anti-Flu", type: "medicine" },
    { name: "Rhinopro SR", category: "Anti-Flu", type: "medicine" },
    { name: "SEMSEM Loz", category: "Laryng.", type: "medicine" },
    { name: "Larypro", category: "Laryng.", type: "medicine" },
    { name: "Cretard 500mg C", category: "Laryng.", type: "medicine" },
    { name: "Kenacomb", category: "Local-Prep", type: "medicine" },
    { name: "Fusi Fucidine", category: "Local-Prep", type: "medicine" },
    { name: "Fusi-Zon Fusicort", category: "Local-Prep", type: "medicine" },
    { name: "miconaz cream", category: "Local-Prep", type: "medicine" },
    { name: "Betaderm", category: "Local-Prep", type: "medicine" },
    { name: "BBC", category: "Local-Prep", type: "medicine" },
    { name: "oracure jel", category: "Local-Prep", type: "medicine" },
    { name: "Rheumatizne 30 mg", category: "Local-Prep", type: "medicine" },
    { name: "mebo ointement", category: "Local-Prep", type: "medicine" },
    { name: "pridocaine Cream", category: "Local-Prep", type: "medicine" },
    { name: "spasmo-digestin", category: "GIT-Prep", type: "medicine" },
    { name: "minalax", category: "GIT-Prep", type: "medicine" },
    { name: "viscralgine", category: "GIT-Prep", type: "medicine" },
    { name: "ondalenz 8 mg film", category: "GIT-Prep", type: "medicine" },
    { name: "gastreg", category: "GIT-Prep", type: "medicine" },
    { name: "streptoken", category: "GIT-Prep", type: "medicine" },
    { name: "ciprodiazol 500", category: "GIT-Prep", type: "medicine" },
    { name: "Antinal", category: "GIT-Prep", type: "medicine" },
    { name: "Rani 150 Eff. Gran.", category: "GIT-Prep", type: "medicine" },
    { name: "malox cid", category: "GIT-Prep", type: "medicine" },
    { name: "antopral 40", category: "GIT-Prep", type: "medicine" },
    { name: "selgon", category: "Respiratory", type: "medicine" },
    { name: "phenadone syrup", category: "Respiratory", type: "medicine" },
    { name: "prozolin", category: "Eye-Ear-Nose", type: "medicine" },
    { name: "voltarine amp", category: "Injections", type: "emergency" },
    { name: "dexamethazone amp", category: "Injections", type: "emergency" },
    { name: "avil amp", category: "Injections", type: "emergency" },
    { name: "heparin", category: "Injections", type: "emergency" },
    { name: "clexan 40", category: "Injections", type: "emergency" },
    { name: "Kapron amp", category: "Injections", type: "emergency" },
    { name: "plavix", category: "Injections", type: "medicine" },
    { name: "nitoderm patch 5", category: "Injections", type: "medicine" },
    { name: "daflon", category: "Injections", type: "medicine" },
    { name: "cefatraxone eva 1 gm", category: "Consumables", type: "supply" },
    { name: "N.saline 0.9% 500 ml", category: "Consumables", type: "supply" },
    { name: "iv cannula g 18", category: "Consumables", type: "supply" },
    { name: "iv cannula g 20", category: "Consumables", type: "supply" }
];

const dbRoot = path.join(__dirname, '..', 'database');

if (!fs.existsSync(dbRoot)) fs.mkdirSync(dbRoot);

const manifest = { categories: {} };

Object.keys(CATEGORY_MAP).forEach(catKey => {
    const catDirName = catKey.replace(/[.\/]/g, '-').replace(/\s+/g, '-');
    const catDir = path.join(dbRoot, catDirName);
    const imagesDir = path.join(catDir, 'images');

    if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

    const meds = SEED_MEDICINES.filter(m => m.category === catKey);
    
    // Create CSV Header
    let csvContent = "Name,Type,Category,ImagePath\n";
    meds.forEach(m => {
        const imageName = m.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + ".png";
        const imagePath = `database/${catDirName}/images/${imageName}`;
        csvContent += `"${m.name}","${m.type}","${m.category}","${imagePath}"\n`;
    });

    fs.writeFileSync(path.join(catDir, 'data.csv'), csvContent);
    manifest.categories[catKey] = {
        arabic: CATEGORY_MAP[catKey].ar,
        medicines: meds.map(m => ({
            ...m,
            imagePath: `database/${catDirName}/images/${m.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`
        }))
    };
});

fs.writeFileSync(path.join(dbRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Database reorganization complete!');
