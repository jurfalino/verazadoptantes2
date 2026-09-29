import { describe, it, expect } from 'vitest';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';
import { DUPLICATE_MATCH_WEIGHTS, FUZZY_NAME_MATCH_TYPE } from './scoring';
import { MATCH_TYPE_LABEL_KEYS, matchTypeLabel, matchTypeLabelKey } from './matchTypeLabels';

/**
 * Every match type duplicate detection can emit must have a label that resolves
 * in es, en and pt. Before this, `like_fallback_name` / `like_fallback_contact`
 * (emitted since v2.19.24) had none, so rescuers saw the raw code on the
 * form-result card.
 *
 * Reads the dictionaries directly: `t()` returns the key path for a missing
 * key, so any check through `t(k) || fallback` would pass vacuously.
 */

/** Every type `findAdopters` duplicate-mode can put in `matchTypes`. */
const EMITTED_TYPES = [
    ...Object.keys(DUPLICATE_MATCH_WEIGHTS),
    FUZZY_NAME_MATCH_TYPE,
    // Written by flagDuplicate (duplicates.ts) into duplicate_candidates, which
    // the merge modal and the flagging dialog read back.
    'flagged_by_user',
];

/** Older taxonomies still sitting in stored notifications. */
const LEGACY_TYPES = [
    'token:name_full', 'token:name_word', 'token:phone', 'token:phone_suffix',
    'token:email', 'token:social', 'like:name', 'like:contact', 'like_fallback',
];

const LOCALES = { es, en, pt } as Record<string, unknown>;

function resolve(dict: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        dict,
    );
}

describe('match type labels', () => {
    it.each([...EMITTED_TYPES, ...LEGACY_TYPES])('%s has a label key', (type) => {
        expect(matchTypeLabelKey(type)).toBeTruthy();
    });

    for (const [locale, dict] of Object.entries(LOCALES)) {
        it.each([...EMITTED_TYPES, ...LEGACY_TYPES])(`%s resolves in ${locale}`, (type) => {
            const key = matchTypeLabelKey(type);
            const value = key ? resolve(dict, key) : undefined;
            expect(typeof value).toBe('string');
            expect((value as string).trim()).not.toBe('');
        });
    }

    it('every mapped key resolves in every locale (no dead entries)', () => {
        for (const key of new Set(Object.values(MATCH_TYPE_LABEL_KEYS))) {
            for (const dict of Object.values(LOCALES)) {
                expect(typeof resolve(dict, key), key).toBe('string');
            }
        }
    });

    it('uses the translation when t() resolves the key', () => {
        const t = (k: string) => (resolve(es, k) as string | undefined) ?? k;
        expect(matchTypeLabel('like_fallback_name', t)).toBe(es.formResults.match_like_name);
        expect(matchTypeLabel('like_fallback_contact', t)).toBe(es.formResults.match_like_contact);
    });

    it('never shows a raw code when a key is missing or unknown', () => {
        const echo = (k: string) => k; // what t() does for a missing key
        expect(matchTypeLabel('like_fallback_name', echo)).not.toMatch(/_|formResults/);
        expect(matchTypeLabel('some_new_type', echo)).toBe('some new type');
    });
});
