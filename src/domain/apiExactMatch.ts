/**
 * Exact-mode matching for the third-party API (.agents/plans/2026-10-09-third-party-api.md).
 *
 * Pure: no DB, no server imports. The caller looks the identifier up in the
 * token index, loads the profiles it hits, and asks these functions which
 * answer to give. A rescue's tool has no human to pick between profiles, so the
 * rule is: never guess. Anything short of exactly one consistent profile is
 * `ambiguous`, never a silent pick, and never a `not_found` for someone the
 * index did find (Jon, 2026-10-09).
 */

export type NameMatchedAs = 'profile' | 'alias' | 'household_member';

export type ExactOutcome =
    /** `otherProfileIds`: profiles the identifier ALSO hit under an unrelated name (shown, never chosen). */
    | { result: 'found'; profileId: string; nameMatchedAs: NameMatchedAs; otherProfileIds: string[] }
    | { result: 'not_found' }
    /** `compatible`: the candidates whose name fits (2+, or none). The activity goes on the best of them (pickBestMatch); none → a new profile. */
    | { result: 'ambiguous'; reason: 'multiple_profiles' | 'name_mismatch'; profileIds: string[]; compatible: Array<{ profileId: string; as: NameMatchedAs }> };

/** Accent- and case-folded words of a name; punctuation splits words. */
export function nameWords(name: string | null | undefined): string[] {
    return (name ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9ñ]+/g, ' ')
        .split(' ')
        .filter(Boolean);
}

/** "Full name" = at least two words of two or more letters ("María Pérez", not "María"). */
export function isFullName(name: string | null | undefined): boolean {
    return nameWords(name).filter(w => w.length >= 2).length >= 2;
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/** Same word, or one typo apart when both are long enough for a typo to be a typo. */
function wordsMatch(a: string, b: string): boolean {
    if (a === b) return true;
    return a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 1;
}

/**
 * Two names are consistent when every word of the shorter one appears in the
 * longer one, in any order, allowing one typo per word. So "María Pérez" fits
 * "María José Pérez Gómez", and "Maria Peres" fits "María Pérez", but
 * "María Gómez" does not fit "María Pérez".
 */
export function namesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
    const wa = nameWords(a);
    const wb = nameWords(b);
    if (wa.length === 0 || wb.length === 0) return false;
    const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    const pool = [...longer];
    for (const w of shorter) {
        const i = pool.findIndex(p => wordsMatch(w, p));
        if (i === -1) return false;
        pool.splice(i, 1); // a word of the longer name is used once
    }
    return true;
}

export interface CandidateNames {
    profileId: string;
    name: string;
    aliases: string[];
    householdNames: string[];
}

/** Which of a profile's names the input name is consistent with, if any. */
export function matchNameAgainstProfile(inputName: string, c: CandidateNames): NameMatchedAs | null {
    if (namesCompatible(inputName, c.name)) return 'profile';
    if (c.aliases.some(a => namesCompatible(inputName, a))) return 'alias';
    if (c.householdNames.some(h => namesCompatible(inputName, h))) return 'household_member';
    return null;
}

/**
 * The decision table (plan §Exact mode). `candidates` are the distinct live
 * profiles the identifier hit.
 */
export function decideExactOutcome(inputName: string, candidates: CandidateNames[]): ExactOutcome {
    if (candidates.length === 0) return { result: 'not_found' };
    const compatible = candidates
        .map(c => ({ profileId: c.profileId, as: matchNameAgainstProfile(inputName, c) }))
        .filter((c): c is { profileId: string; as: NameMatchedAs } => c.as !== null);
    const allIds = candidates.map(c => c.profileId);
    if (compatible.length === 1) {
        const chosen = compatible[0].profileId;
        return { result: 'found', profileId: chosen, nameMatchedAs: compatible[0].as, otherProfileIds: allIds.filter(id => id !== chosen) };
    }
    if (candidates.length === 1) return { result: 'ambiguous', reason: 'name_mismatch', profileIds: allIds, compatible: [] };
    return { result: 'ambiguous', reason: 'multiple_profiles', profileIds: allIds, compatible };
}

const NAME_RANK: Record<NameMatchedAs, number> = { profile: 3, alias: 2, household_member: 1 };

/**
 * Ambiguous, but more than one name fits (Jon, 2026-10-13): the activity goes on
 * the profile that matches the request best — most identifiers matched (email,
 * phone, document), then the closest name (the profile's own over an alias over
 * a household member), then the most recent activity. Null when no name fits:
 * the identifier belongs to someone else, so the caller creates a new profile.
 */
export function pickBestMatch(
    compatible: Array<{ profileId: string; as: NameMatchedAs }>,
    matchedOn: Map<string, string[]>,
    lastActivityAt: Map<string, string | number | null | undefined>,
): string | null {
    if (compatible.length === 0) return null;
    const when = (id: string) => {
        const v = lastActivityAt.get(id);
        const t = v == null ? NaN : typeof v === 'number' ? v : Date.parse(v);
        return Number.isNaN(t) ? -Infinity : t;
    };
    const ranked = [...compatible].sort((a, b) =>
        (matchedOn.get(b.profileId)?.length ?? 0) - (matchedOn.get(a.profileId)?.length ?? 0)
        || NAME_RANK[b.as] - NAME_RANK[a.as]
        || when(b.profileId) - when(a.profileId)
        || a.profileId.localeCompare(b.profileId));
    return ranked[0].profileId;
}

/** Document id as the tokenizer stores it (`id_number`): lowercase [a-z0-9] only. */
export function normalizeDocumentId(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The tokenizer only indexes ids of ≥5 chars with ≥4 digits; anything shorter can never match. */
export function isUsableDocumentId(raw: string): boolean {
    const n = normalizeDocumentId(raw);
    return n.length >= 5 && (n.match(/\d/g) || []).length >= 4;
}
