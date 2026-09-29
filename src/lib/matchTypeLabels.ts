/**
 * The label for each duplicate-match type ("why do these two profiles match?").
 *
 * The same concept shows on the form-result card, the admin merge modal and the
 * flagging dialog. Each kept its own map, and each missed types that
 * `findAdopters` emits, so rescuers saw raw codes such as
 * `like_fallback_name`. This is now the one map; the test next to it checks
 * every type duplicate detection can emit against all three locales.
 *
 * Values are full i18n key paths. Pure module: safe in client components.
 */
export const MATCH_TYPE_LABEL_KEYS: Readonly<Record<string, string>> = {
    // Legacy prefixed taxonomy (notifications written by the bespoke matcher pre-v2.14.7-12)
    'token:name_full': 'formResults.match_name_full',
    'token:name_word': 'formResults.match_name_word',
    'token:phone': 'formResults.match_phone',
    'token:phone_suffix': 'formResults.match_phone_suffix',
    'token:email': 'formResults.match_email',
    'token:social': 'formResults.match_social',
    'like:name': 'formResults.match_like_name',
    'like:contact': 'formResults.match_like_contact',
    // Unprefixed taxonomy emitted by findAdopters duplicate-mode (v2.14.7-12+)
    name_full: 'formResults.match_name_full',
    name_word: 'formResults.match_name_word',
    name_word_fuzzy: 'formResults.match_name_word',
    phone: 'formResults.match_phone',
    phone_suffix: 'formResults.match_phone_suffix',
    email: 'formResults.match_email',
    social: 'formResults.match_social',
    social_handle: 'formResults.match_social',
    name_phonetic: 'formResults.match_name_word',
    like_fallback: 'formResults.match_like_contact',
    // v2.19.24 split of like_fallback — emitted ever since, never labelled.
    like_fallback_name: 'formResults.match_like_name',
    like_fallback_contact: 'formResults.match_like_contact',
    // No formResults copy exists for these; reuse the approved duplicates.* copy.
    address_word: 'duplicates.match_address',
    source_url: 'duplicates.match_source_url',
    id_number: 'duplicates.match_id_number',
    flagged_by_user: 'duplicates.match_flagged',
};

/** The i18n key for a match type, or null when it has none. */
export function matchTypeLabelKey(type: string): string | null {
    return MATCH_TYPE_LABEL_KEYS[type] ?? null;
}

/**
 * The localized label for a match type. `t()` returns the key path itself
 * when a key is missing, so that case is treated as "no label" too. An unknown
 * type degrades to readable words, never a raw code.
 */
export function matchTypeLabel(type: string, t: (key: string) => string): string {
    const key = matchTypeLabelKey(type);
    if (key) {
        const label = (t(key) || '').trim();
        if (label && label !== key) return label;
    }
    return type.replace(/^(token|like):/, '').replace(/_/g, ' ');
}
