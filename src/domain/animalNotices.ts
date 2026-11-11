/**
 * Who hears about forms, contracts and check-ups (the «Avisos» rows
 * «Llega un formulario…», «Un adoptante firma un contrato», «Toca un control
 * de seguimiento»; Jon 2026-11-11). The team copies are bell only: the email
 * goes to whoever added the animal, or to the form link's owner when the form
 * is for no animal of the team. That person's row switch still applies.
 *
 * Pure; no `@/` imports (the follow-up cron Worker bundles src/domain/*).
 */

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** The one person a form or contract notice may be emailed to. */
export function animalNoticeEmailTo(c: { linkOwner: string; animalOwner: string | null; animalInTeam: boolean }): string {
    return c.animalInTeam && c.animalOwner ? c.animalOwner : c.linkOwner;
}

export type TeamCopyDelivery = 'skip' | 'bell' | 'bell_and_email';

/**
 * A team copy (notifyOrgMembers) of a form or contract for `recipient`:
 * - the copy to `emailTo` may be emailed, every other one is bell only;
 * - with «Mis animales», no copy at all (not even the bell) unless the person
 *   added the animal (`animalOwner`; null = a form for no animal of the team).
 */
export function teamCopyDelivery(c: { recipient: string; emailTo: string | null; animalOwner: string | null; scope: AnimalsScope }): TeamCopyDelivery {
    const own = !!c.animalOwner && norm(c.recipient) === norm(c.animalOwner);
    if (c.scope === 'mine' && !own) return 'skip';
    return c.emailTo && norm(c.recipient) === norm(c.emailTo) ? 'bell_and_email' : 'bell';
}

/**
 * A due check-up for `recipient` (the cron Worker): the owner gets the bell and,
 * with «Toca un control de seguimiento» on (followup_settings.emailReminders),
 * the digest email; a teammate gets the bell only, or nothing with «Mis animales».
 */
export function followupDelivery(c: { recipient: string; owner: string; scope: AnimalsScope; emailReminders: boolean }): TeamCopyDelivery {
    const own = norm(c.recipient) === norm(c.owner);
    if (!own) return c.scope === 'mine' ? 'skip' : 'bell';
    return c.emailReminders ? 'bell_and_email' : 'bell';
}

/**
 * «Formularios, contratos y controles de:» — 'team' (default: «Los animales de
 * todo el equipo») or 'mine' («Mis animales»). Stored in
 * user_profiles.animals_scope; replaces the check-ups-only «Recordarme solo los
 * animales que cargué yo» (migration 0107 copied it over).
 */
export type AnimalsScope = 'mine' | 'team';
export const ANIMALS_SCOPES: readonly AnimalsScope[] = ['mine', 'team'];

export function parseAnimalsScope(raw: string | null | undefined): AnimalsScope {
    return raw === 'mine' ? 'mine' : 'team';
}
