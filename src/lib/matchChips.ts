/**
 * Match-reason chip helper.
 *
 * Converts the matchValues array from a DuplicateMatch / DiscoveryMatch into a
 * compact list of UI chips that tell the user WHICH field triggered a match
 * (phone, email, name word, etc.) and what the matched value was.
 *
 * Used by AdopterForm's inline match card, the save-confirmation modal, and
 * the DuplicatePeek side panel. Each chip carries an `isStrong` flag — true for
 * identity-level matches (phone/email/social) — which drives the strong-match
 * strip + save-modal gate in Phase D.
 */

export type MatchValue = { type: string; value: string };

export interface MatchChip {
    /** Stable key for React lists. */
    key: string;
    /** Single emoji shown before the label. */
    icon: string;
    /** Display label, possibly including the value. Already localized fallback English. */
    label: string;
    /** True for high-signal identity matches (phone/email/social). */
    isStrong: boolean;
}

const STRONG_TYPES = new Set(['phone', 'phone_suffix', 'email', 'social', 'id_number']);

/**
 * Build the chip list for one match. Pass a translator function so the helper
 * stays decoupled from LanguageContext — callers thread their own t().
 */
export function buildMatchChips(
    matchValues: MatchValue[] | undefined,
    t?: (key: string) => string,
): MatchChip[] {
    if (!matchValues || matchValues.length === 0) return [];

    const tr = (key: string, fallback: string) => {
        if (!t) return fallback;
        const v = t(key);
        // The app's t() returns the raw key when missing — treat that as "use fallback".
        return v === key ? fallback : v;
    };

    // Dedup logic: if both `phone` and `phone_suffix` fire for the same record
    // and the suffix is contained in the full phone, drop the suffix chip
    // (the full phone subsumes it).
    const seen = new Set<string>();
    const chips: MatchChip[] = [];
    const fullPhones = new Set(matchValues.filter(v => v.type === 'phone').map(v => v.value));

    for (const v of matchValues) {
        // Skip phone_suffix chips when a full phone chip already covers them.
        if (v.type === 'phone_suffix') {
            const covered = Array.from(fullPhones).some(p => p.endsWith(v.value));
            if (covered) continue;
        }
        const dedupKey = `${v.type}|${v.value}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const chip = chipFor(v, tr);
        if (chip) chips.push(chip);
    }

    // Cap address chips to 2 — multiple address words on one record usually
    // duplicate signal (same address split into multiple tokens).
    const addrChips = chips.filter(c => c.key.startsWith('address_word|'));
    if (addrChips.length > 2) {
        const drop = new Set(addrChips.slice(2).map(c => c.key));
        return chips.filter(c => !drop.has(c.key));
    }
    return chips;
}

function chipFor(v: MatchValue, tr: (key: string, fallback: string) => string): MatchChip | null {
    const key = `${v.type}|${v.value}`;
    const isStrong = STRONG_TYPES.has(v.type);

    switch (v.type) {
        case 'phone':
            return { key, icon: '📱', label: v.value, isStrong };
        case 'phone_suffix':
            return { key, icon: '📱', label: tr('adopter.dup_chip_phone_suffix', 'termina en …') + v.value.slice(-4), isStrong };
        case 'email':
            return { key, icon: '📧', label: v.value, isStrong };
        case 'social':
            return { key, icon: '📷', label: v.value, isStrong };
        case 'name_full':
            return { key, icon: '📝', label: tr('adopter.dup_chip_name_full', 'mismo nombre completo'), isStrong: false };
        case 'name_word':
            return { key, icon: '📝', label: `"${v.value}"`, isStrong: false };
        case 'address_word':
            return { key, icon: '🏠', label: `"${v.value}"`, isStrong: false };
        case 'source_url':
            return { key, icon: '🔗', label: tr('adopter.dup_chip_source_url', 'mismo enlace de origen'), isStrong: false };
        case 'id_number':
            return { key, icon: '🪪', label: v.value, isStrong };
        default:
            return null;
    }
}

/** Convenience: does this match list contain at least one strong chip? */
export function hasStrongMatch(matchValues: MatchValue[] | undefined): boolean {
    if (!matchValues) return false;
    return matchValues.some(v => STRONG_TYPES.has(v.type));
}
