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
import { normalizeIdValue, normalizeSocialHandle } from '@/lib/tokenizer';
import { mergeOwnersToTell, realOwner } from '@/domain/dedupPair';

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

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * True when a stored contact is the identifier typed: phones by their last 8
 * digits (the engine's phone-suffix rule, as the «¿Es este perfil?» card marks
 * them), emails as written (case-insensitive), social handles and id numbers
 * normalized as the token index normalizes them.
 */
export function entryMatchesTyped(entry: { type: string; value: string }, type: DupHintType, typed: string): boolean {
    if (entry.type !== type || typeof entry.value !== 'string') return false;
    const v = typed.trim();
    if (!v) return false;
    switch (type) {
        case 'phone': {
            const a = digits(entry.value);
            const b = digits(v);
            return a.length >= 6 && b.length >= 6 && a.slice(-8) === b.slice(-8);
        }
        case 'email':
            return entry.value.trim().toLowerCase() === v.toLowerCase();
        case 'social': {
            const a = normalizeSocialHandle(entry.value);
            return !!a && a === normalizeSocialHandle(v);
        }
        case 'id': {
            const a = normalizeIdValue(entry.value);
            return a.length > 0 && a === normalizeIdValue(v);
        }
    }
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
 *   them separate (case 4): only the admins can be asked.
 * - 'pending': an open duplicate flag or a pending merge request already
 *   covers the pair (case 5): no second flag, no second notice.
 */
export type DupHintAction = 'continue' | 'flag' | 'review_admins' | 'pending';

export interface DupHintFacts {
    isAdmin: boolean;
    /** The viewer or a teammate loaded the profile being edited (isOwnerOrOrgMate). */
    currentTeamOwned: boolean;
    /** The match has a real owner (realOwner(addedBy)). */
    matchHasOwner: boolean;
    /** PairVerdict.declinedForTeam. */
    declinedForTeam: boolean;
    /** PairVerdict.adminRuledSeparate. */
    adminRuledSeparate: boolean;
    /** An open duplicate flag (either direction) or a pending merge request on the pair. */
    pending: boolean;
}

/**
 * Priority 4 (said no) > 5 (pending) > 3 (ownerless) > 1 / 2. Admins choose
 * freely (D24): always 'continue' — a pending flag or request is only said
 * («Ya está marcado para revisar.»), and their merge closes it.
 */
export function decideDupHintAction(f: DupHintFacts): DupHintAction {
    if (f.isAdmin) return 'continue';
    if (f.declinedForTeam || f.adminRuledSeparate) return 'review_admins';
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
