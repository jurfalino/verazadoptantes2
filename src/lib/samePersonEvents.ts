import { zarazTrack } from '@/lib/zaraz';

/** Where a «same person?» answer was given (spec 2026-11-05, CX addition 3). */
export type SamePersonSurface = 'pendientes' | 'form_results' | 'contract_results' | 'household' | 'profile_bar' | 'dup_hint' | 'import' | 'new_profile';

/**
 * One event per answer, so we can see which screens people answer on, which
 * they skip, and whether open questions shrink. `own`: the viewer loaded the
 * other profile (their own data) vs another team's. Never names, ids or
 * contacts. Fire after a successful answer only — never from a catch.
 */
export function trackSamePersonAnswer(surface: SamePersonSurface, answer: 'same' | 'different' | 'opened', own: boolean): void {
    zarazTrack('same_person_answered', { surface, answer, own });
}
