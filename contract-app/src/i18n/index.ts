import { DEFAULT_LOCALE, type CatalogSlice, type Locale } from './types';
import { common } from './catalogs/common';
import { home } from './catalogs/home';
import { showcase } from './catalogs/showcase';
import { animal } from './catalogs/animal';
import { form } from './catalogs/form';
import { contract } from './catalogs/contract';

// Register every per-screen catalog slice here. Slices are disjoint key sets,
// merged per-locale into one flat dictionary at module load.
const SLICES: CatalogSlice[] = [
    common,
    home,
    showcase,
    animal,
    form,
    contract,
];

function mergeLocale(locale: Locale): Record<string, string> {
    return Object.assign({}, ...SLICES.map((s) => s[locale]));
}

const DICT: Record<Locale, Record<string, string>> = {
    es: mergeLocale('es'),
    en: mergeLocale('en'),
    pt: mergeLocale('pt'),
};

/**
 * Resolve a key for a locale. Falls back to Spanish (DEFAULT_LOCALE) for any
 * missing translation, then to the raw key as a last resort. Interpolates
 * `{name}`-style placeholders from `vars`.
 */
export function translate(
    locale: Locale,
    key: string,
    vars?: Record<string, string | number>,
): string {
    let out = DICT[locale]?.[key] ?? DICT[DEFAULT_LOCALE]?.[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            out = out.split(`{${k}}`).join(String(v));
        }
    }
    return out;
}

export type { Locale } from './types';
export { LOCALES, DEFAULT_LOCALE, isLocale } from './types';
