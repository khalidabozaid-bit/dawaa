// js/core/egyptian_drugs.js
/**
 * Egyptian Pharmaceutical & Medical Supplies Master Catalog
 * v3: Lazy-loads 27,601 drugs (10,849 with verified EAN barcodes) from external JSON,
 *     with built-in fallback and smart multi-signal catalog matcher.
 * Data source: github.com/mahmoudfalous/eg-drugs (open dataset, public domain)
 */

// ---- Built-in fallback catalog (loads instantly) ----
const BUILTIN_CATALOG = [
    // --- 1. مضادات حيوية (Antibiotics) ---
    { nameEN: "Augmentin 1 GM Tab", nameAR: "أوجمنتين 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Augmentin 625 mg Tab", nameAR: "أوجمنتين 625 مجم أقراص", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Augmentin 312 mg Susp", nameAR: "أوجمنتين 312 شراب معلق", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Hibiotic 1 GM Tab", nameAR: "هاي بيوتيك 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Hibiotic 625 mg Tab", nameAR: "هاي بيوتيك 625 مجم أقراص", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Curam 1 GM Tab", nameAR: "كيورام 1 جم أقراص", active: "Amoxicillin + Clavulanic acid", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flumox 500 mg Cap", nameAR: "فلوموكس 500 مجم كبسول", active: "Amoxicillin + Flucloxacillin", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flumox 1 GM Tab", nameAR: "فلوموكس 1 جم أقراص", active: "Amoxicillin + Flucloxacillin", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Ciprofar 500 mg Tab", nameAR: "سيبروفار 500 مجم أقراص", active: "Ciprofloxacin", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Ciprocin 500 mg Tab", nameAR: "سيبروسين 500 مجم أقراص", active: "Ciprofloxacin", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Zithromax 500 mg Tab", nameAR: "زيزروماكس 500 مجم أقراص", active: "Azithromycin", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    { nameEN: "Flagyl 500 mg Tab", nameAR: "فلاجيل 500 مجم أقراص", active: "Metronidazole", barcode: "", categoryId: "Antibiotics", type: "medicine" },
    // --- 2. مسكنات (Analgesics) ---
    { nameEN: "Panadol Extra Tab", nameAR: "بانادول إكسترا أقراص", active: "Paracetamol + Caffeine", barcode: "", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Brufen 600 mg Tab", nameAR: "بروفين 600 مجم أقراص", active: "Ibuprofen", barcode: "", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Cataflam 50 mg Tab", nameAR: "كتافلام 50 مجم أقراص", active: "Diclofenac Potassium", barcode: "", categoryId: "Analgesics", type: "medicine" },
    { nameEN: "Ketofan 25 mg Cap", nameAR: "كيتوفان 25 مجم كبسول", active: "Ketoprofen", barcode: "", categoryId: "Analgesics", type: "medicine" },
    // --- 3. جهاز هضمي (GI) ---
    { nameEN: "Nexium 40 mg Cap", nameAR: "نيكسيوم 40 مجم كبسول", active: "Esomeprazole", barcode: "", categoryId: "Gastro", type: "medicine" },
    { nameEN: "Controloc 40 mg Tab", nameAR: "كونترولوك 40 مجم أقراص", active: "Pantoprazole", barcode: "", categoryId: "Gastro", type: "medicine" },
    { nameEN: "Antinal 200 mg Cap", nameAR: "أنتينال 200 مجم كبسول", active: "Nifuroxazide", barcode: "", categoryId: "Gastro", type: "medicine" },
    // --- 4. ضغط / قلب (Chronic) ---
    { nameEN: "Concor 5 mg Tab", nameAR: "كونكور 5 مجم أقراص", active: "Bisoprolol", barcode: "", categoryId: "Chronic", type: "medicine" },
    { nameEN: "Plavix 75 mg Tab", nameAR: "بلافيكس 75 مجم أقراص", active: "Clopidogrel", barcode: "", categoryId: "Chronic", type: "medicine" },
    // --- 5. سكر (Chronic) ---
    { nameEN: "Glucophage 1000 mg Tab", nameAR: "جلوكوفاج 1000 مجم أقراص", active: "Metformin", barcode: "", categoryId: "Chronic", type: "medicine" },
    { nameEN: "Januvia 100 mg Tab", nameAR: "جانوفيا 100 مجم أقراص", active: "Sitagliptin", barcode: "", categoryId: "Chronic", type: "medicine" },
    // --- 6. فيتامينات ---
    { nameEN: "Centrum Silver Tab", nameAR: "سنتروم سيلفر أقراص", active: "Multivitamins", barcode: "", categoryId: "uncategorized", type: "medicine" },
    { nameEN: "Vidrop Oral Drops 15 ml", nameAR: "فيدروب نقط فم 15 مل فيتامين د", active: "Cholecalciferol (Vit D3)", barcode: "", categoryId: "uncategorized", type: "medicine" },
];

// ---- Extended catalog (lazy-loaded from JSON) ----
let _extendedCatalog = null;
let _loadingPromise = null;
let _loadFailed = false;
let _enPrefixIndex = null;
let _arPrefixIndex = null;

function buildCatalogIndex(catalog) {
    const enIdx = new Map();
    const arIdx = new Map();
    for (let i = 0; i < catalog.length; i++) {
        const item = catalog[i];
        item._enLow = (item.nameEN || '').toLowerCase();
        item._arNorm = normalizeArabic(item.nameAR || '');
        item._actLow = (item.active || '').toLowerCase();

        // Fast first-token extraction for indexing without running all regexes on 27K items
        const enMatch = item._enLow.match(/[a-z0-9-]+/);
        const bEn = enMatch ? enMatch[0].replace(/-/g, '') : '';
        if (bEn.length >= 2) {
            const k = bEn.slice(0, 2);
            if (!enIdx.has(k)) enIdx.set(k, []);
            enIdx.get(k).push(item);
        }
        const arMatch = item._arNorm.match(/[\u0600-\u06FF0-9]+/);
        const bAr = arMatch ? arMatch[0] : '';
        if (bAr.length >= 2) {
            const k = bAr.slice(0, 2);
            if (!arIdx.has(k)) arIdx.set(k, []);
            arIdx.get(k).push(item);
        }
    }
    _enPrefixIndex = enIdx;
    _arPrefixIndex = arIdx;
}

async function loadExtendedCatalog() {
    if (_extendedCatalog) return _extendedCatalog;
    if (_loadFailed) return null;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
        try {
            const resp = await fetch('./data/eg_drugs_slim.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const rawArr = await resp.json();
            // Convert array-of-arrays [[nameEN, nameAR, active, barcode?], ...] to objects
            _extendedCatalog = rawArr.map(d => ({
                nameEN: d[0] || '',
                nameAR: d[1] || '',
                active: d[2] || '',
                barcode: d[3] || '',
                categoryId: 'uncategorized',
                type: 'medicine'
            }));
            buildCatalogIndex(_extendedCatalog);
            console.log(`✅ Extended drug catalog loaded & indexed: ${_extendedCatalog.length} drugs`);
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
        .replace(/[پ]/g, 'ب')
        .replace(/[ً-ْ]/g, '')
        .trim();
}

// ---- Smart Matching Helpers ----
const FORM_RULES = [
    { form: 'tab', re: /\b(tab|tabs|tablet|tablets|f\.?c\.?t|f\.?c\.?tabs?|e\.?c\.?t|s\.?r\.?t|chewable|lozenge|lozenges)\b|اقراص|أقراص|قرص|استحلاب/i },
    { form: 'cap', re: /\b(cap|caps|capsule|capsules|soft\s*gel|gelatin)\b|كبسول|كبسولات/i },
    { form: 'amp', re: /\b(amp|amps|ampoule|ampoules|vial|vials|inj|injection|i\.?v\.?|i\.?m\.?|infusion|prefilled|syringe)\b|امبول|أمبول|امبولات|فيال|حقن|حقنة/i },
    { form: 'syrup', re: /\b(syrup|syr|susp|suspension|oral\s*sol|elixir|mix|liquid)\b|شراب|معلق/i },
    { form: 'drops', re: /\b(drop|drops|eye\s*drop|ear\s*drop|nasal\s*drop)\b|نقط|قطره|قطرة/i },
    { form: 'cream', re: /\b(cream|cr|oint|ointment|gel|lotion|emulgel|foam|shampoo)\b|كريم|مرهم|جل|لوشن|دهان/i },
    { form: 'sachet', re: /\b(sachet|sachets|eff|effervescent|powder|granules)\b|اكياس|أكياس|كيس|فوار/i },
    { form: 'supp', re: /\b(supp|suppos|suppository|suppositories)\b|لبوس|تحاميل/i },
    { form: 'spray', re: /\b(spray|inhaler|nebule|nebules|discus|turbuhaler)\b|بخاخ|استنشاق|بخه/i },
    { form: 'patch', re: /\b(patch|patches|tts|plaster)\b|لصق|لصقات|لاصق/i }
];

const VARIANT_KEYWORDS = new Set(['extra', 'plus', 'forte', 'sr', 'cr', 'xr', 'er', 'mr', 'retard', 'advance', 'cold', 'flu', 'day', 'night', 'baby', 'kids', 'junior', 'pediatric', 'infant', 'duo', 'max', 'ultra', 'rapid', 'fast', 'night', 'sinus', 'migraine', 'direct', 'optizorb', 'es', 'h', 'm', 'd', 'c']);
const GENERIC_NOISE = new Set(['mg', 'gm', 'g', 'ml', 'mcg', 'iu', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'amp', 'amps', 'vial', 'syr', 'syrup', 'susp', 'drops', 'drop', 'cream', 'oint', 'ointment', 'gel', 'sachet', 'sachets', 'supp', 'spray', 'patch', 'fc', 'fct', 'ec', 'iv', 'im', 'for', 'oral', 'with', 'and', 'of', 'the', 'box', 'pack', 'strip', 'sugar', 'coated', 'film', 'scored', 'pd', 'inf', 'inj']);

function detectForms(text) {
    const forms = new Set();
    if (!text) return forms;
    for (const rule of FORM_RULES) {
        if (rule.re.test(text)) forms.add(rule.form);
    }
    return forms;
}

function extractStrengths(text) {
    if (!text) return [];
    const s = String(text).toLowerCase();
    const out = new Set();
    // Convert "1 gm" / "1g" / "1.5 gm" to mg equivalents too for cross-matching (1 gm === 1000 mg)
    const unitRe = /(\d+(?:\.\d+)?)\s*(gm|g|mg|mcg|iu|%)\b/gi;
    let m;
    while ((m = unitRe.exec(s)) !== null) {
        const val = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        if (!isNaN(val)) {
            if (unit === 'gm' || unit === 'g') {
                out.add(String(val * 1000));
                out.add(String(val));
            } else {
                out.add(String(val));
            }
        }
    }
    if (out.size === 0) {
        // Standalone numbers NOT directly followed by pack words (tabs/caps/amp/sachet/ml)
        const numRe = /\b(\d+(?:\.\d+)?)\b(?!\s*(?:f\.?c\.?t|tabs?|tablets?|caps?|capsules?|amps?|sachets?|lozenges?|patches?|strips?|vials?))/gi;
        while ((m = numRe.exec(s)) !== null) {
            const val = parseFloat(m[1]);
            if (!isNaN(val)) out.add(String(val));
        }
    }
    return Array.from(out);
}

function normalizeEnForTokens(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\bs\.?\s*r\.?\b/g, 'sr')
        .replace(/\bc\.?\s*r\.?\b/g, 'cr')
        .replace(/\bx\.?\s*r\.?\b/g, 'xr')
        .replace(/\bf\.?\s*c\.?\s*t(?:abs?)?\b/g, 'tab')
        .replace(/\bi\.?\s*v\.?\b/g, 'iv')
        .replace(/\bi\.?\s*m\.?\b/g, 'im')
        .replace(/\bi\.?\s*u\.?\b/g, 'iu');
}

function extractEnTokens(text) {
    if (!text) return [];
    const norm = normalizeEnForTokens(text);
    // Keep hyphenated brand tokens together (e.g. bi-profenid, c-retard, multi-relax)
    return norm
        .replace(/[^a-z0-9-]+/g, ' ')
        .replace(/(^|\s)-+|-+(\s|$)/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function pickBrandEN(tokens) {
    if (!tokens || tokens.length === 0) return '';
    // Prefer first non-noise, non-number token (normalized without hyphens for comparison)
    const first = tokens.find(t => !GENERIC_NOISE.has(t) && !/^\d+$/.test(t));
    return first ? first.replace(/-/g, '') : (tokens[0] || '').replace(/-/g, '');
}

function extractArTokens(text) {
    if (!text) return [];
    return normalizeArabic(text)
        .replace(/[^\u0600-\u06FF0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length >= 2);
}

function editDistanceAtMost(a, b, maxDist = 2) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > maxDist) return maxDist + 1;
        [prev, curr] = [curr, prev];
    }
    return prev[lb];
}

function toTitleCaseDrug(str) {
    if (!str) return '';
    return String(str).replace(/\b([a-z])([a-z]*)/g, (_, first, rest) => {
        const word = first + rest;
        if (['mg', 'gm', 'ml', 'mcg', 'g', 'of', 'for', 'and', 'or', 'in'].includes(word)) return word;
        if (['iv', 'im', 'sr', 'cr', 'xr', 'er', 'fc', 'fct', 'ec', 'iu', 'tts', 'es'].includes(word)) return word.toUpperCase();
        return first.toUpperCase() + rest;
    });
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
        const bc = (item.barcode || '').toLowerCase();

        if (en.includes(qRaw) ||
            arRaw.includes(qRaw) ||
            arNorm.includes(qNorm) ||
            actRaw.includes(qRaw) ||
            actNorm.includes(qNorm) ||
            (bc && bc.includes(qRaw))) {
            results.push(item);
        }
    }
    return results;
}

export const EgyptianDrugs = {
    getAll() {
        return _extendedCatalog ? [..._extendedCatalog] : [...BUILTIN_CATALOG];
    },

    async ensureLoaded() {
        await loadExtendedCatalog();
        return _extendedCatalog || BUILTIN_CATALOG;
    },

    /**
     * Search with auto-loading of extended catalog.
     * Supports English name, Arabic name, active ingredient, and barcode.
     */
    search(query, limit = 8) {
        if (!query) return [];
        const strQuery = String(query).trim();
        if (!strQuery || strQuery.length < 2) return [];

        const qRaw = strQuery.toLowerCase();
        const qNorm = normalizeArabic(strQuery);

        if (_extendedCatalog) {
            const startMatches = [];
            const includeMatches = [];
            for (const item of _extendedCatalog) {
                if (startMatches.length + includeMatches.length >= limit * 3) break;
                const en = (item.nameEN || '').toLowerCase();
                const arRaw = (item.nameAR || '').toLowerCase();
                const arNorm = normalizeArabic(item.nameAR || '');
                const actRaw = (item.active || '').toLowerCase();
                const bc = item.barcode || '';

                if (bc && bc === strQuery) {
                    startMatches.unshift(item);
                } else if (en.startsWith(qRaw) || arRaw.startsWith(qRaw) || arNorm.startsWith(qNorm)) {
                    startMatches.push(item);
                } else if (en.includes(qRaw) || arRaw.includes(qRaw) || arNorm.includes(qNorm) ||
                           actRaw.includes(qRaw) || normalizeArabic(item.active || '').includes(qNorm) ||
                           (bc && bc.includes(qRaw))) {
                    includeMatches.push(item);
                }
            }
            return [...startMatches, ...includeMatches].slice(0, limit);
        }

        if (!_loadingPromise && !_loadFailed) {
            loadExtendedCatalog();
        }

        return searchCatalog(BUILTIN_CATALOG, qRaw, qNorm, limit);
    },

    async searchAsync(query, limit = 8) {
        if (!query) return [];
        const strQuery = String(query).trim();
        if (!strQuery || strQuery.length < 2) return [];

        await loadExtendedCatalog();
        return this.search(query, limit);
    },

    /**
     * Find top matching catalog items for a user medicine record.
     * Uses pre-built 2-char prefix index for <5ms matching across 27,601 drugs.
     * Returns [{ item, score, confidence: 'high'|'medium', formattedEN }]
     */
    findBestMatches(med, topN = 5) {
        const catalog = _extendedCatalog || BUILTIN_CATALOG;
        if (!med || catalog.length === 0) return [];
        if (med.type === 'supply') return []; // Don't auto-match medical consumables (syringes, cannulas) to drugs

        const medBc = String(med.barcode || '').trim();
        const isRealBc = /^\d{8,14}$/.test(medBc);

        // 1. Exact barcode shortcut
        if (isRealBc) {
            const exact = catalog.find(c => c.barcode && c.barcode === medBc);
            if (exact) {
                return [{ item: exact, score: 100, confidence: 'high', formattedEN: toTitleCaseDrug(exact.nameEN) }];
            }
        }

        const medEnTokens = extractEnTokens(med.nameEN);
        const medArTokens = extractArTokens(med.nameAR);
        const medBrandEN = pickBrandEN(medEnTokens);
        const medBrandAR = medArTokens[0] || '';
        const medForms = detectForms(`${med.nameEN || ''} ${med.nameAR || ''}`);
        const medStrengths = extractStrengths(`${med.nameEN || ''} ${med.nameAR || ''}`);
        const medAct = (med.activeIngredient || '').toLowerCase().trim();

        const medVariants = new Set(medEnTokens.filter(t => VARIANT_KEYWORDS.has(t)));
        const medCoreWords = medEnTokens.filter(t => t.length >= 3 && !GENERIC_NOISE.has(t) && !/^\d+$/.test(t));

        if (!medBrandEN && !medBrandAR) return [];

        // Gather candidates quickly from prefix indices (or full catalog for builtin)
        let candidates;
        if (_enPrefixIndex && _arPrefixIndex) {
            const candSet = new Set();
            if (medBrandEN.length >= 2) {
                const list = _enPrefixIndex.get(medBrandEN.slice(0, 2));
                if (list) for (const x of list) candSet.add(x);
            }
            if (medBrandAR.length >= 2) {
                const list = _arPrefixIndex.get(medBrandAR.slice(0, 2));
                if (list) for (const x of list) candSet.add(x);
            }
            candidates = Array.from(candSet);
        } else {
            candidates = catalog;
        }

        const scored = [];

        for (let i = 0; i < candidates.length; i++) {
            const item = candidates[i];
            if (!item._enTokens) {
                item._enTokens = extractEnTokens(item._enLow || item.nameEN);
                item._arTokens = extractArTokens(item._arNorm || item.nameAR);
                item._brandEN = pickBrandEN(item._enTokens);
                item._brandAR = item._arTokens[0] || '';
            }
            const itemEnTokens = item._enTokens;
            const itemArTokens = item._arTokens;
            const itemBrandEN = item._brandEN;
            const itemBrandAR = item._brandAR;

            let score = 0;
            let enMatched = false;
            let arMatched = false;

            // --- Brand EN scoring ---
            if (medBrandEN && itemBrandEN) {
                if (medBrandEN === itemBrandEN) {
                    score += 52;
                    enMatched = true;
                } else if (medBrandEN.length >= 4 && itemBrandEN.length >= 4) {
                    const dist = editDistanceAtMost(medBrandEN, itemBrandEN, medBrandEN.length >= 6 ? 2 : 1);
                    if (dist === 1) {
                        score += 42;
                        enMatched = true;
                    } else if (dist === 2 && medBrandEN.length >= 6) {
                        score += 30;
                        enMatched = true;
                    } else if (itemBrandEN.startsWith(medBrandEN) || medBrandEN.startsWith(itemBrandEN)) {
                        const ratio = Math.min(medBrandEN.length, itemBrandEN.length) / Math.max(medBrandEN.length, itemBrandEN.length);
                        if (ratio >= 0.72) {
                            score += 34;
                            enMatched = true;
                        }
                    }
                }
            }

            // --- Brand AR scoring ---
            if (medBrandAR && itemBrandAR) {
                // Guard: if BOTH have long EN brand names that clearly differ, don't let a generic 1st AR word falsely match
                const strongEnMismatch = !enMatched && medBrandEN.length >= 5 && itemBrandEN.length >= 5 && editDistanceAtMost(medBrandEN, itemBrandEN, 3) > 3;
                if (!strongEnMismatch) {
                    if (medBrandAR === itemBrandAR) {
                        score += enMatched ? 10 : 44;
                        arMatched = true;
                    } else if (medBrandAR.length >= 4 && itemBrandAR.length >= 4 && editDistanceAtMost(medBrandAR, itemBrandAR, 1) === 1) {
                        score += enMatched ? 6 : 36;
                        arMatched = true;
                    }
                }
            }

            if (!enMatched && !arMatched) continue;

            // --- Additional core words ---
            if (medCoreWords.length > 1) {
                let extraHits = 0;
                for (let w = 1; w < medCoreWords.length; w++) {
                    const cw = medCoreWords[w].replace(/-/g, '');
                    if (itemEnTokens.some(t => t.replace(/-/g, '') === cw)) extraHits++;
                }
                score += Math.min(extraHits * 10, 20);
            }

            // --- Variant consistency ---
            const itemVariants = new Set(itemEnTokens.filter(t => VARIANT_KEYWORDS.has(t)));
            for (const v of medVariants) {
                if (itemVariants.has(v)) score += 12;
                else score -= 10;
            }
            for (const v of itemVariants) {
                if (!medVariants.has(v)) score -= 6;
            }

            // --- Strength scoring ---
            if (!item._strengths) item._strengths = extractStrengths(`${item._enLow || item.nameEN || ''} ${item._arNorm || item.nameAR || ''}`);
            const itemStrengths = item._strengths;
            if (medStrengths.length > 0 && itemStrengths.length > 0) {
                const sharedStrength = medStrengths.some(st => itemStrengths.includes(st));
                if (sharedStrength) score += 22;
                else score -= 18;
            }

            // --- Dosage form scoring (Set intersection handles Drops/Syrup) ---
            if (!item._forms) item._forms = detectForms(`${item._enLow || item.nameEN || ''} ${item._arNorm || item.nameAR || ''}`);
            const itemForms = item._forms;
            if (medForms.size > 0 && itemForms.size > 0) {
                let formOverlap = false;
                for (const f of medForms) { if (itemForms.has(f)) { formOverlap = true; break; } }
                if (formOverlap) score += 16;
                else score -= 20;
            }

            // --- Active ingredient confirmation ---
            if (medAct && item.active) {
                const itemAct = item._actLow || item.active.toLowerCase();
                if (itemAct.includes(medAct) || medAct.includes(itemAct)) {
                    score += 14;
                }
            }

            // --- Tie-breaker bonus for having a valid barcode ---
            if (item.barcode) score += 3;

            const clamped = Math.max(0, Math.min(100, Math.round(score)));
            if (clamped >= 48) {
                scored.push({
                    item,
                    score: clamped,
                    confidence: clamped >= 72 ? 'high' : 'medium',
                    formattedEN: toTitleCaseDrug(item.nameEN)
                });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topN);
    },

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
