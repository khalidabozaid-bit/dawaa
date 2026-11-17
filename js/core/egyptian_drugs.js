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
let _enPhoneticIndex = null;
let _enConsIndex = null;
let _arPrefixIndex = null;
let _arSkeletonIndex = null;

function phoneticKeyEN(word) {
    if (!word) return '';
    let s = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.length <= 2) return s;
    // Common Egyptian/Latin pharmaceutical spelling equivalences
    s = s
        .replace(/ph/g, 'f')
        .replace(/qu/g, 'k')
        .replace(/rh/g, 'r')
        .replace(/ch/g, 'k')
        .replace(/ck/g, 'k')
        .replace(/gh/g, 'g')
        .replace(/th/g, 't')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/c/g, 'k')
        .replace(/p/g, 'b')
        .replace(/[ey]/g, 'i')
        .replace(/([a-z])\1+/g, '$1');
    // Drop trailing silent 'e' (already mapped to 'i' above? Check original trailing 'e')
    if (String(word).toLowerCase().replace(/[^a-z0-9]/g, '').endsWith('e') && s.length >= 5 && s.endsWith('i')) {
        s = s.slice(0, -1);
    }
    return s;
}

function consonantSkeletonEN(word) {
    const p = phoneticKeyEN(word);
    if (!p) return '';
    return p[0] + p.slice(1).replace(/[aeiou]/g, '');
}

function firstCharPlusConsonant(pKey) {
    if (!pKey || pKey.length < 2) return '';
    for (let i = 1; i < pKey.length; i++) {
        if (!/[aeiou]/.test(pKey[i])) return pKey[0] + pKey[i];
    }
    return pKey.slice(0, 2);
}

function arabicSkeleton(word) {
    if (!word) return '';
    const w = normalizeArabic(word).replace(/[^\u0600-\u06FF0-9]/g, '');
    if (w.length <= 2) return w;
    // Strip internal Arabic long vowels (ا و ي) to match وان/ون and ديلتارينو/دلتارينو
    return w[0] + w.slice(1).replace(/[اوي]/g, '');
}

function collapseInitialisms(text) {
    let s = String(text || '').toLowerCase();
    // 1. Standard medical abbreviations first
    s = s
        .replace(/\bs\.?\s*r\.?\b/g, 'sr')
        .replace(/\bc\.?\s*r\.?\b/g, 'cr')
        .replace(/\bx\.?\s*r\.?\b/g, 'xr')
        .replace(/\bf\.?\s*c\.?\s*t(?:abs?)?\b/g, 'tab')
        .replace(/\be\.?\s*c\.?\s*t(?:abs?)?\b/g, 'tab')
        .replace(/\bi\.?\s*v\.?\b/g, 'iv')
        .replace(/\bi\.?\s*m\.?\b/g, 'im')
        .replace(/\bi\.?\s*u\.?\b/g, 'iu');
    // 2. Dotted single-letter acronyms (e.g. "b.b.c." -> "bbc", "d.g." -> "dg")
    s = s.replace(/(^|[\s(])((?:[a-z]\.\s*){2,5}[a-z]?\.?)(?=$|[\s),])/g, (full, pre, seq) => {
        const letters = seq.replace(/[\s.]/g, '');
        return letters.length >= 2 ? pre + letters : full;
    });
    // 3. Spaced/comma single-digit brand codes at start (e.g. "1 2 3" or "1,2,3" -> "123")
    s = s.replace(/^(\s*)(\d(?:[\s,.-]+\d){1,3})(?=\s|$|[(\[])/g, (_, pre, seq) => {
        return pre + seq.replace(/[\s,.-]/g, '');
    });
    return s;
}

function addToIndex(map, key, item) {
    if (!key || key.length < 2) return;
    let bucket = map.get(key);
    if (!bucket) {
        bucket = [];
        map.set(key, bucket);
    }
    if (bucket[bucket.length - 1] !== item) {
        bucket.push(item);
    }
}

function buildCatalogIndex(catalog) {
    const enIdx = new Map();
    const enPhonIdx = new Map();
    const enConsIdx = new Map();
    const arIdx = new Map();
    const arSkelIdx = new Map();

    for (let i = 0; i < catalog.length; i++) {
        const item = catalog[i];
        item._enLow = (item.nameEN || '').toLowerCase();
        item._enNorm = collapseInitialisms(item._enLow);
        item._enCompact = item._enNorm.replace(/[^a-z0-9]/g, '');
        item._arNorm = normalizeArabic(item.nameAR || '');
        item._actLow = (item.active || '').toLowerCase();

        // Fast token extraction from collapsed text (handles b.b.c. -> bbc, 1 2 3 -> 123, trimed flu -> trimedflu)
        const enTokens = item._enNorm.match(/[a-z0-9-]+/g);
        if (enTokens && enTokens.length > 0) {
            const t0 = enTokens[0].replace(/-/g, '');
            const t1 = enTokens[1] ? enTokens[1].replace(/-/g, '') : '';
            const candidates = [t0];
            // Also index joined first two words (e.g. "trimed flu" -> "trimedflu", "dg wash" -> "dgwash")
            if (t1 && t0.length >= 2 && t1.length >= 2 && !/^\d/.test(t1) && !GENERIC_NOISE.has(t1)) {
                candidates.push(t0 + t1);
            }
            for (const cand of candidates) {
                if (cand.length >= 2) {
                    addToIndex(enIdx, cand.slice(0, 2), item);
                    const pk = phoneticKeyEN(cand);
                    if (pk.length >= 2) {
                        addToIndex(enPhonIdx, pk.slice(0, 2), item);
                        const fc = firstCharPlusConsonant(pk);
                        if (fc.length >= 2) addToIndex(enConsIdx, fc, item);
                    }
                }
            }
        }

        const arMatch = item._arNorm.match(/[\u0600-\u06FF0-9]+/g);
        if (arMatch && arMatch.length > 0) {
            const bAr = arMatch[0];
            if (bAr.length >= 2) {
                addToIndex(arIdx, bAr.slice(0, 2), item);
                const sk = arabicSkeleton(bAr);
                if (sk.length >= 2) addToIndex(arSkelIdx, sk.slice(0, 2), item);
            }
            // Joined first 2 Arabic words (e.g. "تراي ميد" vs "ترايمد")
            if (arMatch[1] && bAr.length >= 2 && arMatch[1].length >= 2) {
                const joinedAr = bAr + arMatch[1];
                const sk2 = arabicSkeleton(joinedAr);
                if (sk2.length >= 2) addToIndex(arSkelIdx, sk2.slice(0, 2), item);
            }
        }
    }
    _enPrefixIndex = enIdx;
    _enPhoneticIndex = enPhonIdx;
    _enConsIndex = enConsIdx;
    _arPrefixIndex = arIdx;
    _arSkeletonIndex = arSkelIdx;
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

const TOPICAL_OR_LIQUID_RE = /\b(cream|cr|oint|ointment|gel|lotion|emulgel|foam|shampoo|wash|mouthwash|paste|soap|tube|spray|syrup|syr|susp|suspension|drops|drop)\b|كريم|مرهم|جل|لوشن|غسول|مضمضه|مضمضة|شامبو|معجون|بخاخ|شراب|نقط|قطره|قطرة/i;

function extractStrengths(text) {
    if (!text) return [];
    const s = collapseInitialisms(text);
    const isTopicalOrLiquid = TOPICAL_OR_LIQUID_RE.test(s);
    const out = new Set();
    // Convert "1 gm" / "1g" / "1.5 gm" to mg equivalents too for cross-matching (1 gm === 1000 mg)
    const unitRe = /(\d+(?:\.\d+)?)\s*(gm|g|mg|mcg|iu|%)\b/gi;
    let m;
    while ((m = unitRe.exec(s)) !== null) {
        const val = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        if (!isNaN(val)) {
            if (unit === 'gm' || unit === 'g') {
                // On topical/liquid items, >= 5 gm is tube/jar pack weight (e.g. 15 gm, 30 gm, 50 gm), not drug strength
                if (isTopicalOrLiquid && val >= 5) continue;
                out.add(String(val * 1000));
                out.add(String(val));
            } else {
                out.add(String(val));
            }
        }
    }
    if (out.size === 0) {
        // Standalone numbers NOT at the very start (brand code like "123") and NOT directly followed by pack/weight/volume words (EN or AR)
        const withoutLeadingCode = s.replace(/^\s*\d+\b/, '');
        const numRe = /\b(\d+(?:\.\d+)?)\b(?!\s*(?:f\.?c\.?t|tabs?|tablets?|caps?|capsules?|amps?|sachets?|lozenges?|patches?|strips?|vials?|ml|gm|g\b|جرام|جم|مل|قرص|اقراص|كبسول|كبسوله|كيس|اكياس|امبول|امبولات|فيال|قمع|اقماع))/gi;
        while ((m = numRe.exec(withoutLeadingCode)) !== null) {
            const val = parseFloat(m[1]);
            if (!isNaN(val)) out.add(String(val));
        }
    }
    return Array.from(out);
}

function normalizeEnForTokens(text) {
    return collapseInitialisms(text);
}

function extractEnTokens(text) {
    if (!text) return [];
    const norm = normalizeEnForTokens(text);
    // Keep hyphenated brand tokens together (e.g. bi-profenid, c-retard, multi-relax, fusi-zon, dg-wash)
    return norm
        .replace(/[^a-z0-9-]+/g, ' ')
        .replace(/(^|\s)-+|-+(\s|$)/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function pickBrandEN(tokens) {
    if (!tokens || tokens.length === 0) return '';
    // Preserve leading numeric product code brands (e.g. "123 Tab", "1 2 3 (one two three)")
    if (/^\d{2,4}$/.test(tokens[0])) {
        return tokens[0];
    }
    // Prefer first non-noise, non-number token (normalized without hyphens for comparison)
    const first = tokens.find(t => !GENERIC_NOISE.has(t) && !/^\d+$/.test(t));
    return first ? first.replace(/-/g, '') : (tokens[0] || '').replace(/-/g, '');
}

function pickBrand2EN(tokens) {
    if (!tokens || tokens.length < 2) return '';
    const t0 = tokens[0].replace(/-/g, '');
    const t1 = tokens[1].replace(/-/g, '');
    if (t0.length < 2 || t1.length < 2) return '';
    if (/^\d+$/.test(t0) || /^\d+$/.test(t1)) return '';
    if (GENERIC_NOISE.has(t0) || GENERIC_NOISE.has(t1)) return '';
    return t0 + t1;
}

function extractArTokens(text) {
    if (!text) return [];
    return normalizeArabic(text)
        .replace(/[^\u0600-\u06FF0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length >= 2);
}

// Optimal String Alignment (Damerau-Levenshtein): counts adjacent transposition (e.g. daimicron/diamicron) as 1
function editDistanceAtMost(a, b, maxDist = 2) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    let prev2 = null;
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let best = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && prev2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                best = Math.min(best, prev2[j - 2] + 1);
            }
            curr[j] = best;
            if (best < rowMin) rowMin = best;
        }
        if (rowMin > maxDist) return maxDist + 1;
        prev2 = prev;
        prev = curr;
        curr = new Array(lb + 1);
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

function scoreSingleQuery(med, catalog, topN) {
    const medEnTokens = extractEnTokens(med.nameEN);
    const medArTokens = extractArTokens(med.nameAR);
    const medBrandEN = pickBrandEN(medEnTokens);
    const medBrand2EN = pickBrand2EN(medEnTokens);
    const medBrandAR = medArTokens[0] || '';
    const medBrand2AR = (medArTokens.length >= 2 && medArTokens[0].length >= 2 && medArTokens[1].length >= 2)
        ? (medArTokens[0] + medArTokens[1]) : '';
    const medForms = detectForms(`${med.nameEN || ''} ${med.nameAR || ''}`);
    const medStrengths = extractStrengths(`${med.nameEN || ''} ${med.nameAR || ''}`);
    const medAct = (med.activeIngredient || '').toLowerCase().trim();

    const medVariants = new Set(medEnTokens.filter(t => VARIANT_KEYWORDS.has(t)));
    const medCoreWords = medEnTokens.filter(t => t.length >= 3 && !GENERIC_NOISE.has(t) && !/^\d+$/.test(t));

    if (!medBrandEN && !medBrandAR) return [];

    const medPhonEN = phoneticKeyEN(medBrandEN);
    const medPhon2EN = medBrand2EN ? phoneticKeyEN(medBrand2EN) : '';
    const medConsEN = consonantSkeletonEN(medBrandEN);
    const medArSkel = arabicSkeleton(medBrandAR);
    const medArSkel2 = medBrand2AR ? arabicSkeleton(medBrand2AR) : '';

    // Gather candidates quickly from prefix/phonetic indices; widen to consonant index only if needed
    const gatherCandidates = (includeConsonantFallback) => {
        if (!_enPrefixIndex || !_arPrefixIndex) return catalog;
        const candSet = new Set();
        const pull = (idx, key) => {
            if (!idx || !key || key.length < 2) return;
            const list = idx.get(key);
            if (list) for (let i = 0; i < list.length; i++) candSet.add(list[i]);
        };

        if (medBrandEN.length >= 2) {
            pull(_enPrefixIndex, medBrandEN.slice(0, 2));
            pull(_enPhoneticIndex, medPhonEN.slice(0, 2));
            if (includeConsonantFallback) pull(_enConsIndex, firstCharPlusConsonant(medPhonEN));
        }
        if (medBrand2EN.length >= 2) {
            pull(_enPrefixIndex, medBrand2EN.slice(0, 2));
            pull(_enPhoneticIndex, medPhon2EN.slice(0, 2));
            if (includeConsonantFallback) pull(_enConsIndex, firstCharPlusConsonant(medPhon2EN));
        }
        if (medBrandAR.length >= 2) {
            pull(_arPrefixIndex, medBrandAR.slice(0, 2));
            pull(_arSkeletonIndex, medArSkel.slice(0, 2));
        }
        if (medArSkel2.length >= 2) {
            pull(_arSkeletonIndex, medArSkel2.slice(0, 2));
        }
        return Array.from(candSet);
    };

    const scorePool = (candidates) => {
        const out = [];
        for (let i = 0; i < candidates.length; i++) {
            const item = candidates[i];
            if (!item._enTokens) {
                item._enTokens = extractEnTokens(item._enNorm || item.nameEN);
                item._arTokens = extractArTokens(item._arNorm || item.nameAR);
                item._brandEN = pickBrandEN(item._enTokens);
                item._brand2EN = pickBrand2EN(item._enTokens);
                item._phonEN = phoneticKeyEN(item._brandEN);
                item._phon2EN = item._brand2EN ? phoneticKeyEN(item._brand2EN) : '';
                item._consEN = consonantSkeletonEN(item._brandEN);
                item._brandAR = item._arTokens[0] || '';
                item._brand2AR = (item._arTokens.length >= 2 && item._arTokens[0].length >= 2 && item._arTokens[1].length >= 2)
                    ? (item._arTokens[0] + item._arTokens[1]) : '';
                item._arSkel = arabicSkeleton(item._brandAR);
                item._arSkel2 = item._brand2AR ? arabicSkeleton(item._brand2AR) : '';
            }

            const itemEnTokens = item._enTokens;
            const itemBrandEN = item._brandEN;
            const itemBrand2EN = item._brand2EN;
            const itemBrandAR = item._brandAR;
            const itemBrand2AR = item._brand2AR;

            let score = 0;
            let enMatched = false;
            let enExact = false;
            let enFuzzyCorrected = false;
            let matchedViaBrand2 = false;
            let arMatched = false;

            // --- Brand EN scoring (Exact -> Joined 2-word -> Phonetic -> Damerau-Levenshtein -> Consonant Skeleton) ---
            if (medBrandEN && itemBrandEN) {
                if (medBrandEN === itemBrandEN) {
                    score += 56;
                    enMatched = true;
                    enExact = true;
                } else if ((itemBrand2EN && medBrandEN === itemBrand2EN) || (medBrand2EN && medBrand2EN === itemBrandEN)) {
                    score += 58;
                    enMatched = true;
                    enExact = true;
                    matchedViaBrand2 = true;
                } else if (medBrandEN.length >= 4 && itemBrandEN.length >= 4) {
                    const rawDist = editDistanceAtMost(medBrandEN, itemBrandEN, 3);
                    const phonExact = medPhonEN.length >= 4 && medPhonEN === item._phonEN && rawDist <= (medBrandEN.length >= 7 ? 3 : 2);
                    const phon2Exact = !phonExact && (
                        (item._phon2EN && medPhonEN.length >= 5 && medPhonEN === item._phon2EN && editDistanceAtMost(medBrandEN, itemBrand2EN, 2) <= 2) ||
                        (medPhon2EN && medPhon2EN.length >= 5 && medPhon2EN === item._phonEN && editDistanceAtMost(medBrand2EN, itemBrandEN, 2) <= 2)
                    );

                    if (phonExact || phon2Exact) {
                        score += (rawDist <= 1 || phon2Exact) ? 52 : 50;
                        enMatched = true;
                        enFuzzyCorrected = true;
                        if (phon2Exact) matchedViaBrand2 = true;
                    } else if (rawDist === 1 && medBrandEN.length >= 5 && itemBrandEN.length >= 5) {
                        score += 48;
                        enMatched = true;
                        enFuzzyCorrected = true;
                    } else if (medPhonEN.length >= 5 && item._phonEN.length >= 5 && editDistanceAtMost(medPhonEN, item._phonEN, 1) === 1 && rawDist <= 2) {
                        score += 48;
                        enMatched = true;
                        enFuzzyCorrected = true;
                    } else if (medConsEN.length >= 4 && medConsEN === item._consEN && medBrandEN.length >= 6 && itemBrandEN.length >= 5 && rawDist <= 2) {
                        score += 48;
                        enMatched = true;
                        enFuzzyCorrected = true;
                    } else if (rawDist === 2 && medBrandEN.length >= 6) {
                        score += 36;
                        enMatched = true;
                        enFuzzyCorrected = true;
                    } else if (itemBrandEN.startsWith(medBrandEN) || medBrandEN.startsWith(itemBrandEN)) {
                        const ratio = Math.min(medBrandEN.length, itemBrandEN.length) / Math.max(medBrandEN.length, itemBrandEN.length);
                        if (ratio >= 0.72) {
                            score += 38;
                            enMatched = true;
                            enFuzzyCorrected = true;
                        }
                    }
                }
            }

            // --- Brand AR scoring (Exact -> Joined 2-word -> Skeleton -> 1-char typo) ---
            if (medBrandAR && itemBrandAR) {
                const strongEnMismatch = !enMatched && medBrandEN.length >= 5 && itemBrandEN.length >= 5 && editDistanceAtMost(medBrandEN, itemBrandEN, 3) > 3;
                if (!strongEnMismatch) {
                    if (medBrandAR === itemBrandAR || (medBrand2AR && medBrand2AR === itemBrandAR) || (itemBrand2AR && medBrandAR === itemBrand2AR)) {
                        score += enMatched ? 14 : 48;
                        arMatched = true;
                    } else if (medArSkel.length >= 3 && (medArSkel === item._arSkel || (medArSkel2 && medArSkel2 === item._arSkel) || (item._arSkel2 && medArSkel === item._arSkel2))) {
                        score += enMatched ? 12 : 44;
                        arMatched = true;
                    } else if (medBrandAR.length >= 4 && itemBrandAR.length >= 4 && editDistanceAtMost(medBrandAR, itemBrandAR, 1) === 1) {
                        score += enMatched ? 10 : 40;
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
                if (matchedViaBrand2 && itemEnTokens[1] === v) continue;
                if (!medVariants.has(v)) score -= 3;
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
            let activeConfirmed = false;
            if (medAct && item.active) {
                const itemAct = item._actLow || item.active.toLowerCase();
                if (itemAct.includes(medAct) || medAct.includes(itemAct)) {
                    score += 14;
                    activeConfirmed = true;
                }
            }

            // --- Tie-breaker bonus for having a valid barcode ---
            if (item.barcode) score += 3;

            const clamped = Math.max(0, Math.min(100, Math.round(score)));
            if (clamped >= 48) {
                const allowHigh = enExact || (arMatched && (enMatched || activeConfirmed)) || activeConfirmed;
                const confidence = (allowHigh && clamped >= 72) ? 'high' : 'medium';
                out.push({
                    item,
                    score: clamped,
                    confidence,
                    fuzzyCorrected: enFuzzyCorrected,
                    formattedEN: toTitleCaseDrug(item.nameEN)
                });
            }
        }
        return out;
    };

    let scored = scorePool(gatherCandidates(false));
    if (scored.length === 0 && _enConsIndex) {
        scored = scorePool(gatherCandidates(true));
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
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
     * Supports English name, Arabic name, active ingredient, barcode,
     * dot/space normalization (b.b.c., 1 2 3), and phonetic fuzzy fallback.
     */
    search(query, limit = 8) {
        if (!query) return [];
        const strQuery = String(query).trim();
        if (!strQuery || strQuery.length < 2) return [];

        const qRaw = strQuery.toLowerCase();
        const qNorm = normalizeArabic(strQuery);
        const qCollapsed = collapseInitialisms(qRaw).trim();
        const qCompact = qCollapsed.replace(/[^a-z0-9]/g, '');

        if (_extendedCatalog) {
            const startMatches = [];
            const includeMatches = [];
            const seen = new Set();

            for (const item of _extendedCatalog) {
                if (startMatches.length + includeMatches.length >= limit * 3) break;
                const en = item._enLow || (item.nameEN || '').toLowerCase();
                const enNorm = item._enNorm || en;
                const enComp = item._enCompact || '';
                const arRaw = (item.nameAR || '').toLowerCase();
                const arNorm = item._arNorm || normalizeArabic(item.nameAR || '');
                const actRaw = item._actLow || (item.active || '').toLowerCase();
                const bc = item.barcode || '';

                if (bc && bc === strQuery) {
                    startMatches.unshift(item);
                    seen.add(item);
                } else if (en.startsWith(qRaw) || enNorm.startsWith(qCollapsed) ||
                           (qCompact.length >= 2 && enComp.startsWith(qCompact)) ||
                           arRaw.startsWith(qRaw) || arNorm.startsWith(qNorm)) {
                    startMatches.push(item);
                    seen.add(item);
                } else if (en.includes(qRaw) || enNorm.includes(qCollapsed) ||
                           (qCompact.length >= 3 && enComp.includes(qCompact)) ||
                           arRaw.includes(qRaw) || arNorm.includes(qNorm) ||
                           actRaw.includes(qRaw) || normalizeArabic(item.active || '').includes(qNorm) ||
                           (bc && bc.includes(qRaw))) {
                    includeMatches.push(item);
                    seen.add(item);
                }
            }

            // Put smart phonetic/fuzzy brand matches ahead of substring/active-ingredient hits when no direct prefix match was found
            let smartBrandMatches = [];
            if (startMatches.length < limit && strQuery.length >= 3 && !/^\d{6,}$/.test(strQuery)) {
                const smartHits = this.findBestMatches({ nameEN: strQuery, nameAR: strQuery, type: 'medicine' }, limit);
                for (const hit of smartHits) {
                    if (!seen.has(hit.item)) {
                        smartBrandMatches.push(hit.item);
                        seen.add(hit.item);
                    }
                }
            }

            const combined = [...startMatches, ...smartBrandMatches, ...includeMatches];
            return combined.slice(0, limit);
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
     * Supports exact, phonetic, transposition, dot/space collapse, dual-name "/" splits,
     * and tube-size vs strength separation across 27,601 drugs in <10ms.
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

        // 2. Primary match on full medicine record
        const primary = scoreSingleQuery(med, catalog, topN);

        // 3. Dual-name "/" support (e.g. "Panadol Advance / dolipran")
        const rawEN = String(med.nameEN || '');
        if (rawEN.includes('/')) {
            const parts = rawEN.split('/').map(p => p.trim()).filter(p => p.length >= 3);
            if (parts.length >= 2) {
                const bestByItem = new Map();
                for (const m of primary) bestByItem.set(m.item, m);
                for (const part of parts) {
                    const partMatches = scoreSingleQuery({ ...med, nameEN: part }, catalog, topN);
                    for (const pm of partMatches) {
                        const prev = bestByItem.get(pm.item);
                        if (!prev || pm.score > prev.score) bestByItem.set(pm.item, pm);
                    }
                }
                return Array.from(bestByItem.values())
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topN);
            }
        }

        return primary;
    },

    formatEN(str) {
        return toTitleCaseDrug(str);
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
