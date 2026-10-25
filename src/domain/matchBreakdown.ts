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
    /** The other profile's value: its name always; a contact only when the
     *  screen passed `profile.entries` — values this viewer may already see
     *  there (masked ones keep their «•»). */
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

/** Masked values («••••») never count as equal to anything. */
function sameValue(field: BreakdownField, a: string, b: string): boolean {
    if (a.includes('•') || b.includes('•')) return false;
    if (field === 'phone') {
        const da = a.replace(/\D/g, ''), db = b.replace(/\D/g, '');
        return da.length >= 6 && db.length >= 6 && (da.endsWith(db) || db.endsWith(da));
    }
    const n = (v: string) => v.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/^@/, '').replace(/\s+/g, ' ').trim();
    return n(a) === n(b);
}

const normName = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function matchBreakdown(input: {
    matchTypes: string[];
    source: { name?: string; entries: Array<{ type: string; value: string }> };
    profile: {
        name?: string | null;
        has: { phone: boolean; email: boolean; id: boolean; social: boolean; address: boolean } | null;
        /** Only from a screen that already shows the profile's contact to this viewer. */
        entries?: Array<{ type: string; value: string }>;
    };
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
    const profileValues = new Map<BreakdownField, string[]>();
    for (const e of input.profile.entries ?? []) {
        const f = ENTRY_FIELD[e.type];
        if (!f || !e.value.trim()) continue;
        profileValues.set(f, [...(profileValues.get(f) ?? []), e.value.trim()]);
    }
    const sourceName = input.source.name?.trim() || '';
    const profileName = input.profile.name?.trim() || '';
    const has = input.profile.has;

    const rows: BreakdownRow[] = [];
    for (const field of FIELD_ORDER) {
        if (field === 'name') {
            let m = matched.get('name');
            // The engine calls "María García" a full-name hit on "María García
            // López"; both names are on screen, so only call them the same when
            // they are.
            if (m === 'match' && sourceName && profileName && normName(sourceName) !== normName(profileName)) m = 'partial';
            // And the other way: a phone-only or flagged pair whose names are the same.
            if (!m && sourceName && profileName && normName(sourceName) === normName(profileName)) m = 'match';
            if (m) rows.push({ field, status: m, source: sourceName || undefined, profile: profileName || undefined });
            else if (sourceName && profileName) rows.push({ field, status: 'different', source: sourceName, profile: profileName });
            else if (sourceName) rows.push({ field, status: 'only_source', source: sourceName });
            continue;
        }
        const mine = sourceValues.get(field) ?? [];
        const shown = profileValues.get(field) ?? [];
        const theirs = (has ? has[field] : false) || shown.length > 0;
        const profile = shown.join(' · ') || undefined;
        let m = matched.get(field);
        // Both values on screen and equal: a match, whatever the engine scored.
        if (!m && mine.some(a => shown.some(b => sameValue(field, a, b)))) m = 'match';
        if (m) rows.push({ field, status: m, source: mine.join(' · ') || undefined, profile });
        else if (mine.length && theirs) rows.push({ field, status: 'different', source: mine.join(' · '), profile });
        else if (mine.length) rows.push({ field, status: 'only_source', source: mine.join(' · ') });
        else if (theirs) rows.push({ field, status: 'only_profile', profile });
    }
    return rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}

/**
 * The card's one-line summary («Coinciden: … · Distinto: …»): which fields line
 * up (fully or in part) and which differ, in the rows' order. Fields on only
 * one side are neither.
 */
export function summarizeBreakdown(rows: BreakdownRow[]): { same: BreakdownField[]; diff: BreakdownField[] } {
    return {
        same: rows.filter(r => r.status === 'match' || r.status === 'partial').map(r => r.field),
        diff: rows.filter(r => r.status === 'different').map(r => r.field),
    };
}

/**
 * Signals the field rows can't place: a flag raised by a rescuer, the same
 * source URL, a general text hit. They still explain why the pair is here, so
 * the card lists them («También: …») rather than dropping them.
 */
export function otherSignals(matchTypes: string[]): string[] {
    return [...new Set(matchTypes.map(t => t.replace(/^token:/, '')).filter(t => !(t in FIELD_OF)))];
}
