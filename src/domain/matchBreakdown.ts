/**
 * Field by field: what a possible duplicate shares with the data the rescuer is
 * deciding about — a post, a form, a contract, what they typed, a spreadsheet
 * row, or another profile — and what it doesn't (Jon, 2026-10-25: "we don't
 * explain why"). One rule for every screen that asks "same person?".
 *
 * Privacy: the existing profile's values are NEVER part of the result except
 * its name (names are not PII-gated). For each field we only know, from the
 * match engine, which of OUR values matched, and from getMatchContext whether
 * the profile HAS that kind of contact at all. So a row can say "same phone:
 * 11 2345-6789" (the rescuer's own value) or "the profile has a different
 * phone" — never which one. Same rule as "you can only confirm a detail you
 * already have".
 */

export type BreakdownField = 'name' | 'phone' | 'email' | 'social' | 'id' | 'address';
export type BreakdownStatus = 'match' | 'partial' | 'different' | 'only_source' | 'only_profile';

export interface BreakdownRow {
    field: BreakdownField;
    status: BreakdownStatus;
    /** What the source has for this field (the rescuer's own data), when it has it. */
    source?: string;
    /** Only for `name`: the existing profile's name. Never set for contact fields. */
    profile?: string;
}

const FIELD_OF: Record<string, BreakdownField> = {
    name_full: 'name', name_word: 'name', name_phonetic: 'name', name_word_fuzzy: 'name', like_fallback_name: 'name',
    phone: 'phone', phone_suffix: 'phone',
    email: 'email',
    social: 'social', social_handle: 'social',
    id_number: 'id',
    address_word: 'address',
};
/** Match types that mean the whole value matched, not a part of it. */
const EXACT = new Set(['name_full', 'phone', 'email', 'social', 'social_handle', 'id_number']);
const ENTRY_FIELD: Record<string, BreakdownField> = { phone: 'phone', email: 'email', social: 'social', id: 'id', address: 'address' };
const ORDER: BreakdownStatus[] = ['match', 'partial', 'different', 'only_source', 'only_profile'];
const FIELD_ORDER: BreakdownField[] = ['name', 'phone', 'email', 'social', 'id', 'address'];

export function matchBreakdown(input: {
    matchTypes: string[];
    source: { name?: string; entries: Array<{ type: string; value: string }> };
    profile: { name?: string | null; has: { phone: boolean; email: boolean; id: boolean; social: boolean; address: boolean } | null };
}): BreakdownRow[] {
    // Which fields matched, and whether fully.
    const matched = new Map<BreakdownField, 'match' | 'partial'>();
    for (const raw of input.matchTypes) {
        // Form notifications store the legacy prefixed taxonomy ("token:phone").
        const t = raw.replace(/^token:/, '');
        // A LIKE hit on the contact blob: we can't tell which contact, so it
        // does not claim a field (the engine's other signals usually do).
        const f = FIELD_OF[t];
        if (!f) continue;
        const kind = EXACT.has(t) ? 'match' : 'partial';
        if (matched.get(f) !== 'match') matched.set(f, kind);
    }

    const sourceValues = new Map<BreakdownField, string[]>();
    for (const e of input.source.entries) {
        const f = ENTRY_FIELD[e.type];
        if (!f || !e.value.trim()) continue;
        sourceValues.set(f, [...(sourceValues.get(f) ?? []), e.value.trim()]);
    }
    const sourceName = input.source.name?.trim() || '';
    const profileName = input.profile.name?.trim() || '';
    const has = input.profile.has;

    const rows: BreakdownRow[] = [];
    for (const field of FIELD_ORDER) {
        if (field === 'name') {
            const m = matched.get('name');
            if (m) rows.push({ field, status: m, source: sourceName || undefined, profile: profileName || undefined });
            else if (sourceName && profileName) rows.push({ field, status: 'different', source: sourceName, profile: profileName });
            else if (sourceName) rows.push({ field, status: 'only_source', source: sourceName });
            continue;
        }
        const mine = sourceValues.get(field) ?? [];
        const theirs = has ? has[field] : false;
        const m = matched.get(field);
        if (m) rows.push({ field, status: m, source: mine.join(' · ') || undefined });
        else if (mine.length && theirs) rows.push({ field, status: 'different', source: mine.join(' · ') });
        else if (mine.length) rows.push({ field, status: 'only_source', source: mine.join(' · ') });
        else if (theirs) rows.push({ field, status: 'only_profile' });
    }
    return rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}
