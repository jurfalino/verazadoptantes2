/**
 * Server side of the record edit rule (src/domain/recordEditAccess.ts). Server-only.
 *
 * - canEditRecordAs: the gate saveAdoption / deleteAdoption enforce.
 * - attachRecordViewerAccess: what getAdoptions hands the profile — `canEdit`
 *   per record from the SAME rule (so the pencil never offers a save that fails).
 */
import { canEditRecord } from '@/domain/recordEditAccess';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** May `viewer` edit / delete a record written by `addedBy`? The record's author, their teammates, admins. */
export async function canEditRecordAs(viewer: string | null | undefined, addedBy: string | null | undefined): Promise<boolean> {
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    const viewerIsAuthorOrTeammate = await isOwnerOrOrgMate(viewer, addedBy);
    if (canEditRecord({ viewer, viewerIsAdmin: false, viewerIsAuthorOrTeammate })) return true;
    const { isAdminAsync } = await import('@/config/admins');
    return canEditRecord({ viewer, viewerIsAdmin: await isAdminAsync(viewer ?? ''), viewerIsAuthorOrTeammate });
}

export async function attachRecordViewerAccess<T extends { addedBy?: string | null }>(
    _db: Db,
    rows: T[],
    ctx: { viewer: string; viewerIsAdmin: boolean; adopterId: string },
): Promise<Array<T & { canEdit: boolean }>> {
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    // One team check per distinct author (a profile has few), never per row.
    const authors = [...new Set(rows.map(r => r.addedBy ?? ''))];
    const sameTeam = new Map(await Promise.all(authors.map(async a => [a, await isOwnerOrOrgMate(ctx.viewer, a)] as const)));
    const withAccess = rows.map(r => ({
        ...r,
        canEdit: canEditRecord({ viewer: ctx.viewer, viewerIsAdmin: ctx.viewerIsAdmin, viewerIsAuthorOrTeammate: sameTeam.get(r.addedBy ?? '') === true }),
    }));
    return withAccess;
}
