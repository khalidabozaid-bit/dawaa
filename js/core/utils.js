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
            .replace(/[أإآٱء]/g, 'ا')
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

    // ===================== Unified Smart Search Engine (v18.17.2) =====================
    collapseInitialisms(text) {
        let s = String(text || '').toLowerCase();
        if (s.indexOf('.') !== -1) {
            s = s
                .replace(/\bs\.?\s*r\.?\b/g, 'sr')
                .replace(/\bc\.?\s*r\.?\b/g, 'cr')
                .replace(/\bx\.?\s*r\.?\b/g, 'xr')
                .replace(/\bf\.?\s*c\.?\s*t(?:abs?)?\b/g, 'tab')
                .replace(/\be\.?\s*c\.?\s*t(?:abs?)?\b/g, 'tab')
                .replace(/\bi\.?\s*v\.?\b/g, 'iv')
                .replace(/\bi\.?\s*m\.?\b/g, 'im')
                .replace(/\bi\.?\s*u\.?\b/g, 'iu')
                // Dotted acronyms: "b.b.c." -> "bbc", "d.g." -> "dg"
                .replace(/(^|[\s(])((?:[a-z]\.\s*){2,5}[a-z]?\.?)(?=$|[\s),])/g, (full, pre, seq) => {
                    const letters = seq.replace(/[\s.]/g, '');
                    return letters.length >= 2 ? pre + letters : full;
                });
        }
        // Spaced/comma leading digits: "1 2 3" or "1,2,3" -> "123"
        if (/^\s*\d[\s,.-]+\d/.test(s)) {
            s = s.replace(/^(\s*)(\d(?:[\s,.-]+\d){1,3})(?=\s|$|[(\[])/g, (_, pre, seq) => {
                return pre + seq.replace(/[\s,.-]/g, '');
            });
        }
        return s;
    },

    _phonCache: new Map(),
    _consCache: new Map(),
    _arSkelCache: new Map(),

    phoneticKeyEN(word) {
        if (!word) return '';
        const cached = this._phonCache.get(word);
        if (cached !== undefined) return cached;
        const clean = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean.length <= 2) {
            if (this._phonCache.size < 4000) this._phonCache.set(word, clean);
            return clean;
        }
        let s = clean
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
        if (clean.endsWith('e') && s.length >= 5 && s.endsWith('i')) {
            s = s.slice(0, -1);
        }
        if (this._phonCache.size < 4000) this._phonCache.set(word, s);
        return s;
    },

    consonantSkeletonEN(word) {
        if (!word) return '';
        const cached = this._consCache.get(word);
        if (cached !== undefined) return cached;
        const p = this.phoneticKeyEN(word);
        const res = p ? (p[0] + p.slice(1).replace(/[aeiou]/g, '')) : '';
        if (this._consCache.size < 4000) this._consCache.set(word, res);
        return res;
    },

    arabicSkeleton(word) {
        if (!word) return '';
        const cached = this._arSkelCache.get(word);
        if (cached !== undefined) return cached;
        const w = this.normalizeArabic(word).replace(/[^\u0600-\u06FF0-9]/g, '');
        const res = w.length <= 2 ? w : (w[0] + w.slice(1).replace(/[اوي]/g, ''));
        if (this._arSkelCache.size < 4000) this._arSkelCache.set(word, res);
        return res;
    },

    damerauDistanceAtMost(a, b, maxDist = 2) {
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
    },

    prepareSearchQuery(query) {
        const raw = String(query || '').trim();
        if (!raw) return null;
        const low = raw.toLowerCase();
        const hasAR = /[\u0600-\u06FF]/.test(raw);
        const hasEN = /[a-z]/i.test(raw);
        const arNorm = hasAR ? this.normalizeArabic(raw) : low;
        const collapsed = this.collapseInitialisms(low).trim();
        const rawCompEN = collapsed.replace(/[^a-z0-9]/g, '');
        const rawCompAR = hasAR ? arNorm.replace(/[^\u0600-\u06FF0-9]/g, '') : '';
        // Only treat compactEN as EN if it has Latin letters OR query is purely digits (e.g. "123")
        const compactEN = (hasEN || /^\d[\d\s,.-]*$/.test(raw)) ? rawCompEN : '';
        const compactAR = hasAR ? rawCompAR : '';
        const isPureLongDigits = /^\d{6,}$/.test(raw);
        const words = arNorm.split(/[\s/\-_,]+/).filter(Boolean).map(w => {
            const wHasEN = /[a-z]/i.test(w);
            const wHasAR = /[\u0600-\u06FF]/.test(w);
            const isNum = /^\d+(?:\.\d+)?$/.test(w);
            const wCol = wHasEN ? this.collapseInitialisms(w) : w;
            const wEn = (wHasEN || isNum) ? wCol.replace(/[^a-z0-9]/g, '') : '';
            const wAr = wHasAR ? w.replace(/[^\u0600-\u06FF0-9]/g, '') : '';
            return {
                raw: w,
                isNum,
                en: wEn,
                ar: wAr,
                phonEN: (wHasEN && wEn.length >= 3) ? this.phoneticKeyEN(wEn) : '',
                consEN: (wHasEN && wEn.length >= 4) ? this.consonantSkeletonEN(wEn) : '',
                skelAR: (wHasAR && wAr.length >= 3) ? this.arabicSkeleton(wAr) : ''
            };
        });
        const allLetterWords = words.length >= 2 && words.every(w => !w.isNum);
        return {
            raw,
            low,
            hasAR,
            hasEN,
            arNorm,
            collapsed,
            compactEN,
            compactAR,
            isPureLongDigits,
            allLetterWords,
            phonEN: (hasEN && compactEN.length >= 3) ? this.phoneticKeyEN(compactEN) : '',
            consEN: (hasEN && compactEN.length >= 4) ? this.consonantSkeletonEN(compactEN) : '',
            skelAR: (hasAR && compactAR.length >= 3) ? this.arabicSkeleton(compactAR) : '',
            words
        };
    },

    _scoreWordAgainstTokens(wObj, enTokens, arTokens) {
        // Pure number word (e.g. "500", "15", "1") matches exact number token or prefix of number+unit (e.g. "15gm", "500mg")
        if (wObj.isNum) {
            const w = wObj.en;
            for (let i = 0; i < enTokens.length; i++) {
                const tok = enTokens[i];
                if (tok === w) return 90;
                if (tok.startsWith(w) && tok.length > w.length && /[a-z]/.test(tok[w.length])) return 86;
            }
            for (let i = 0; i < arTokens.length; i++) {
                if (arTokens[i] === w) return 90;
            }
            return 0;
        }
        if (wObj.en) {
            const w = wObj.en;
            for (let i = 0; i < enTokens.length; i++) {
                const tok = enTokens[i];
                if (tok === w) return 90;
                if (tok.startsWith(w)) return 84;
                if (w.length >= 3 && tok.includes(w)) return 76;
            }
            if (w.length >= 3 && wObj.phonEN) {
                const wPhon = wObj.phonEN;
                const wCons = wObj.consEN;
                for (let i = 0; i < enTokens.length; i++) {
                    const tok = enTokens[i];
                    if (tok.length < 3 || /^\d+$/.test(tok)) continue;
                    const tPhon = this.phoneticKeyEN(tok);
                    if (tPhon === wPhon) {
                        const d = this.damerauDistanceAtMost(w, tok, w.length >= 7 ? 3 : 2);
                        if (d <= (w.length >= 7 ? 3 : 2)) return 60;
                    }
                    if (wPhon.length >= 4 && tPhon.startsWith(wPhon)) return 56;
                    if (w.length >= 4 && tok.length >= 4 && this.damerauDistanceAtMost(w, tok, 1) === 1) return 54;
                    if (w.length >= 5 && tok.length > w.length && this.damerauDistanceAtMost(w, tok.slice(0, w.length), 1) === 1) return 52;
                    if (wPhon.length >= 5 && tPhon.length >= 5 && this.damerauDistanceAtMost(wPhon, tPhon, 1) === 1 && this.damerauDistanceAtMost(w, tok, 2) <= 2) return 50;
                    if (wCons.length >= 4 && w.length >= 5 && tok.length >= 5 && this.consonantSkeletonEN(tok) === wCons && this.damerauDistanceAtMost(w, tok, 2) <= 2) return 48;
                }
            }
        }
        if (wObj.ar) {
            const w = wObj.ar;
            for (let i = 0; i < arTokens.length; i++) {
                const tok = arTokens[i];
                if (tok === w) return 90;
                if (tok.startsWith(w)) return 84;
                if (w.length >= 2 && tok.includes(w)) return 76;
            }
            if (w.length >= 3 && wObj.skelAR) {
                const wSkel = wObj.skelAR;
                for (let i = 0; i < arTokens.length; i++) {
                    const tok = arTokens[i];
                    if (tok.length < 3) continue;
                    const tSkel = this.arabicSkeleton(tok);
                    if (wSkel.length >= 3 && tSkel === wSkel) return 58;
                    if (wSkel.length >= 3 && tSkel.startsWith(wSkel)) return 54;
                    if (w.length >= 4 && tok.length >= 4 && this.damerauDistanceAtMost(w, tok, 1) === 1) return 50;
                }
            }
        }
        return 0;
    },

    /**
     * Unified smart relevance scorer for any record across the app.
     * Returns 0 (no match) or 48..100 (higher = better match; >=70 is literal/exact tier, 48..62 is phonetic/typo tier).
     */
    smartScore(queryOrPrepared, primaryFields = [], secondaryFields = []) {
        const pq = (queryOrPrepared && typeof queryOrPrepared === 'object' && 'low' in queryOrPrepared)
            ? queryOrPrepared
            : this.prepareSearchQuery(queryOrPrepared);
        if (!pq) return 100;

        let best = 0;
        const parsedFields = [];

        // Fast Pass 1: Literal / Prefix / Compact check (avoids tokenizing when literal hit already wins)
        const checkField = (text, isPrimary) => {
            if (!text) return;
            const rawStr = String(text);
            const low = rawStr.toLowerCase();
            const hasAR = /[\u0600-\u06FF]/.test(rawStr);
            const arNorm = hasAR ? this.normalizeArabic(rawStr) : '';
            const col = (low.indexOf('.') !== -1 || /^\s*\d[\s,.-]+\d/.test(low)) ? this.collapseInitialisms(low) : low;
            const compEN = pq.compactEN ? col.replace(/[^a-z0-9]/g, '') : '';
            const compAR = (pq.compactAR && hasAR) ? arNorm.replace(/[^\u0600-\u06FF0-9]/g, '') : '';

            if (!isPrimary && (low === pq.low || rawStr.trim() === pq.raw)) {
                best = Math.max(best, 100);
            }
            if (isPrimary) {
                if (low === pq.low || (hasAR && arNorm === pq.arNorm) || (pq.compactEN.length >= 2 && compEN === pq.compactEN)) {
                    best = Math.max(best, 98);
                } else if (low.startsWith(pq.low) || col.startsWith(pq.collapsed) || (hasAR && arNorm.startsWith(pq.arNorm)) ||
                           (pq.compactEN.length >= 2 && compEN.startsWith(pq.compactEN)) ||
                           (pq.compactAR.length >= 2 && compAR.startsWith(pq.compactAR))) {
                    best = Math.max(best, 92);
                } else if (low.includes(pq.low) || col.includes(pq.collapsed) || (hasAR && arNorm.includes(pq.arNorm)) ||
                           (pq.compactEN.length >= 3 && compEN.includes(pq.compactEN)) ||
                           (pq.compactAR.length >= 3 && compAR.includes(pq.compactAR))) {
                    best = Math.max(best, 82);
                }
            } else {
                if (low.includes(pq.low) || (hasAR && arNorm.includes(pq.arNorm)) ||
                    (pq.compactEN.length >= 3 && compEN.includes(pq.compactEN))) {
                    best = Math.max(best, 72);
                }
            }

            parsedFields.push({ col, arNorm, hasAR });
        };

        for (let i = 0; i < primaryFields.length; i++) checkField(primaryFields[i], true);
        if (best >= 92) return best;
        for (let i = 0; i < secondaryFields.length; i++) checkField(secondaryFields[i], false);
        if (best >= 82 || pq.isPureLongDigits) return best;

        // Pass 2: Tokenize only for items that need multi-word or phonetic/fuzzy evaluation
        const enTokens = [];
        const arTokens = [];
        for (let f = 0; f < parsedFields.length; f++) {
            const { col, arNorm, hasAR } = parsedFields[f];
            if (pq.hasEN || pq.words.some(w => w.isNum)) {
                const eToks = col.replace(/[^a-z0-9-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
                for (let i = 0; i < eToks.length; i++) {
                    const clean = eToks[i].replace(/-/g, '');
                    if (clean) enTokens.push(clean);
                    if (i + 1 < eToks.length) {
                        const next = eToks[i + 1].replace(/-/g, '');
                        if (clean.length >= 2 && next.length >= 2 && !/^\d+$/.test(next)) {
                            enTokens.push(clean + next);
                        }
                    }
                }
            }
            if (hasAR && (pq.hasAR || pq.words.some(w => w.isNum))) {
                const aToks = arNorm.replace(/[^\u0600-\u06FF0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
                for (let i = 0; i < aToks.length; i++) {
                    arTokens.push(aToks[i]);
                    if (i + 1 < aToks.length && aToks[i].length >= 2 && aToks[i + 1].length >= 2) {
                        arTokens.push(aToks[i] + aToks[i + 1]);
                    }
                }
            }
        }

        // Multi-word AND matching (e.g. "panadol 500", "aug 1", "fusi zon", "كريم 15", "تراي ميد")
        if (pq.words.length >= 2) {
            let minWordScore = 100;
            let allMatched = true;
            for (let i = 0; i < pq.words.length; i++) {
                const ws = this._scoreWordAgainstTokens(pq.words[i], enTokens, arTokens);
                if (ws === 0) {
                    allMatched = false;
                    break;
                }
                if (ws < minWordScore) minWordScore = ws;
            }
            if (allMatched) {
                best = Math.max(best, minWordScore >= 75 ? 80 : 62);
            }
        }

        // Single-word OR joined all-letter multi-word phonetic/fuzzy match (only for len >= 3)
        if (best < 62) {
            if (pq.words.length === 1) {
                best = Math.max(best, this._scoreWordAgainstTokens(pq.words[0], enTokens, arTokens));
            } else if (pq.allLetterWords && (pq.compactEN.length >= 4 || pq.compactAR.length >= 4)) {
                const joinedObj = {
                    raw: pq.raw,
                    isNum: false,
                    en: pq.compactEN,
                    ar: pq.compactAR,
                    phonEN: pq.phonEN,
                    consEN: pq.consEN,
                    skelAR: pq.skelAR
                };
                best = Math.max(best, this._scoreWordAgainstTokens(joinedObj, enTokens, arTokens));
            }
        }

        return best;
    },

    smartScoreMed(queryOrPrepared, med, extraFields = []) {
        if (!med) return 0;
        return this.smartScore(
            queryOrPrepared,
            [med.nameEN, med.nameAR],
            [med.activeIngredient, med.barcode, med.id, ...extraFields]
        );
    },

    /**
     * Filter & optionally rank an array using the unified Smart Search Engine.
     * Literal matches (score >= 70) always rank above phonetic/fuzzy matches (48..62).
     */
    smartFilter(items, query, getScoreFn, { tieBreaker = null, keepOrder = false } = {}) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const pq = this.prepareSearchQuery(query);
        if (!pq) return [...items];

        const scored = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const score = getScoreFn(pq, item);
            if (score > 0) scored.push({ item, score, idx: i });
        }
        if (keepOrder) return scored.map(x => x.item);

        scored.sort((a, b) => {
            // Keep literal tier (>=70) ahead of fuzzy tier (<70), and exact/startsWith ahead of substring
            const tierA = a.score >= 90 ? 3 : (a.score >= 70 ? 2 : 1);
            const tierB = b.score >= 90 ? 3 : (b.score >= 70 ? 2 : 1);
            if (tierA !== tierB) return tierB - tierA;
            if (tierA === 1 && a.score !== b.score) return b.score - a.score;
            if (tieBreaker) return tieBreaker(a.item, b.item);
            return a.idx - b.idx;
        });
        return scored.map(x => x.item);
    },
    // ===================== End Unified Smart Search Engine =====================

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
     * Advanced Client-Side Image Processor (v18.8.0)
     * Features:
     * 1. Smart 1:1 Center-Square Crop (eliminates background waste, fits medicine boxes)
     * 2. Next-Gen WebP encoding with JPEG fallback (~15-25 KB output)
     * 3. Non-blocking canvas rendering (0 freeze, 0 lag on mobile)
     */
    async compressImage(file, options = {}) {
        if (!file) return null;
        const {
            maxDimension = 600,
            quality = 0.8,
            cropSquare = true
        } = options;

        return new Promise((resolve, reject) => {
            if (!file.type || !file.type.startsWith('image/')) {
                return resolve({ blob: file, dataUrl: null, size: file.size, sizeKB: Math.round(file.size / 1024), format: 'raw' });
            }

            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let targetWidth, targetHeight;

                if (cropSquare) {
                    // Smart Center-Square Crop for Medicine Boxes
                    const minEdge = Math.min(img.width, img.height);
                    const sx = Math.round((img.width - minEdge) / 2);
                    const sy = Math.round((img.height - minEdge) / 2);
                    const destSize = Math.min(minEdge, maxDimension);

                    canvas.width = destSize;
                    canvas.height = destSize;
                    targetWidth = destSize;
                    targetHeight = destSize;

                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, destSize, destSize);
                    ctx.drawImage(img, sx, sy, minEdge, minEdge, 0, 0, destSize, destSize);
                } else {
                    // Proportional Fit
                    let w = img.width;
                    let h = img.height;
                    if (w > maxDimension || h > maxDimension) {
                        if (w > h) {
                            h = Math.round((h * maxDimension) / w);
                            w = maxDimension;
                        } else {
                            w = Math.round((w * maxDimension) / h);
                            h = maxDimension;
                        }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    targetWidth = w;
                    targetHeight = h;

                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                }

                // Prefer WebP for ultra-compact file size (~15-25KB), fallback to JPEG
                let mimeType = 'image/webp';
                let dataUrl = canvas.toDataURL('image/webp', quality);
                if (!dataUrl.startsWith('data:image/webp')) {
                    mimeType = 'image/jpeg';
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                canvas.toBlob((blob) => {
                    const finalBlob = blob || file;
                    const size = finalBlob.size || dataUrl.length;
                    resolve({
                        blob: finalBlob,
                        dataUrl,
                        width: targetWidth,
                        height: targetHeight,
                        size,
                        sizeKB: Math.max(1, Math.round(size / 1024)),
                        format: mimeType === 'image/webp' ? 'WebP' : 'JPEG'
                    });
                }, mimeType, quality);
            };

            img.onerror = (err) => {
                URL.revokeObjectURL(objectUrl);
                this.fileToBase64(file).then(dataUrl => {
                    resolve({ blob: file, dataUrl, size: file.size, sizeKB: Math.round(file.size / 1024), format: 'fallback' });
                }).catch(reject);
            };

            img.src = objectUrl;
        });
    }
};
