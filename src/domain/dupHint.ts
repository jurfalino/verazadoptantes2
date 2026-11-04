/**
 * «Ya está en otro perfil» — the composer's inline duplicate hint (option B,
 * Jon 2026-10-29). Pure rules shared by the server action that finds the
 * matches (getDuplicateHintMatches) and the hint itself (DuplicateHint):
 *
 * - `dupHintSearchInput`: what the duplicate engine is asked for one typed
 *   strong identifier (phone / email / social / id). Anything else: no search.
 * - `entryMatchesTyped`: which of a match's own contacts is the one typed —
 *   read on the server BEFORE masking, so the window can mark it «coincide»
 *   even when the viewer only sees it partially (nothing beyond what they typed).
 * - `visibleDupHintMatches`: «No es esta persona» hides a match for as long as
 *   the typed value stays the same (local only, no server write).
 */
import { contactMatchKeys, detectSocialPlatform, sameContact, sameContactSet, type ContactEntry } from '@/lib/contactEntries';
import { mergeOwnersToTell, realOwner } from '@/domain/dedupPair';
import { samePhoneAsEvidence } from '@/domain/phoneNumber';

export type DupHintType = 'phone' | 'email' | 'social' | 'id';

export const DUP_HINT_TYPES: readonly DupHintType[] = ['phone', 'email', 'social', 'id'];

/** At most this many profiles in the box (as before). */
export const DUP_HINT_MAX_RESULTS = 3;
/**
 * Low floor: a phone_suffix exact match alone scores ~17%, which the original
 * 40% floor was silently dropping (v2.16.0-34). On a vetting tool, "you typed
 * a phone whose last 8 digits match an existing adopter" is a high-signal
 * duplicate worth surfacing — the user can answer «No es esta persona». 5% is a
 * sanity floor so a 0-score artefact can't surface.
 */
export const DUP_HINT_MIN_RELEVANCE = 5;
/** Longest value searched (a phone, email, handle or id is never longer). */
export const DUP_HINT_MAX_VALUE = 200;

export const isDupHintType = (t: unknown): t is DupHintType => typeof t === 'string' && (DUP_HINT_TYPES as readonly string[]).includes(t);

export type DupHintSearchInput =
    | { phones: string[] }
    | { emails: string[] }
    | { socials: string[] }
    | { ids: string[] };

/** The duplicate engine's input for one typed identifier; null = nothing to search. */
export function dupHintSearchInput(type: unknown, value: unknown): DupHintSearchInput | null {
    if (!isDupHintType(type) || typeof value !== 'string') return null;
    const v = value.trim().slice(0, DUP_HINT_MAX_VALUE);
    if (!v) return null;
    switch (type) {
        case 'phone': return { phones: [v] };
        case 'email': return { emails: [v.toLowerCase()] };
        case 'social': return { socials: [v.toLowerCase()] };
        // As an identity number: through contactInfo an unlabeled DNI was read
        // as a phone and never reached the id index.
        case 'id': return { ids: [v] };
    }
}

/**
 * True when a stored contact is the identifier typed, compared exactly as the
 * duplicate matcher compares them — the one shared rule, sameContact
 * (src/lib/contactEntries.ts): «+54 9 11 6312-0851» and «11 6312-0851» are the
 * same phone; emails case-insensitive; handles and ids normalized. The
 * window's «coincide», and whether «Continuar» still needs to add the value.
 */
export function entryMatchesTyped(entry: { type: string; value: string; platform?: string }, type: DupHintType, typed: string): boolean {
    if (entry.type !== type || typeof entry.value !== 'string') return false;
    const v = typed.trim();
    if (!v) return false;
    // Too short to be a phone the matcher indexes («123»): never «coincide».
    if (type === 'phone' && !contactMatchKeys({ type, value: v }).some(k => k.startsWith('~phone|'))) return false;
    return sameContact(entry as Pick<ContactEntry, 'type' | 'value' | 'platform'>, { type, value: v });
}

/**
 * Does «Continuar» still need to add the value being typed to the match? Not
 * when one of the match's entries already holds exactly it (sameContactSet:
 * «+54 9 11 6312-0851» is «11 6312-0851»). The confirmation's
 * «Se agregará» and the action itself both ask this, so they can't disagree.
 */
export function typedIsNewFor(matchEntries: ReadonlyArray<{ type: string; value: string; platform?: string }>, type: DupHintType, typed: string, platform?: string): boolean {
    const v = typed.trim();
    if (!v) return false;
    // Merging, not detecting: an entry of the match must hold exactly it (sameContactSet) —
    // otherwise it is saved as its own entry, as the merge keeps it.
    const entry = { type, value: v, ...(platform ? { platform: platform as ContactEntry['platform'] } : {}) };
    return !matchEntries.some(e => sameContactSet(entry, e as Pick<ContactEntry, 'type' | 'value' | 'platform'>));
}

/**
 * Do the two profiles really match? (EM review I1: «Continuar» merged any two
 * profiles by id.) Yes when either:
 * - the value being typed is one of the match's own contacts; or
 * - the profile being edited and the match already share a phone, email,
 *   handle or id number.
 * Both by sameIdentifier — stricter than the hint's «coincide» marker
 * (entryMatchesTyped), which also lights up on a shared last-8-digit ending.
 * A shared address, note, alias name or a «phone» with no digits is not
 * evidence: housemates share an address. The server action refuses anything
 * else as `not_a_match`, and the window offers the flag instead.
 */
type PairEntry = { type: string; value: string; platform?: string };
/** One profile's side of the pair: its contacts, and the country its phones are read with. */
export type PairSide = { entries: ReadonlyArray<PairEntry>; country?: string | null };

/**
 * The two contacts are the same identifier — strict, because a merge deletes a
 * profile (review 2026-11-01): phones as whole numbers read with each record's
 * country (samePhoneAsEvidence: «11 6312-0851» is «+54 9 11 6312-0851», but
 * «351 412-3456» is not «11 1412-3456» although their last 8 digits agree);
 * a handle on the same network — a saved link's network read from its URL, and
 * a handle whose network isn't known yet (typed before the network is picked)
 * matching by handle alone: the window then asks for the network, and
 * «Continuar» can't run without it (but never when neither side knows its
 * network). Emails and ids normalized as the matcher
 * does. Anything else is never evidence.
 */
function sameIdentifier(a: PairEntry, aCountry: string | null | undefined, b: PairEntry, bCountry: string | null | undefined): boolean {
    if (a.type !== b.type || typeof a.value !== 'string' || typeof b.value !== 'string') return false;
    if (a.type === 'phone') return samePhoneAsEvidence(a.value, aCountry, b.value, bCountry);
    if (a.type !== 'email' && a.type !== 'social' && a.type !== 'id') return false;
    if (a.type === 'social') {
        const network = (e: PairEntry) => e.platform || detectSocialPlatform(e.value) || '';
        const na = network(a), nb = network(b);
        // Neither side knows its network: a bare handle («ana») alone is too thin to delete a profile.
        if (!na && !nb) return false;
        if (na && nb && na !== nb) return false;
    }
    const strong = (e: PairEntry) => contactMatchKeys(e as Pick<ContactEntry, 'type' | 'value' | 'platform'>).filter(k => k.startsWith('~'));
    const keys = new Set(strong(a));
    return strong(b).some(k => keys.has(k));
}

export function dupHintPairMatches(
    current: PairSide,
    match: PairSide,
    typed?: { type: unknown; value: unknown; platform?: unknown } | null,
): boolean {
    if (typed && isDupHintType(typed.type) && typeof typed.value === 'string' && typed.value.trim()) {
        const t: PairEntry = { type: typed.type, value: typed.value.trim().slice(0, DUP_HINT_MAX_VALUE), ...(typeof typed.platform === 'string' && typed.platform ? { platform: typed.platform } : {}) };
        // Typed on the profile being edited: read with its country.
        if (match.entries.some(e => sameIdentifier(t, current.country, e, match.country))) return true;
    }
    return current.entries.some(c => match.entries.some(m => sameIdentifier(c, current.country, m, match.country)));
}

/** «No es esta persona» answers, for one typed value. */
export type DupHintDismissed = { value: string; ids: readonly string[] };

export const NO_DISMISSED: DupHintDismissed = { value: '', ids: [] };

/** Records «No es esta persona» for this match and this value (a new value starts over). */
export function dismissDupHintMatch(prev: DupHintDismissed, value: string, adopterId: string): DupHintDismissed {
    const v = value.trim();
    const ids = prev.value === v ? prev.ids : [];
    return ids.includes(adopterId) ? { value: v, ids } : { value: v, ids: [...ids, adopterId] };
}

/** The matches still shown: those answered «No es esta persona» for this same value are left out. */
export function visibleDupHintMatches<T extends { adopterId: string }>(matches: readonly T[], dismissed: DupHintDismissed, value: string): T[] {
    const v = value.trim();
    if (!v || dismissed.value !== v || dismissed.ids.length === 0) return [...matches];
    return matches.filter(m => !dismissed.ids.includes(m.adopterId));
}

// ─────────────── What the window offers (Jon 2026-10-29, prototype dato-coincide-v3) ───────────────

/**
 * What the «Ver perfil» window offers for one match, decided on the server
 * (getDuplicateHintMatches) and re-decided by every action it leads to:
 * - 'continue': «Continuar con este perfil» — the match keeps everything of
 *   the profile being edited (case 1: the viewer or their team loaded it, or
 *   the viewer is an admin).
 * - 'flag': «Marcar como posible duplicado» — someone else loaded the profile
 *   being edited (case 2), or the match has no real owner (case 3, D42: never
 *   absorbed into an ownerless profile without an admin).
 * - 'review_admins': «Ya dijeron que no son la misma persona» — the other
 *   owner declined the viewer team's request on this pair, or an admin ruled
 *   them separate (case 4): only the admins can be asked — and only by
 *   someone whose team loaded one of the two (fix round 2, review F1: never
 *   a stranger filing disputes about other people's profiles).
 * - 'pending': an open duplicate flag or a pending merge request already
 *   covers the pair (case 5): no second flag, no second notice.
 * - 'settled': the pair is already recorded as two people — they share a home,
 *   or it was set aside as «Mantener separados» / «Viven juntos» (F3, Jon
 *   2026-10-29, option a): «Ya figuran como personas distintas.», nothing to
 *   do but «No es esta persona» or open the profile. Before everything else,
 *   for admins too.
 */
export type DupHintAction = 'continue' | 'flag' | 'review_admins' | 'pending' | 'settled';

export interface DupHintFacts {
    isAdmin: boolean;
    /** The viewer or a teammate loaded the profile being edited (isOwnerOrOrgMate). */
    currentTeamOwned: boolean;
    /** The viewer or a teammate loaded the match. */
    matchTeamOwned: boolean;
    /** The match has a real owner (realOwner(addedBy)). */
    matchHasOwner: boolean;
    /** PairVerdict.declinedForTeam. */
    declinedForTeam: boolean;
    /** PairVerdict.adminRuledSeparate. */
    adminRuledSeparate: boolean;
    /** An open duplicate flag (either direction) or a pending merge request on the pair. */
    pending: boolean;
    /** Already recorded as two people (pairSettledSeparate: a shared home, «Mantener separados», «Viven juntos»). */
    settledSeparate: boolean;
}

/**
 * Priority 4 (said no) > 5 (pending) > 3 (ownerless) > 1 / 2. Admins choose
 * freely (D24): always 'continue' — a pending flag or request is only said
 * («Ya está marcado para revisar.»), and their merge closes it. «Said no» asks
 * the admins only for a viewer whose team loaded one of the two; anyone else
 * falls through (to 'flag', which a said-no pair refuses: the window says why).
 */
export function decideDupHintAction(f: DupHintFacts): DupHintAction {
    if (f.settledSeparate) return 'settled';
    if (f.isAdmin) return 'continue';
    if ((f.declinedForTeam || f.adminRuledSeparate) && (f.currentTeamOwned || f.matchTeamOwned)) return 'review_admins';
    if (f.pending) return 'pending';
    if (!f.matchHasOwner) return 'flag';
    return f.currentTeamOwned ? 'continue' : 'flag';
}

/**
 * «Continuar con este perfil»: the match survives, the profile being edited is
 * absorbed — with the same notices as «Pendientes» (mergePendingDedupPair):
 * - a rescuer merge (the absorbed side is the team's, the kept side is the
 *   team's or has a real owner): the kept side's owner hears it when foreign
 *   (`notifyOwner`, adopter_merged_by_rescuer);
 * - otherwise an admin's (`viaAdmin`): whoever loaded either profile hears it
 *   (notifyMergeOwners), never the admin.
 * `told`: exactly who those notices go to (emails, normalized) — the
 * confirmation's «Le avisamos a …» line is built from it.
 */
export function dupHintMergePlan(input: {
    actor: string;
    isAdmin: boolean;
    currentTeamOwned: boolean;
    matchTeamOwned: boolean;
    currentAddedBy: string | null;
    matchAddedBy: string | null;
}): { viaAdmin: boolean; notifyOwner: string | null; told: string[] } {
    const matchOwner = realOwner(input.matchAddedBy);
    const rescuerMerge = input.currentTeamOwned && (input.matchTeamOwned || !!matchOwner);
    const notifyOwner = rescuerMerge && !input.matchTeamOwned ? matchOwner : null;
    const viaAdmin = input.isAdmin && !rescuerMerge;
    const norm = (e: string) => e.trim().toLowerCase();
    const told = viaAdmin
        ? mergeOwnersToTell(input.matchAddedBy, input.currentAddedBy, input.actor)
        : notifyOwner && norm(notifyOwner) !== norm(input.actor) ? [norm(notifyOwner)] : [];
    return { viaAdmin, notifyOwner, told };
}
