/**
 * «Reportar inexactitud» on the profile (H4): who sees the open reports and
 * may close them with «Ya lo corregí». Exactly the `inaccuracy_reported`
 * notice's audience (src/lib/inaccuracyReportNotices.ts): whoever added the
 * profile, every member of their organizations, and privileged editors — plus
 * admins and moderators, who are told too. Never anyone else: not the reporter
 * (unless they are on that team), not other rescuers.
 *
 * Privileged editors need no separate check: loadApprovers keeps an editor only
 * when isPrivilegedOnProfile holds, which is owner ∨ org-mate of the owner ∨
 * admin ∨ moderator — all already covered here. A profile with no real owner (an
 * import) tells the admins only, so only admins and moderators see it.
 *
 * Pure: the caller resolves the org-mate and staff facts.
 */
import { realOwner } from './dedupPair';

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export function canSeeInaccuracyReports(input: {
    viewer: string | null | undefined;
    /** The profile's `added_by`. */
    owner: string | null | undefined;
    viewerIsOrgMateOfOwner: boolean;
    viewerIsModeratorOrAdmin: boolean;
}): boolean {
    const viewer = norm(input.viewer);
    if (!viewer.includes('@')) return false;
    if (input.viewerIsModeratorOrAdmin) return true;
    const owner = realOwner(input.owner);
    if (!owner) return false;
    return viewer === norm(owner) || input.viewerIsOrgMateOfOwner;
}
