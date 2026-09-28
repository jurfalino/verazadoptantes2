/**
 * Pending searches → the "Quedó pendiente" asks.
 *
 * A rescuer usually searches the same person two or three times, each one more
 * specific than the last ("Maria" → "Maria Perez" → "Maria Perez 11-6666666").
 * Asking about each of those separately would be three questions about one
 * person, so searches that refine one another collapse into a single ask,
 * represented by the most complete search of the group.
 *
 * Pure: no DB, no server imports.
 */

import { normalizeText, extractPhones, extractEmails, extractIds, extractNameWords } from '@/lib/tokenizer';

export interface PendingSearch {
    id: string;
    query: string;
    /** Epoch seconds. */
    createdAt: number;
    /** Set when THIS search matched exactly one adopter. */
    adopterId?: string | null;
    adopterName?: string | null;
    /** Relevance % of that single match, 0-100. */
    matchConfidence?: number | null;
}

/**
 * Below this, a single match is a coincidence rather than an identification,
 * and the deck must not name that person or offer to open their profile.
 */
export const HIGH_CONFIDENCE_PERCENT = 80;

/**
 * Whether the ask knows who it is about. Only the ask's own search counts:
 * v2.56.82 let a broader search ("Maria Ornella", one match) name an ask led by
 * a narrower one ("Maria Ornella Capri Otto", no matches), and a record was
 * written against a person the rescuer never confirmed. A narrower search
 * finding nobody is evidence the person is NOT that record.
 */
export function isIdentified(ask: Pick<PendingSearch, 'adopterId' | 'matchConfidence'>): boolean {
    return !!ask.adopterId && (ask.matchConfidence ?? 0) >= HIGH_CONFIDENCE_PERCENT;
}

export interface PendingAsk extends PendingSearch {
    /** How many searches this ask stands for, itself included. */
    searchCount: number;
    /** Every search folded into this ask — answering it closes all of them. */
    memberIds: string[];
}

export interface GroupOptions {
    /** Ignore searches older than this. Default 30 days. */
    maxAgeDays?: number;
    /** Most asks to return. Default 10. */
    limit?: number;
    /** Epoch seconds, for the age window. Defaults to now. */
    now?: number;
}

/** A name token can be matched by a longer token it starts, so "mar" folds into "maria". */
const MIN_PREFIX = 3;

/**
 * A prefix match only means "still typing" when the two searches happened close
 * together. Minutes apart, "Ana" is the start of "Anabel"; days apart they are
 * two different people, and merging them would lose one of the asks.
 */
const TYPING_WINDOW_SECONDS = 600;

interface Fingerprint {
    names: string[];
    exact: string[];
}

export function fingerprint(query: string): Fingerprint {
    const text = query || '';
    const exact = [
        ...extractPhones(text),
        ...extractEmails(text).map(normalizeText),
        ...extractIds(text),
    ];
    return { names: extractNameWords(text), exact };
}

function tokenCount(f: Fingerprint): number {
    return f.names.length + f.exact.length;
}

function nameMatches(a: string, b: string): boolean {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= MIN_PREFIX && long.startsWith(short);
}

export type RefineKind = 'no' | 'exact' | 'prefix';

/**
 * How `wide` relates to `narrow`: 'exact' when every token of the narrower
 * search appears whole in the wider one ("Maria Perez" carries "Maria"
 * further), 'prefix' when it only matches by a half-typed word ("Maria"
 * carries "Mar"), 'no' when the narrower search has a token the wider one
 * lacks ("Maria Gomez" vs "Maria Perez").
 */
export function refineKind(wide: Fingerprint, narrow: Fingerprint): RefineKind {
    if (tokenCount(narrow) === 0 || tokenCount(wide) === 0) return 'no';
    if (!narrow.exact.every((e) => wide.exact.includes(e))) return 'no';

    let usedPrefix = false;
    for (const n of narrow.names) {
        if (wide.names.includes(n)) continue;
        if (wide.names.some((w) => nameMatches(w, n))) { usedPrefix = true; continue; }
        return 'no';
    }
    return usedPrefix ? 'prefix' : 'exact';
}

/** True when `wide` is `narrow` carried further, by whole tokens or by a half-typed word. */
export function refines(wide: Fingerprint, narrow: Fingerprint): boolean {
    return refineKind(wide, narrow) !== 'no';
}

/**
 * Collapse a rescuer's unanswered searches into one ask per person searched,
 * newest first. Each ask carries the most complete search of its group.
 */
export function groupPendingSearches(searches: PendingSearch[], options: GroupOptions = {}): PendingAsk[] {
    const { maxAgeDays = 30, limit = 10, now = Math.floor(Date.now() / 1000) } = options;
    const cutoff = now - maxAgeDays * 86400;

    const fresh = searches
        .filter((s) => s.createdAt >= cutoff && tokenCount(fingerprint(s.query)) > 0)
        // Most complete first, then most recent: the survivor of each group leads it.
        .sort((a, b) => {
            const diff = tokenCount(fingerprint(b.query)) - tokenCount(fingerprint(a.query));
            return diff !== 0 ? diff : b.createdAt - a.createdAt;
        });

    const groups: Array<{ lead: PendingSearch; leadPrint: Fingerprint; memberIds: string[] }> = [];

    for (const search of fresh) {
        const print = fingerprint(search.query);
        const home = groups.find((g) => {
            const kind = refineKind(g.leadPrint, print) !== 'no'
                ? refineKind(g.leadPrint, print)
                : refineKind(print, g.leadPrint);
            if (kind === 'no') return false;
            if (kind === 'exact') return true;
            // Half-typed: only the same search when it was typed moments before.
            return Math.abs(g.lead.createdAt - search.createdAt) <= TYPING_WINDOW_SECONDS;
        });
        if (home) {
            // The lead keeps its OWN identity, or none. Never borrow the match of
            // a broader search in the group — see isIdentified().
            home.memberIds.push(search.id);
            continue;
        }
        groups.push({ lead: search, leadPrint: print, memberIds: [search.id] });
    }

    return groups
        .map((g) => ({ ...g.lead, searchCount: g.memberIds.length, memberIds: g.memberIds }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
}
