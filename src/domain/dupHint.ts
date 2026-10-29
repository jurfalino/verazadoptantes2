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
