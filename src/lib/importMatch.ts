/**
 * Duplicate-match → human sentence helpers for the import wizard's Step-4
 * "this looks like an existing profile" cards. Pure (the i18n `t` is injected),
 * so they live here in lib rather than inline in the presentation component and
 * can be reused by the Edit / search surfaces. Extracted from ImportWizard
 * (4-layer compliance).
 */

export function matchTypeToLabelKey(type: string): string | null {
    switch (type) {
        case 'phone': case 'phone_suffix': return 'import.match_label_phone';
        case 'email': return 'import.match_label_email';
        case 'social': return 'import.match_label_social';
        case 'name_full': case 'name_word': return 'import.match_label_name';
        case 'address_word': return 'import.match_label_address';
        case 'source_url': return 'import.match_label_source_url';
        case 'id_number': return 'import.match_label_id_number';
        default: return null;
    }
}

/**
 * Build a natural-language sentence describing what the proposed duplicate
 * shares with the user's input. Returns a string — the name is expected to
 * render separately (Step 4 cards stack name above the sentence), so we
 * don't include it here. Falls back to the low-band preamble if every
 * match type is filtered out by matchTypeToLabelKey.
 */
export function humanMatchSentence(
    matchTypes: string[],
    t: (key: string) => string,
): string {
    const labelKeys = Array.from(new Set(
        matchTypes.map(matchTypeToLabelKey).filter((k): k is string => !!k)
    ));
    const labels = labelKeys.map(k => t(k));
    if (labels.length === 0) {
        return t('import.match_band_low');
    }
    if (labels.length === 1) {
        return t('import.shares_one').replace('{x}', labels[0]);
    }
    if (labels.length === 2) {
        return t('import.shares_two').replace('{x}', labels[0]).replace('{y}', labels[1]);
    }
    return t('import.shares_many').replace('{x}', labels[0]).replace('{y}', labels[1]);
}
