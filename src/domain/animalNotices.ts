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

/**
 * Who gets which copy of a form that arrives on `linkOwner`'s link
 * (src/app/api/form/[userId]/submit/route.ts). Emails compare case- and
 * space-insensitively throughout.
 * - `ownerInTeam`: whether `animalOwner` shares a group with the link owner;
 *   null = the lookup failed.
 * - The link owner always gets their own copy; it is bell only when a teammate
 *   added the animal (the email is that teammate's).
 * - `animalOwnerCopy`: that teammate's own copy, created by the route itself
 *   (row-gated email, «Mis animales» doesn't apply: it is their animal), so it
 *   never depends on the background team fan-out. `excludeFromTeam` keeps the
 *   fan-out from sending a second copy.
 * - A failed lookup falls back to emailing the link owner (the behaviour before
 *   «Avisos»), with no direct copy to an owner we could not place; the fan-out
 *   still lets that owner's animal through «Mis animales» if it reaches them.
 * - An animal outside the team (a forged `?animal=`) counts as no animal.
 */
export type FormNoticeRecipients = {
    linkOwnerBellOnly: boolean;
    animalOwnerCopy: string | null;
    excludeFromTeam: string[];
    /** For notifyOrgMembers({ teamCopy }). */
    teamCopy: { emailTo: string | null; animalOwner: string | null };
};

export function formNoticeRecipients(c: { linkOwner: string; animalOwner: string | null; ownerInTeam: boolean | null }): FormNoticeRecipients {
    const owner = norm(c.animalOwner);
    const linkOwner = c.linkOwner.trim();
    if (owner && owner === norm(linkOwner)) {
        return { linkOwnerBellOnly: false, animalOwnerCopy: null, excludeFromTeam: [], teamCopy: { emailTo: linkOwner, animalOwner: linkOwner } };
    }
    if (owner && c.ownerInTeam === true) {
        return { linkOwnerBellOnly: true, animalOwnerCopy: (c.animalOwner ?? '').trim(), excludeFromTeam: [owner], teamCopy: { emailTo: null, animalOwner: owner } };
    }
    if (owner && c.ownerInTeam === null) {
        return { linkOwnerBellOnly: false, animalOwnerCopy: null, excludeFromTeam: [], teamCopy: { emailTo: linkOwner, animalOwner: owner } };
    }
    return { linkOwnerBellOnly: false, animalOwnerCopy: null, excludeFromTeam: [], teamCopy: { emailTo: linkOwner, animalOwner: null } };
}

/**
 * The animal owner a form's notices are planned for: the owner of the APPLICATION's animal. A form for an
 * animal that is already adopted (or gone) became a general application — the link owner's to evaluate in
 * «Mis adoptantes» — so it has no animal owner and the link owner is emailed (review M9).
 * `applicationAnimalId` is submissionApplication(...).animalId.
 */
export function formNoticeAnimalOwner(applicationAnimalId: string | null, selectedAnimalOwner: string | null): string | null {
    return applicationAnimalId ? selectedAnimalOwner : null;
}

/**
 * The plan once the animal owner's own copy was attempted: if it wasn't saved, fall back to the
 * «team lookup failed» shape — the link owner is emailed and the owner still gets the fan-out's
 * bell copy — so a failed insert can never leave the form without an email.
 */
export function afterOwnerCopy(c: { linkOwner: string; animalOwner: string | null; ownerInTeam: boolean | null }, ownerCopySaved: boolean): FormNoticeRecipients {
    const plan = formNoticeRecipients(c);
    if (!plan.animalOwnerCopy || ownerCopySaved) return plan;
    return formNoticeRecipients({ ...c, ownerInTeam: null });
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
