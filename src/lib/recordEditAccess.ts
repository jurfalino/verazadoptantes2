/**
 * Server side of the record edit rule (src/domain/recordEditAccess.ts) and of
 * the delivery-address mask on a person's history. Server-only.
 *
 * - canEditRecordAs: the gate saveAdoption / deleteAdoption enforce.
 * - attachRecordViewerAccess: what getAdoptions hands the profile — `canEdit`
 *   per record from the SAME rule (so the pencil never offers a save that
 *   fails), and each record's verified delivery address masked like the
 *   profile's other contact data for viewers outside the team.
 */
import { adopters } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { canEditRecord } from '@/domain/recordEditAccess';
import { maskContactEntries, NO_ACCESS_VISIBILITY, type Visibility, type MaskContactOptions } from '@/lib/piiAccess';

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

/** The profile's contact-data verdict for this viewer, exactly as getAdopter resolves it. Fails closed (masked). */
async function profileContactVerdict(db: Db, adopterId: string, viewer: string): Promise<{ fullyVisible: boolean; visibility: Visibility; maskOpts: MaskContactOptions }> {
    const closed = { fullyVisible: false, visibility: NO_ACCESS_VISIBILITY, maskOpts: {} };
    try {
        const { isPiiGatingEnabled, resolveAdopterVisibility, buildMaskOptions } = await import('@/lib/piiAccessServer');
        if (!(await isPiiGatingEnabled())) return { ...closed, fullyVisible: true };
        const adopter = await db.select({ id: adopters.id, addedBy: adopters.addedBy, isPublic: adopters.isPublic })
            .from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return closed;
        const [visibility, maskOpts] = await Promise.all([
            resolveAdopterVisibility(viewer, { id: adopter.id, addedBy: adopter.addedBy }),
            buildMaskOptions(adopter),
        ]);
        return { fullyVisible: visibility.nothingMasked || !!maskOpts.adopterIsPublic, visibility, maskOpts };
    } catch (e) {
        logger.warn('getAdoptions: contact verdict failed — delivery addresses masked', {
            adopterId, viewer, error: e instanceof Error ? e.message : String(e),
        });
        return closed;
    }
}

export async function attachRecordViewerAccess<T extends { addedBy?: string | null; verifiedAddress?: string | null }>(
    db: Db,
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

    // P1: a delivery address is contact data. Records the viewer's team wrote
    // keep it (they entered it, and their edit form must load the real value);
    // on the rest it follows the profile's contact mask.
    const needsVerdict = withAccess.some(r => !r.canEdit && r.verifiedAddress && r.verifiedAddress.trim() !== '');
    if (!needsVerdict) return withAccess;
    const verdict = await profileContactVerdict(db, ctx.adopterId, ctx.viewer);
    if (verdict.fullyVisible) return withAccess;
    return withAccess.map(r => {
        if (r.canEdit || !r.verifiedAddress || r.verifiedAddress.trim() === '') return r;
        const [masked] = maskContactEntries([{ type: 'address', value: r.verifiedAddress }], verdict.visibility, verdict.maskOpts).entries;
        return { ...r, verifiedAddress: masked?.value ?? null };
    });
}
