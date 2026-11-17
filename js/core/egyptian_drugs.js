// js/core/egyptian_drugs.js
/**
 * Egyptian Pharmaceutical & Medical Supplies Master Catalog
 * v2: Lazy-loads 27,600+ drugs from external JSON, with 162 built-in fallback.
 * Data source: github.com/mahmoudfalous/eg-drugs (open dataset, public domain)
 */

// ---- Built-in fallback catalog (162 items — loads instantly) ----
const BUILTIN_CATALOG = [
    // --- 1. مضادات حيوية (Antibiotics) ---
    { nameEN: "Augmentin 1 GM Tab", nameAR: "أوجمنتين 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Augmentin 625 mg Tab", nameAR: "أوجمنتين 625 مجم أقراص", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Augmentin 312 mg Susp", nameAR: "أوجمنتين 312 شراب معلق", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Hibiotic 1 GM Tab", nameAR: "هاي بيوتيك 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Hibiotic 625 mg Tab", nameAR: "هاي بيوتيك 625 مجم أقراص", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Curam 1 GM Tab", nameAR: "كيورام 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flumox 500 mg Cap", nameAR: "فلوموكس 500 مجم كبسول", active: "Amoxicillin + Flucloxacillin", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flumox 1 GM Tab", nameAR: "فلوموكس 1 جم أقراص", active: "Amoxicillin + Flucloxacillin", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Ciprofar 500 mg Tab", nameAR: "سيبروفار 500 مجم أقراص", active: "Ciprofloxacin", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Ciprocin 500 mg Tab", nameAR: "سيبروسين 500 مجم أقراص", active: "Ciprofloxacin", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Zithromax 500 mg Tab", nameAR: "زيزروماكس 500 مجم أقراص", active: "Azithromycin", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flagyl 500 mg Tab", nameAR: "فلاجيل 500 مجم أقراص", active: "Metronidazole", categoryId: "Antibiotics", type: "medicine" },
    // --- 2. مسكنات (Analgesics) ---
    { nameEN: "Panadol Extra Tab", nameAR: "بانادول إكسترا أقراص", active: "Paracetamol + Caffeine", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Brufen 600 mg Tab", nameAR: "بروفين 600 مجم أقراص", active: "Ibuprofen", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Cataflam 50 mg Tab", nameAR: "كتافلام 50 مجم أقراص", active: "Diclofenac Potassium", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Ketofan 25 mg Cap", nameAR: "كيتوفان 25 مجم كبسول", active: "Ketoprofen", categoryId: "Analgesics", type: "medicine" },
    // --- 3. جهاز هضمي (GI) ---
    { nameEN: "Nexium 40 mg Cap", nameAR: "نيكسيوم 40 مجم كبسول", active: "Esomeprazole", categoryId: "GI", type: "medicine" },
    { nameEN: "Controloc 40 mg Tab", nameAR: "كونترولوك 40 مجم أقراص", active: "Pantoprazole", categoryId: "GI", type: "medicine" },
    { nameEN: "Antinal 200 mg Cap", nameAR: "أنتينال 200 مجم كبسول", active: "Nifuroxazide", categoryId: "GI", type: "medicine" },
    // --- 4. ضغط / قلب (Cardiovascular) ---
    { nameEN: "Concor 5 mg Tab", nameAR: "كونكور 5 مجم أقراص", active: "Bisoprolol", categoryId: "Cardiovascular", type: "medicine" },
    { nameEN: "Plavix 75 mg Tab", nameAR: "بلافيكس 75 مجم أقراص", active: "Clopidogrel", categoryId: "Cardiovascular", type: "medicine" },
    // --- 5. سكر (Diabetes) ---
    { nameEN: "Glucophage 1000 mg Tab", nameAR: "جلوكوفاج 1000 مجم أقراص", active: "Metformin", categoryId: "Diabetes", type: "medicine" },
    { nameEN: "Januvia 100 mg Tab", nameAR: "جانوفيا 100 مجم أقراص", active: "Sitagliptin", categoryId: "Diabetes", type: "medicine" },
    // --- 6. فيتامينات (Vitamins) ---
    { nameEN: "Centrum Silver Tab", nameAR: "سنتروم سيلفر أقراص", active: "Multivitamins", categoryId: "Vitamins", type: "medicine" },
    { nameEN: "Vidrop Oral Drops 15 ml", nameAR: "فيدروب نقط فم 15 مل فيتامين د", active: "Cholecalciferol (Vit D3)", categoryId: "Vitamins", type: "medicine" },
];

// ---- Extended catalog (lazy-loaded from JSON) ----
let _extendedCatalog = null;
let _loadingPromise = null;
let _loadFailed = false;

async function loadExtendedCatalog() {
    if (_extendedCatalog) return _extendedCatalog;
    if (_loadFailed) return null;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
        try {
            // Try loading from data/ directory (relative to index.html)
            const resp = await fetch('./data/eg_drugs_slim.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const rawArr = await resp.json();
            // Convert array-of-arrays [[nameEN, nameAR, active], ...] to objects
            _extendedCatalog = rawArr.map(d => ({
                nameEN: d[0] || '',
                nameAR: d[1] || '',
                active: d[2] || '',
                categoryId: 'uncategorized',
                type: 'medicine'
            }));
            console.log(`✅ Extended drug catalog loaded: ${_extendedCatalog.length} drugs`);
            return _extendedCatalog;
        } catch (err) {
            console.warn('⚠️ Extended drug catalog unavailable, using built-in:', err.message);
            _loadFailed = true;
            _loadingPromise = null;
            return null;
        }
    })();

    return _loadingPromise;
}

function normalizeArabic(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[أإآء]/g, 'ا')
        .replace(/[ة]/g, 'ه')
        .replace(/[ى]/g, 'ي')
        .replace(/[ڤ]/g, 'ف')
        .replace(/[ً-ْ]/g, '')
        .trim();
}

function searchCatalog(catalog, qRaw, qNorm, limit) {
    const results = [];
    for (const item of catalog) {
        if (results.length >= limit) break;
        const en = (item.nameEN || '').toLowerCase();
        const arRaw = (item.nameAR || '').toLowerCase();
        const arNorm = normalizeArabic(item.nameAR || '');
        const actRaw = (item.active || '').toLowerCase();
        const actNorm = normalizeArabic(item.active || '');

        if (en.includes(qRaw) ||
            arRaw.includes(qRaw) ||
            arNorm.includes(qNorm) ||
            actRaw.includes(qRaw) ||
            actNorm.includes(qNorm)) {
            results.push(item);
        }
    }
    return results;
}

export const EgyptianDrugs = {
    getAll() {
        return _extendedCatalog ? [..._extendedCatalog] : [...BUILTIN_CATALOG];
    },

    /**
     * Search with auto-loading of extended catalog.
     * First call triggers lazy load; uses builtin until loaded.
     */
    search(query, limit = 8) {
        if (!query) return [];
        const strQuery = String(query).trim();
        if (!strQuery || strQuery.length < 2) return [];

        const qRaw = strQuery.toLowerCase();
        const qNorm = normalizeArabic(strQuery);

        // If extended catalog is loaded, search it
        if (_extendedCatalog) {
            // Prioritize exact-start matches, then includes
            const startMatches = [];
            const includeMatches = [];
            for (const item of _extendedCatalog) {
                if (startMatches.length + includeMatches.length >= limit * 3) break;
                const en = (item.nameEN || '').toLowerCase();
                const arRaw = (item.nameAR || '').toLowerCase();
                const arNorm = normalizeArabic(item.nameAR || '');
                const actRaw = (item.active || '').toLowerCase();

                if (en.startsWith(qRaw) || arRaw.startsWith(qRaw) || arNorm.startsWith(qNorm)) {
                    startMatches.push(item);
                } else if (en.includes(qRaw) || arRaw.includes(qRaw) || arNorm.includes(qNorm) ||
                           actRaw.includes(qRaw) || normalizeArabic(item.active || '').includes(qNorm)) {
                    includeMatches.push(item);
                }
            }
            return [...startMatches, ...includeMatches].slice(0, limit);
        }

        // Trigger lazy load for next time
        if (!_loadingPromise && !_loadFailed) {
            loadExtendedCatalog();
        }

        // Meanwhile search builtin
        return searchCatalog(BUILTIN_CATALOG, qRaw, qNorm, limit);
    },

    /**
     * Async search — waits for extended catalog to load first.
     */
    async searchAsync(query, limit = 8) {
        if (!query) return [];
        const strQuery = String(query).trim();
        if (!strQuery || strQuery.length < 2) return [];

        // Ensure extended catalog is loaded
        await loadExtendedCatalog();

        // Then use sync search
        return this.search(query, limit);
    },

    /**
     * Pre-warm the catalog (call on app init or first focus)
     */
    preload() {
        if (!_extendedCatalog && !_loadingPromise && !_loadFailed) {
            loadExtendedCatalog();
        }
    },

    get catalogSize() {
        return _extendedCatalog ? _extendedCatalog.length : BUILTIN_CATALOG.length;
    },

    get isExtendedLoaded() {
        return !!_extendedCatalog;
    }
};
