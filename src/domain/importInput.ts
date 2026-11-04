/**
 * What the rescuer pasted into the import wizard's first step.
 *
 * A link shared from a phone rarely arrives alone — "Mirá este post https://…"
 * is the usual shape. The wizard used to fetch only when the whole field was a
 * URL, so a link with any words around it went to the AI as plain text and the
 * post (caption, photos) was never opened (audit 2026-10-21, A4).
 */

const LINK = /https?:\/\/[^\s<>"']+/gi;
/** Sentence punctuation that sticks to the end of a pasted link. */
const TRAILING = /[.,;:!?)\]}]+$/;

export interface LinkAndText {
    /** The one link to fetch, or null when there is none — or more than one. */
    url: string | null;
    /** Everything else the rescuer wrote, whitespace collapsed. */
    text: string;
}

export function splitLinkAndText(input: string): LinkAndText {
    const trimmed = input.trim();
    const found = trimmed.match(LINK) ?? [];
    // The same link twice (some apps put it in both share fields) is one link.
    const links = [...new Set(found.map(l => l.replace(TRAILING, '')))];
    // Zero links is plain text. Two or more different ones is a pasted
    // conversation: opening one would silently drop the other, so let the AI
    // read it all instead.
    if (links.length !== 1) return { url: null, text: trimmed };
    const url = links[0];
    const text = found
        .reduce((acc, raw) => acc.replace(raw, ' '), trimmed)
        .replace(/\(\s*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { url, text };
}

/** The fetched post first, then what the rescuer wrote about it. */
export function appendContext(fetched: string, context: string): string {
    const extra = context.trim();
    if (!extra) return fetched;
    if (!fetched.trim()) return extra;
    return `${fetched}\n\n---\n${extra}`;
}

/** Contact kinds that identify one person on their own (an address alone does not). */
const STRONG_IDENTIFIERS = new Set(['phone', 'email', 'social', 'id']);

/**
 * Can the import wizard save this profile? A name, or — for posts that only
 * show a handle — at least one strong identifier (decision B4, 2026-10-21).
 * The API already accepts a nameless profile; the wizard used to disable
 * "Guardar" with no explanation whenever the name was empty.
 */
export function canSaveImportedProfile(name: string | undefined, entries: Array<{ type: string; value: string }>): boolean {
    if (name?.trim()) return true;
    return entries.some(e => STRONG_IDENTIFIERS.has(e.type) && e.value.trim().length > 0);
}

/**
 * The AI's suggested rating, if it is one we can show: a whole number 1–5.
 * Anything else is "no suggestion" — ratings are never invented (Jon,
 * 2026-10-09); the suggestion is shown, tagged, and the rescuer confirms it
 * (Jon, 2026-10-22).
 */
export function suggestedRating(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : null;
}

/** "2026-10" from "2026-10-14" (or from "2026-10"); '' when there is no usable date. */
export function monthOf(isoDate: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})/.exec(isoDate ?? '');
    return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : '';
}

/**
 * The record's date from the DatePicker value: a full day as given, a month and
 * year ('YYYY-MM', its "No sé el día exacto" mode) as the 1st of that month.
 * Empty → undefined, which the API stores as NULL (it refuses to fabricate
 * "now" as the date of a past event).
 */
export function recordDateFrom(value: string): string | undefined {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && monthOf(value)) return value;
    return monthOf(value) ? `${monthOf(value)}-01` : undefined;
}

/** Lowercase, accents and extra spaces removed — for comparing two spellings of a name. */
function foldName(name: string): string {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The post's name to keep as an alias when it is merged into a profile that goes
 * by another name (decision B8, 2026-10-21) — "Mari G" into "María Gómez".
 * Null when there is no name or it is the same name spelled the same way.
 */
export function aliasForMerge(postName: string | undefined, targetName: string | undefined): string | null {
    const name = postName?.trim();
    if (!name) return null;
    return foldName(name) === foldName(targetName ?? '') ? null : name;
}

export type PostRelationship = 'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate' | 'unknown';
const RELATIONSHIPS = new Set<PostRelationship>(['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate', 'unknown']);

export interface PostPerson {
    name: string;
    relationship: PostRelationship;
    phones: string[];
    socialProfiles: string[];
}

/**
 * The other people a post names, as the AI read them, cleaned up: named,
 * not the main person again, not repeated, a known relationship, capped.
 * They are saved as relatives of the main profile (Jon, 2026-10-22).
 */
export function cleanOtherPeople(raw: unknown, mainName: string | undefined): PostPerson[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>([foldName(mainName ?? '')]);
    const out: PostPerson[] = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const r = p as Record<string, unknown>;
        const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
        const key = foldName(name);
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : []);
        out.push({
            name,
            relationship: RELATIONSHIPS.has(r.relationship as PostRelationship) ? r.relationship as PostRelationship : 'unknown',
            phones: strings(r.phones),
            socialProfiles: strings(r.socialProfiles),
        });
        if (out.length >= 10) break;
    }
    return out;
}

const NAME_MATCH_SIGNALS = new Set(['name_full', 'name_word', 'name_phonetic', 'name_word_fuzzy', 'like_fallback_name']);

/**
 * Did a duplicate match include the NAME? When it matched only on phone,
 * email or address, the post's person may be someone else in that household —
 * so merging asks "same person (alias) or a relative?" (Jon, 2026-10-22).
 */
export function matchedOnName(matchTypes: string[] | undefined): boolean {
    return (matchTypes ?? []).some(t => NAME_MATCH_SIGNALS.has(t));
}

/** Problems that got in the way of extracting a post's data. Never about what the post means. */
export type ExtractionIssue =
    // What happened during the import (facts)
    | 'extraction_failed' | 'post_text_unavailable' | 'info_in_video' | 'no_contact_found'
    // What the AI reports it could not read well
    | 'image_unreadable' | 'text_cut_off' | 'uncertain_contact' | 'uncertain_name' | 'unclear_attribution';

const AI_ISSUES = new Set<ExtractionIssue>(['image_unreadable', 'text_cut_off', 'uncertain_contact', 'uncertain_name', 'unclear_attribution']);
/** Shown most-blocking first. */
const ISSUE_ORDER: ExtractionIssue[] = [
    'extraction_failed', 'post_text_unavailable', 'info_in_video', 'image_unreadable', 'text_cut_off',
    'unclear_attribution', 'uncertain_name', 'uncertain_contact', 'no_contact_found',
];
type Level = 'high' | 'medium' | 'low';
const RANK: Record<Level, number> = { high: 2, medium: 1, low: 0 };
/** Each fact caps the level: some make the extraction weak however sure the AI was. */
const CAP: Partial<Record<ExtractionIssue, Level>> = {
    extraction_failed: 'low', post_text_unavailable: 'low', info_in_video: 'medium', no_contact_found: 'medium',
};

/**
 * How well a post's data was EXTRACTED (Jon, 2026-10-22): what happened during
 * the import plus the AI's own report of what it could not read — never how it
 * interprets the post (that is the rating). Each issue maps to a fix the
 * rescuer can make; nothing is shown when there is none.
 */
export function extractionQuality(input: {
    aiConfidence: unknown;
    aiIssues: unknown;
    aiFailed: boolean;
    postTextMissing: boolean;
    videoOnly: boolean;
    name: string | undefined;
    entries: Array<{ type: string; value: string }>;
}): { level: Level; issues: ExtractionIssue[] } {
    if (input.aiFailed) return { level: 'low', issues: ['extraction_failed'] };
    const issues = new Set<ExtractionIssue>();
    if (Array.isArray(input.aiIssues)) {
        for (const i of input.aiIssues) if (AI_ISSUES.has(i as ExtractionIssue)) issues.add(i as ExtractionIssue);
    }
    if (input.postTextMissing) issues.add('post_text_unavailable');
    if (input.videoOnly) issues.add('info_in_video');
    // A name but nothing to recognise the person by elsewhere. (No name and no
    // contact is already said by the save button's hint.)
    const hasIdentifier = input.entries.some(e => STRONG_IDENTIFIERS.has(e.type) && e.value.trim());
    if (input.name?.trim() && !hasIdentifier) issues.add('no_contact_found');

    let level: Level = input.aiConfidence === 'high' || input.aiConfidence === 'low' ? input.aiConfidence : 'medium';
    for (const i of issues) {
        const cap = CAP[i];
        if (cap && RANK[cap] < RANK[level]) level = cap;
    }
    // An AI that reports problems is not "high", whatever it graded.
    if (level === 'high' && [...issues].some(i => AI_ISSUES.has(i))) level = 'medium';
    return { level, issues: ISSUE_ORDER.filter(i => issues.has(i)) };
}
