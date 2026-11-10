/**
 * «Avisame de cambios hechos por:» under «Cambios en tus perfiles» (/settings,
 * Jon 2026-11-08). Whose changes to your profiles create a notice — in the bell
 * AND by email (the bell shows every notice; this is the one way to get fewer):
 *
 * - 'outside' (default, also when nothing is stored): «Otros rescatistas».
 *   A teammate's change creates no notice; it stays in the profile's history.
 * - 'team': «Otros rescatistas y mi equipo».
 *
 * Your own change never notifies you. Pure — callers resolve whether the actor
 * is the recipient's teammate (src/lib/teamChangeAudience.ts).
 */
export type ProfileChangesFrom = 'outside' | 'team';

export const PROFILE_CHANGES_FROM: readonly ProfileChangesFrom[] = ['outside', 'team'];

export function parseProfileChangesFrom(raw: string | null | undefined): ProfileChangesFrom {
    return raw === 'team' ? 'team' : 'outside';
}

const norm = (e: string) => e.trim().toLowerCase();

export function hearsChange(c: { recipient: string; actor: string; actorIsTeammate: boolean; from: ProfileChangesFrom }): boolean {
    if (norm(c.recipient) === norm(c.actor)) return false;
    if (!c.actorIsTeammate) return true;
    return c.from === 'team';
}
