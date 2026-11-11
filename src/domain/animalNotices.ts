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

export type TeamCopyDelivery = 'bell' | 'bell_and_email';

/** A team copy (notifyOrgMembers) is bell only unless it goes to the person the email is for. */
export function teamCopyDelivery(c: { recipient: string; emailTo: string | null }): TeamCopyDelivery {
    return c.emailTo && norm(c.recipient) === norm(c.emailTo) ? 'bell_and_email' : 'bell';
}
