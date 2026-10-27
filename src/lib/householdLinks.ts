/**
 * The pre-release household links (spec 2026-10-25 pendientes D, D44–D51) —
 * what is left of them after households as profiles (2026-10-26). NOT a
 * 'use server' module.
 *
 * Nothing shows or edits households through `household_links` or the old
 * `household_members` JSON any more (src/lib/households.ts is the only model).
 * This file keeps only what undoing a merge RECORDED BEFORE the release needs
 * (src/lib/adopterMerge.ts, old-payload branch): put the moved links and
 * corrections back (`restoreHouseholdLinks`) and re-write a link the
 * survivor lost meanwhile (`relinkRestoredHost`, which reads the restored
 * host's old JSON). The household conversion (src/lib/householdConversion.ts)
 * then turns those into memberships.
 */
import { and, eq } from 'drizzle-orm';
import { adopters, householdLinkCorrections, householdLinks } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Deterministic per host member — the same id the 0094 backfill writes. */
export const householdLinkId = (hostId: string, memberId: string) => `hl-${hostId}-${memberId}`;

/**
 * Record that `memberId` on `hostId` is the person with profile `linkedId`.
 * Idempotent per host member (unique host+member). Returns true when a row
 * was written now.
 */
export async function recordHouseholdLink(
    db: Db,
    input: { hostId: string; memberId: string; linkedId: string; actor: string },
): Promise<boolean> {
    if (!input.linkedId || input.linkedId === input.hostId) return false;
    const rows = await db.insert(householdLinks).values({
        id: householdLinkId(input.hostId, input.memberId),
        hostAdopterId: input.hostId,
        linkedAdopterId: input.linkedId,
        memberId: input.memberId,
        createdBy: input.actor,
        createdAt: new Date(),
    }).onConflictDoNothing().returning({ id: householdLinks.id });
    return rows.length > 0;
}

// ───────────────────── Old merges' undo (D51) ─────────────────────

/** A link's place before a merge moved it — what undo puts back. */
export type MovedHouseholdLink = { id: string; hostAdopterId: string; linkedAdopterId: string; memberId: string };
/** A correction's pair before a merge moved it — what undo puts back. */
export type MovedHouseholdLinkCorrection = { id: string; hostAdopterId: string; linkedAdopterId: string };
/** Everything a merge moved in the household-link tables (the undo payload's part). */
export type MovedHouseholdLinks = { links: MovedHouseholdLink[]; corrections: MovedHouseholdLinkCorrection[] };

/**
 * Undo of a merge (or a merge that failed after moving them): each link and
 * correction it moved goes back to where it was. A row removed since stays
 * removed; a correction made after the merge (not in `moved`) stays where it is.
 */
export async function restoreHouseholdLinks(db: Db, moved: Partial<MovedHouseholdLinks>): Promise<void> {
    for (const l of moved.links ?? []) {
        await db.update(householdLinks)
            .set({ hostAdopterId: l.hostAdopterId, linkedAdopterId: l.linkedAdopterId, memberId: l.memberId })
            .where(eq(householdLinks.id, l.id));
    }
    for (const c of moved.corrections ?? []) {
        await db.update(householdLinkCorrections)
            .set({ hostAdopterId: c.hostAdopterId, linkedAdopterId: c.linkedAdopterId })
            .where(eq(householdLinkCorrections.id, c.id));
    }
}

/**
 * Undo of a merge, after `restoreHouseholdLinks`: each link the merge moved
 * OFF the restored host (`hostAdopterId === hostId` in `moved`) whose row is
 * gone now — removed on the survivor since, by «No convive» or by the
 * survivor's team removing the landed member — is written again, when the
 * restored host still lists that member with a profile and the linked
 * profile (followed through merges) is live. Without it the host lists the
 * person but nobody sees «Convive con», nor can say «No convive».
 * A correction made on the survivor stays there. Only links this merge moved
 * are considered: a profileId planted in the JSON without a link stays
 * unlinked. Idempotent (deterministic id, insert-or-ignore); no notice — it
 * restores what was there. Throws on a DB failure (the undo is retryable).
 */
export async function relinkRestoredHost(
    db: Db,
    hostId: string,
    moved: ReadonlyArray<MovedHouseholdLink>,
    ctx: Record<string, unknown>,
): Promise<number> {
    const fromHost = moved.filter(l => l.hostAdopterId === hostId);
    if (fromHost.length === 0) return 0;
    const host = await db.select({ addedBy: adopters.addedBy, householdMembers: adopters.householdMembers, deletedAt: adopters.deletedAt })
        .from(adopters).where(eq(adopters.id, hostId)).get();
    if (!host || host.deletedAt) return 0;
    const members = deserializeHouseholdMembers(host.householdMembers);
    let relinked = 0;
    for (const l of fromHost) {
        const c = { ...ctx, hostId, linkId: l.id, memberId: l.memberId };
        const still = await db.select({ id: householdLinks.id }).from(householdLinks)
            .where(and(eq(householdLinks.hostAdopterId, hostId), eq(householdLinks.memberId, l.memberId))).limit(1).get();
        if (still) continue;
        const member = members.find(m => m.id === l.memberId);
        if (!member?.profileId) {
            logger.info('householdLinks: undo — member no longer on the restored host, not relinked', c);
            continue;
        }
        const linked = await liveProfile(db, member.profileId, c);
        if (!linked || linked.id === hostId) {
            logger.info('householdLinks: undo — linked profile not live, not relinked', c);
            continue;
        }
        // «según …» names whoever added the member, as the 0094 backfill does — never the admin undoing.
        const created = await recordHouseholdLink(db, { hostId, memberId: l.memberId, linkedId: linked.id, actor: member.addedBy || host.addedBy || String(ctx.actor ?? '') });
        if (created) relinked++;
    }
    if (relinked) logger.info('householdLinks: undo — links written again on the restored host', { ...ctx, hostId, relinked });
    return relinked;
}

// ─────────────────────────── Read path ───────────────────────────

type ProfileRow = {
    id: string; name: string; addedBy: string | null; contactEntries: string | null; contactInfo: string | null;
    isPublic: number | boolean | null; householdMembers: string | null; deletedAt: Date | null;
};

const PROFILE_COLS = {
    id: adopters.id, name: adopters.name, addedBy: adopters.addedBy, contactEntries: adopters.contactEntries,
    contactInfo: adopters.contactInfo, isPublic: adopters.isPublic, householdMembers: adopters.householdMembers, deletedAt: adopters.deletedAt,
};

async function loadProfile(db: Db, id: string): Promise<ProfileRow | null> {
    return (await db.select(PROFILE_COLS).from(adopters).where(eq(adopters.id, id)).get() as ProfileRow | undefined) ?? null;
}

/** The live profile behind an id: itself, or the survivor it was merged into (D35 links follow merges). */
async function liveProfile(db: Db, id: string, ctx: Record<string, unknown>): Promise<ProfileRow | null> {
    const row = await loadProfile(db, id);
    if (row && !row.deletedAt) return row;
    if (!row) return null;
    try {
        const { resolveMergedAdopterId } = await import('@/lib/mergedAdopterRedirect');
        const survivor = await resolveMergedAdopterId(id);
        if (!survivor || survivor === id) return null;
        const s = await loadProfile(db, survivor);
        return s && !s.deletedAt ? s : null;
    } catch (e) {
        logger.warn('householdLinks: merge redirect lookup failed, link skipped', { ...ctx, profileId: id, error: errMsg(e) });
        return null;
    }
}
