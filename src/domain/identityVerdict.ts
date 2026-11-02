/**
 * The one same / possible / no verdict on "is this arriving person that existing
 * profile?" (spec 2026-11-02-identity-verdict-design §3). Pure: retrieval hands
 * in what a candidate shares; this decides. Name rule lives in ./apiExactMatch.
 */
import { matchNameAgainstProfile, nameWords } from './apiExactMatch';

export type IdentifierKind = 'document' | 'phone' | 'email' | 'social';

export interface PersonFacts {
    name: string;
    aliases: string[];
    phones: string[];
    emails: string[];
    socials: string[];
    documentIds: string[];
    country?: string | null;
}

export interface SharedIdentifier {
    kind: IdentifierKind;
    value: string;
    /** distinct folded names among live profiles holding it; null = count unavailable */
    namesHolding: number | null;
}

export interface IdentityCandidate {
    adopterId: string;
    name: string;
    aliases: string[];
    shared: SharedIdentifier[];
    relevancePercent: number;
    /** Engine match types. 'like_fallback_contact' with nothing in `shared` = found only by the
     *  contact-text LIKE fallback: evidence, judged possible (never same). */
    matchTypes: string[];
    matchValues: Array<{ type: string; value: string }>;
    /** How retrieval found it. Plays no part in the verdict. */
    source: 'token' | 'like' | 'both';
    /** details failed to load */
    degraded?: boolean;
}

export type Verdict = 'same' | 'possible' | 'no';
export type VerdictReason =
    | 'shared_document'
    | 'shared_contact_name_compatible'
    | 'shared_contact_name_differs'
    | 'same_full_name'
    | 'details_unavailable';

export interface Judged {
    candidate: IdentityCandidate;
    verdict: Verdict;
    reason: VerdictReason | null;
    /** Which of the candidate's own names fits the incoming name (used only to rank). */
    nameMatchedAs?: 'profile' | 'alias';
}

/** An identifier held by more than this many differently-named profiles links nobody. */
export const MAX_NAMES_PER_IDENTIFIER = 3;

const PLACEHOLDER_DOCUMENTS = new Set(['12345678', '123456789', '1234567', '87654321']);

/** `normalized` = lowercase [a-z0-9] (as `normalizeDocumentId`). One digit repeated 6+ times, or a known sequence. */
export function isPlaceholderDocument(normalized: string): boolean {
    return /^(\d)\1{5,}$/.test(normalized) || PLACEHOLDER_DOCUMENTS.has(normalized);
}

export function countsAsShared(id: SharedIdentifier): boolean {
    if (id.kind === 'document' && isPlaceholderDocument(id.value.toLowerCase().replace(/[^a-z0-9]/g, ''))) return false;
    return id.namesHolding !== null && id.namesHolding <= MAX_NAMES_PER_IDENTIFIER;
}

export function judgeIdentity(incoming: PersonFacts, candidate: IdentityCandidate): Judged {
    const make = (verdict: Verdict, reason: VerdictReason | null, nameMatchedAs?: 'profile' | 'alias'): Judged =>
        ({ candidate, verdict, reason, ...(nameMatchedAs ? { nameMatchedAs } : {}) });

    const counted = candidate.shared.filter(countsAsShared);
    const unknown = candidate.shared.some(s => s.namesHolding === null && !(s.kind === 'document' && isPlaceholderDocument(s.value.toLowerCase().replace(/[^a-z0-9]/g, ''))));

    // Never promote on incomplete evidence.
    if (candidate.degraded && candidate.shared.length > 0) return make('possible', 'details_unavailable');
    if (counted.length === 0 && unknown) return make('possible', 'details_unavailable');

    const matchedAs = matchNameAgainstProfile(incoming.name, {
        profileId: candidate.adopterId, name: candidate.name, aliases: candidate.aliases,
    });
    const own = matchedAs === 'profile' || matchedAs === 'alias' ? matchedAs : undefined;

    if (counted.some(s => s.kind === 'document')) return make('same', 'shared_document', own);
    if (counted.length > 0) {
        return own
            ? make('same', 'shared_contact_name_compatible', own)
            : make('possible', 'shared_contact_name_differs');
    }
    if (own && nameWords(incoming.name).length >= 2 && nameWords(candidate.name).length >= 2) {
        return make('possible', 'same_full_name', own);
    }
    // Found only by the contact-text LIKE fallback (an untokenized contact): evidence, but
    // unverified — possible, never same (controller ruling, final review item 7).
    if (candidate.shared.length === 0 && candidate.matchTypes.includes('like_fallback_contact')) {
        return make('possible', 'shared_contact_name_differs', own);
    }
    return make('no', null);
}

function distinctKinds(j: Judged): number {
    return new Set(j.candidate.shared.filter(countsAsShared).map(s => s.kind)).size;
}

/** Drops 'no'. same before possible; ties by distinct shared kinds, own-name fit, then relevance. */
export function rankJudged(list: Judged[]): Judged[] {
    return list
        .filter(j => j.verdict !== 'no')
        .sort((a, b) => {
            if (a.verdict !== b.verdict) return a.verdict === 'same' ? -1 : 1;
            if (a.verdict === 'same') {
                const k = distinctKinds(b) - distinctKinds(a);
                if (k) return k;
                const n = Number(b.nameMatchedAs === 'profile') - Number(a.nameMatchedAs === 'profile');
                if (n) return n;
            }
            return b.candidate.relevancePercent - a.candidate.relevancePercent;
        });
}
