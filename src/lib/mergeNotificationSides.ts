/**
 * The two sides of a merge as notification-template params (D31): each
 * profile's name, its owner's display name (never an address; none for
 * ownerless profiles) and its creation date, so a same-name pair reads
 * «Julieta Paz (de María, 22 oct '26)» vs «Julieta Paz (de Jon, 3 sept '26)».
 * Reads soft-deleted rows too: the absorbed side is already merged away when
 * most notices go out. NOT a 'use server' module.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { realOwner } from '@/domain/dedupPair';
import type { MergeSides } from '@/domain/notificationTemplates';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

type Side = { name: string | null; addedBy: string | null; createdAt: Date | null } | undefined;

/**
 * Best-effort: when the profile lookup fails the notice still goes out, with
 * the names the caller already had (`known`) and no owner/date; when only the
 * owner-name lookup fails, owners read as their email handle. Both logged.
 */
export async function mergeSideParams(
    db: Db,
    ids: { survivorId: string; absorbedId: string },
    known: { survivorName?: string | null; absorbedName?: string | null } = {},
): Promise<MergeSides> {
    const ctx = { primaryId: ids.survivorId, secondaryId: ids.absorbedId };
    let survivor: Side, absorbed: Side;
    try {
        const read = (id: string) => db.select({ name: adopters.name, addedBy: adopters.addedBy, createdAt: adopters.createdAt })
            .from(adopters).where(eq(adopters.id, id)).get() as Promise<Side>;
        [survivor, absorbed] = await Promise.all([read(ids.survivorId), read(ids.absorbedId)]);
    } catch (e) {
        logger.warn('mergeSideParams: profile lookup failed, notice without owners/dates', { ...ctx, error: e instanceof Error ? e.message : String(e) });
        return { survivorName: known.survivorName ?? '', absorbedName: known.absorbedName ?? '' };
    }

    const owners = [realOwner(survivor?.addedBy), realOwner(absorbed?.addedBy)].filter((e): e is string => !!e);
    let names = new Map<string, string>();
    if (owners.length) {
        try {
            const { resolveDisplayNames } = await import('@/app/actions/notifications');
            names = await resolveDisplayNames(owners);
        } catch (e) {
            logger.warn('mergeSideParams: owner names not resolved, using handles', { ...ctx, error: e instanceof Error ? e.message : String(e) });
        }
    }
    const side = (row: Side, knownName: string | null | undefined) => {
        const owner = realOwner(row?.addedBy);
        const ownerName = owner ? (names.get(owner.toLowerCase().trim()) ?? owner.split('@')[0]) : '';
        const date = row?.createdAt instanceof Date && !Number.isNaN(row.createdAt.getTime()) ? row.createdAt.toISOString() : '';
        return { name: row?.name ?? knownName ?? '', owner: ownerName, date };
    };
    const s = side(survivor, known.survivorName);
    const a = side(absorbed, known.absorbedName);
    return {
        survivorName: s.name, ...(s.owner ? { survivorOwner: s.owner } : {}), ...(s.date ? { survivorDate: s.date } : {}),
        absorbedName: a.name, ...(a.owner ? { absorbedOwner: a.owner } : {}), ...(a.date ? { absorbedDate: a.date } : {}),
    };
}
