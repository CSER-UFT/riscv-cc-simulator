/**
 * Internacionalização: português (padrão) e inglês.
 */
import pt from './pt.js';
import en from './en.js';

const DICTS = { pt, en };
export const LANGUAGES = { pt: 'Português', en: 'English' };

let current = 'pt';
try {
    const stored = globalThis.localStorage?.getItem('cc.lang');
    if (stored && stored in DICTS) current = stored;
} catch {
    // sem armazenamento: mantém o padrão
}

export function getLanguage() {
    return current;
}

export function setLanguage(lang) {
    if (!(lang in DICTS)) return;
    current = lang;
    try {
        globalThis.localStorage?.setItem('cc.lang', lang);
    } catch {
        // ignora
    }
}

/**
 * Traduz uma chave, substituindo {parametro} pelos valores fornecidos.
 * @param {string} key
 * @param {object} params
 */
export function t(key, params = {}) {
    const s = DICTS[current][key] ?? DICTS.pt[key] ?? key;
    if (typeof s === 'function') return s(params);
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
