/**
 * Linked convivientes (spec 2026-10-25 pendientes D, addendum D44–D46, D48,
 * D51) — server side. NOT a 'use server' module: every export here is called
 * by server code only (addHouseholdMember / removeHouseholdMember, the profile
 * page, reportNotLivingTogether, mergeAdopters / unmergeAdopters), so none of
 * it is a browser-callable endpoint.
 *
 * - `recordHouseholdLink` / `deleteHouseholdLink`: the `household_links` row
 *   kept beside a household member that carries a `profileId`.
 * - `notifyHouseholdLinked`: the linked profile's owner team hears about it
 *   (D45); a re-link after a «No convive» also tells the admins (D48).
 * - `loadLinkForCorrection` / `applyNotLivingTogether`: «No convive» (D48) —
 *   one member removed from the host, the link removed, the correction
 *   remembered, history on both profiles, the host's owner team told.
 * - `moveHouseholdLinksOnMerge` / `restoreHouseholdLinks` /
 *   `notifyDisputesAfterMerge`: links and corrections follow a merge and
 *   come back on undo (D51); a merge that carries a corrected person back is
 *   a dispute (D48).
 * - `getLinkedSummaries`: the live summaries for a profile page (D46) — the
 *   host's linked members and the linked profile's «Convive con» rows — with
 *   each profile's contacts masked exactly as `getAdopter` would mask them
 *   for this viewer (same resolver, same flags), never more.
 *
 * Decisions live in src/domain/householdLinks.ts. D1: no `IN (array)` —
 * one bounded query set per profile, fanned out with Promise.all.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { adopterHistory, adopters, householdLinkCorrections, householdLinks } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { deserializeHouseholdMembers, serializeHouseholdMembers, type HouseholdMember } from '@/lib/householdMembers';
import { casAdopterLists } from '@/lib/adopterListCas';
import { runBatch } from '@/lib/dbBatch';
import { maskContactEntries, NO_ACCESS_VISIBILITY, type Visibility } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, maskOptionsFor, resolveAdoptersVisibility } from '@/lib/piiAccessServer';
import { notificationContent } from '@/domain/notificationTemplates';
import { RECORD_TYPES } from '@/domain/constants';
import { realOwner } from '@/domain/dedupPair';
import {
    EMPTY_LINKED_SUMMARIES,
    MAX_LINKED_SUMMARIES,
    MAX_LINK_ROWS,
    canReportNotLivingTogether,
    countOpenAlerts,
    isLiveLink,
    linkNoticeRecipients,
    personLabel,
    summaryContacts,
    type LinkedSummaries,
    type LinkedSummary,
    type LivesWithRow,
} from '@/domain/householdLinks';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LinkRow = typeof householdLinks.$inferSelect;
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

/** The host member is gone: so is its link (the linked profile stops showing «Convive con»). */
export async function deleteHouseholdLink(db: Db, hostId: string, memberId: string): Promise<void> {
    await db.delete(householdLinks).where(and(eq(householdLinks.hostAdopterId, hostId), eq(householdLinks.memberId, memberId)));
}

/** Display names keyed by the email as stored; a lookup failure falls back to handles. */
async function namesFor(emails: Array<string | null | undefined>, ctx: Record<string, unknown>): Promise<Record<string, string>> {
    const real = [...new Set(emails.map(e => realOwner(e ?? null)).filter((e): e is string => !!e))];
    if (real.length === 0) return {};
    try {
        const { resolveUserNames } = await import('@/app/actions/userNames');
        return await resolveUserNames(real);
    } catch (e) {
        logger.warn('householdLinks: name lookup failed, showing handles', { ...ctx, error: errMsg(e) });
        return {};
    }
}

/**
 * D45: tell the linked profile's owner and team (never the actor) that their
 * profile now appears as someone's conviviente. Runs after the response;
 * never throws.
 */
export async function notifyHouseholdLinked(input: { hostId: string; hostName: string; linkedId: string; actor: string }): Promise<void> {
    const ctx = { hostId: input.hostId, linkedId: input.linkedId, actor: input.actor };
    await runAfterResponse('household.linked', async () => {
        const db = await getDb();
        if (!db) return;
        const linked = await db.select({ name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, input.linkedId)).get();
        if (!linked) return;
        const owner = realOwner(linked.addedBy);
        if (!owner) {
            logger.info('householdLinks: linked profile has no real owner, nobody to notify', ctx);
            return;
        }
        const { getOrgMemberEmailsFor } = await import('@/lib/orgMembership');
        const team = await getOrgMemberEmailsFor(owner);
        const recipients = linkNoticeRecipients(owner, team, input.actor);
        if (recipients.length === 0) {
            logger.info('householdLinks: link notice — no recipients', ctx);
            return;
        }
        const { createNotification } = await import('@/app/actions/notifications');
        const actorName = personLabel(input.actor, await namesFor([input.actor], ctx)) ?? '';
        const content = notificationContent({
            key: 'household_linked',
            params: { actorName, hostName: input.hostName, linkedName: linked.name },
        });
        await Promise.all(recipients.map(userId => createNotification({
            userId,
            type: 'household_linked',
            ...content,
            url: `/adopter/${input.linkedId}`,
            icon: '🏠',
            metadata: { hostId: input.hostId, linkedId: input.linkedId },
        })));
        logger.info('householdLinks: link notice sent', { ...ctx, recipients: recipients.length });
    }, ctx);
    await notifyIfDisputedRelink({ hostId: input.hostId, linkedId: input.linkedId, actor: input.actor }, ctx);
}

/**
 * D48: the same person is back on the same host after its linked team said
 * «No convive» — re-added by hand, or carried there by a merge (D51) — and
 * the two sides disagree, so the admins decide. Only when the pair has both
 * a link and a correction. Runs after the response; never throws.
 */
async function notifyIfDisputedRelink(input: { hostId: string; linkedId: string; actor: string; viaMerge?: boolean }, ctx: Record<string, unknown>): Promise<void> {
    await runAfterResponse('household.link_disputed', async () => {
        const db = await getDb();
        if (!db) return;
        const [corrected, linkRow] = await Promise.all([
            db.select({ id: householdLinkCorrections.id }).from(householdLinkCorrections)
                .where(and(eq(householdLinkCorrections.hostAdopterId, input.hostId), eq(householdLinkCorrections.linkedAdopterId, input.linkedId))).limit(1).get(),
            db.select({ id: householdLinks.id }).from(householdLinks)
                .where(and(eq(householdLinks.hostAdopterId, input.hostId), eq(householdLinks.linkedAdopterId, input.linkedId))).limit(1).get(),
        ]);
        if (!corrected || !linkRow) return;
        const [host, linked] = await Promise.all([input.hostId, input.linkedId].map(id =>
            db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, id)).get()));
        const { notifyAdmins } = await import('@/app/actions/notifications');
        const actorName = personLabel(input.actor, await namesFor([input.actor], ctx)) ?? '';
        await notifyAdmins({
            actorEmail: input.actor,
            type: 'household_link_disputed',
            ...notificationContent({
                key: 'household_link_disputed',
                params: { actorName, hostName: host?.name, linkedName: linked?.name, ...(input.viaMerge ? { viaMerge: '1' } : {}) },
            }),
            url: `/adopter/${input.hostId}`,
            icon: '🏠',
            metadata: { hostId: input.hostId, linkedId: input.linkedId, correctionId: corrected.id, linkId: linkRow.id },
        });
        logger.info('householdLinks: link back after a correction, admins told', { ...ctx, viaMerge: !!input.viaMerge });
    }, ctx);
}

// ─────────────────────── «No convive» (D48) ───────────────────────

type HostRow = typeof adopters.$inferSelect;

/**
 * The ids that count as the linked profile for this host member: the link's
 * own, plus the member's `profileId` when a merge folded that profile into it
 * (D51 — the link moved to the survivor, the host's JSON was left as is).
 * Empty when the member is gone or points at someone else.
 */
async function memberLinkedIds(
    link: { id: string; memberId: string; linkedAdopterId: string },
    members: ReadonlyArray<HouseholdMember>,
    ctx: Record<string, unknown>,
): Promise<Set<string>> {
    const m = members.find(x => x.id === link.memberId);
    if (!m?.profileId) return new Set();
    if (m.profileId === link.linkedAdopterId) return new Set([link.linkedAdopterId]);
    try {
        const { resolveMergedAdopterId } = await import('@/lib/mergedAdopterRedirect');
        return (await resolveMergedAdopterId(m.profileId)) === link.linkedAdopterId ? new Set([link.linkedAdopterId, m.profileId]) : new Set();
    } catch (e) {
        logger.warn('householdLinks: merge redirect lookup failed, link treated as stale', { ...ctx, linkId: link.id, error: errMsg(e) });
        return new Set();
    }
}

/** isLiveLink, following a merged linked profile (D51). */
async function isLiveLinkFollowingMerges(link: LinkRow, members: ReadonlyArray<HouseholdMember>, ctx: Record<string, unknown>): Promise<boolean> {
    if (isLiveLink(link, members)) return true;
    const ids = await memberLinkedIds(link, members, ctx);
    return ids.size > 0 && isLiveLink(link, members, ids);
}

export type LinkCorrectionTarget = { link: LinkRow; host: HostRow; linked: ProfileRow; linkedIds: Set<string> };

/**
 * What «No convive» acts on: the link, its live host and the live linked
 * profile (followed through a merge). Null when any is gone or the host no
 * longer lists that person — nothing to correct.
 */
export async function loadLinkForCorrection(db: Db, linkId: string): Promise<LinkCorrectionTarget | null> {
    const ctx = { linkId };
    const link = await db.select().from(householdLinks).where(eq(householdLinks.id, linkId)).get() as LinkRow | undefined;
    if (!link) return null;
    const [host, linked] = await Promise.all([
        db.select().from(adopters).where(eq(adopters.id, link.hostAdopterId)).get() as Promise<HostRow | undefined>,
        liveProfile(db, link.linkedAdopterId, ctx),
    ]);
    if (!host || host.deletedAt || !linked) return null;
    const linkedIds = await memberLinkedIds(link, deserializeHouseholdMembers(host.householdMembers), ctx);
    if (linkedIds.size === 0) return null;
    return { link, host, linked, linkedIds };
}

/**
 * «No convive» (D48), after the caller checked the actor may: removes THAT
 * member from the host's household (compare-and-swap; nothing else on the
 * host changes), then in ONE batch deletes the link, records the correction
 * (with the removed member's JSON, so an admin can put it back) and writes
 * history on both profiles; then tells the host's owner team.
 * `removed: false` when the member was already gone (someone got there
 * first): nothing written, nobody told. A failed batch after the member is
 * removed is logged as one error — the fact is corrected; a retry would find
 * nothing to remove.
 */
export async function applyNotLivingTogether(
    db: Db,
    target: LinkCorrectionTarget,
    actor: string,
): Promise<{ removed: boolean; busyErrorId?: string }> {
    const { link, host, linked, linkedIds } = target;
    const ctx = { linkId: link.id, hostId: host.id, linkedId: linked.id, memberId: link.memberId, actor };
    const isThePerson = (m: HouseholdMember) => m.id === link.memberId && !!m.profileId && linkedIds.has(m.profileId);
    const out = await casAdopterLists<HouseholdMember | null>(db, host.id, (row) => {
        const members = deserializeHouseholdMembers(row.householdMembers);
        const gone = members.find(isThePerson);
        return gone
            ? { write: { householdMembers: serializeHouseholdMembers(members.filter(m => !isThePerson(m))) }, result: gone }
            : { result: null };
    }, { op: 'applyNotLivingTogether', ...ctx });
    if (out.status === 'busy') return { removed: false, busyErrorId: out.errorId };
    if (out.status === 'missing' || !out.result) {
        logger.info('applyNotLivingTogether: member already gone, nothing corrected', ctx);
        return { removed: false };
    }
    const removedMember = out.result;
    const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
    await tokenizeAdopter(host.id).catch((e: unknown) => { logger.error('applyNotLivingTogether: host tokenize failed', e, ctx); });

    const now = new Date();
    try {
        await runBatch(db, [
            db.delete(householdLinks).where(eq(householdLinks.id, link.id)),
            db.insert(householdLinkCorrections).values({
                id: crypto.randomUUID(), hostAdopterId: host.id, linkedAdopterId: linked.id, memberId: link.memberId,
                memberSnapshot: JSON.stringify(removedMember), correctedBy: actor, createdAt: now,
            }),
            // The host's row is a member removal (so a stale edit form names who removed it), with the reason.
            db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: host.id, changedBy: actor, kind: 'edit', changedAt: now,
                changes: JSON.stringify({ household_member_removed: { id: link.memberId, reason: 'not_living_together', linkedId: linked.id } }),
            }),
            db.insert(adopterHistory).values({
                id: crypto.randomUUID(), adopterId: linked.id, changedBy: actor, kind: 'edit', changedAt: now,
                changes: JSON.stringify({ household_not_living_together: { hostId: host.id, hostName: host.name } }),
            }),
        ]);
    } catch (e) {
        // The member is already off the host; without these rows the link is
        // inert (its member is gone) but the history and the correction are missing.
        logger.error('applyNotLivingTogether: member removed, but link/correction/history not written', e, ctx);
    }
    logger.info('applyNotLivingTogether: corrected on both profiles', ctx);
    await notifyHostTeam({ hostId: host.id, hostName: host.name, hostOwner: host.addedBy, linkedName: linked.name, actor }, ctx);
    return { removed: true };
}

/** The host's owner and team (never the actor) hear that the other side said «No convive». Never throws. */
async function notifyHostTeam(
    input: { hostId: string; hostName: string; hostOwner: string | null; linkedName: string; actor: string },
    ctx: Record<string, unknown>,
): Promise<void> {
    await runAfterResponse('household.link_removed', async () => {
        const owner = realOwner(input.hostOwner);
        if (!owner) {
            logger.info('applyNotLivingTogether: host has no real owner, nobody to notify', ctx);
            return;
        }
        const { getOrgMemberEmailsFor } = await import('@/lib/orgMembership');
        const recipients = linkNoticeRecipients(owner, await getOrgMemberEmailsFor(owner), input.actor);
        if (recipients.length === 0) {
            logger.info('applyNotLivingTogether: host notice — no recipients', ctx);
            return;
        }
        const { createNotification } = await import('@/app/actions/notifications');
        const actorName = personLabel(input.actor, await namesFor([input.actor], ctx)) ?? '';
        const content = notificationContent({ key: 'household_link_removed', params: { actorName, hostName: input.hostName, linkedName: input.linkedName } });
        await Promise.all(recipients.map(userId => createNotification({
            userId,
            type: 'household_link_removed',
            ...content,
            url: `/adopter/${input.hostId}`,
            icon: '🏠',
            metadata: { hostId: input.hostId, linkId: ctx.linkId },
        })));
        logger.info('applyNotLivingTogether: host notice sent', { ...ctx, recipients: recipients.length });
    }, ctx);
}

// ───────────────────── Links follow merges (D51) ─────────────────────

/** A link's place before a merge moved it — what undo puts back. */
export type MovedHouseholdLink = { id: string; hostAdopterId: string; linkedAdopterId: string; memberId: string };
/** A correction's pair before a merge moved it — what undo puts back. */
export type MovedHouseholdLinkCorrection = { id: string; hostAdopterId: string; linkedAdopterId: string };
/** Everything a merge moved in the household-link tables (the undo payload's part). */
export type MovedHouseholdLinks = { links: MovedHouseholdLink[]; corrections: MovedHouseholdLinkCorrection[] };

/**
 * A merge folded `absorbedId` into `survivorId`: its links and «No convive»
 * corrections move with it.
 * - Host side: the absorbed members landed on the survivor under new ids
 *   (`landedMemberIds`: old id → new id); each link moves to its member's
 *   new id. A member that did not land (a same-name repeat of one of the
 *   survivor's, or past the member cap) keeps its link on the absorbed
 *   profile: inert while merged, live again after undo.
 * - Linked side: links naming the absorbed profile now name the survivor.
 *   The host's member keeps its `profileId` (reads follow the merge).
 * - Corrections: either side naming the absorbed profile now names the
 *   survivor, so a re-add on the survivor still counts as a dispute.
 * Nothing between the two merged profiles moves (it would point at itself).
 * Returns where each moved row was, for the undo payload; `disputedPairs`
 * are the pairs this merge left with both a link and a correction —
 * `notifyDisputesAfterMerge` tells the admins once the merge stands.
 */
export async function moveHouseholdLinksOnMerge(
    db: Db,
    merge: { survivorId: string; absorbedId: string; landedMemberIds: ReadonlyMap<string, string> },
): Promise<MovedHouseholdLinks & { disputedPairs: Array<{ hostId: string; linkedId: string }> }> {
    const { survivorId, absorbedId, landedMemberIds } = merge;
    type CorrectionRow = typeof householdLinkCorrections.$inferSelect;
    const [hosted, linkedTo, correctedHost, correctedLinked] = await Promise.all([
        db.select().from(householdLinks).where(eq(householdLinks.hostAdopterId, absorbedId)).all() as Promise<LinkRow[]>,
        db.select().from(householdLinks).where(eq(householdLinks.linkedAdopterId, absorbedId)).all() as Promise<LinkRow[]>,
        db.select().from(householdLinkCorrections).where(eq(householdLinkCorrections.hostAdopterId, absorbedId)).all() as Promise<CorrectionRow[]>,
        db.select().from(householdLinkCorrections).where(eq(householdLinkCorrections.linkedAdopterId, absorbedId)).all() as Promise<CorrectionRow[]>,
    ]);
    const moved: MovedHouseholdLinks = { links: [], corrections: [] };
    const touched = new Map<string, { hostId: string; linkedId: string }>();
    const touch = (hostId: string, linkedId: string) => touched.set(`${hostId}\u0000${linkedId}`, { hostId, linkedId });
    let left = 0;
    try {
    for (const l of hosted) {
        const memberId = landedMemberIds.get(l.memberId);
        if (l.linkedAdopterId === survivorId || !memberId) { left++; continue; }
        await db.update(householdLinks).set({ hostAdopterId: survivorId, memberId }).where(eq(householdLinks.id, l.id));
        moved.links.push({ id: l.id, hostAdopterId: l.hostAdopterId, linkedAdopterId: l.linkedAdopterId, memberId: l.memberId });
        touch(survivorId, l.linkedAdopterId);
    }
    for (const l of linkedTo) {
        if (l.hostAdopterId === survivorId) { left++; continue; }
        await db.update(householdLinks).set({ linkedAdopterId: survivorId }).where(eq(householdLinks.id, l.id));
        moved.links.push({ id: l.id, hostAdopterId: l.hostAdopterId, linkedAdopterId: l.linkedAdopterId, memberId: l.memberId });
        touch(l.hostAdopterId, survivorId);
    }
    for (const c of correctedHost) {
        if (c.linkedAdopterId === survivorId) continue;
        await db.update(householdLinkCorrections).set({ hostAdopterId: survivorId }).where(eq(householdLinkCorrections.id, c.id));
        moved.corrections.push({ id: c.id, hostAdopterId: c.hostAdopterId, linkedAdopterId: c.linkedAdopterId });
        touch(survivorId, c.linkedAdopterId);
    }
    for (const c of correctedLinked) {
        if (c.hostAdopterId === survivorId) continue;
        await db.update(householdLinkCorrections).set({ linkedAdopterId: survivorId }).where(eq(householdLinkCorrections.id, c.id));
        moved.corrections.push({ id: c.id, hostAdopterId: c.hostAdopterId, linkedAdopterId: c.linkedAdopterId });
        touch(c.hostAdopterId, survivorId);
    }
    } catch (e) {
        // Half-moved: put back what moved, so the failed merge leaves the tables as they were.
        await restoreHouseholdLinks(db, moved).catch((re: unknown) => {
            logger.error('householdLinks: half-moved links not restored after a failed move', re, { survivorId, absorbedId });
        });
        throw e;
    }
    // A pair this merge touched that now has both a link and a correction: the
    // merge carried the person back onto a host whose link was corrected.
    const disputedPairs: Array<{ hostId: string; linkedId: string }> = [];
    for (const p of touched.values()) {
        const both = and(eq(householdLinks.hostAdopterId, p.hostId), eq(householdLinks.linkedAdopterId, p.linkedId));
        const bothC = and(eq(householdLinkCorrections.hostAdopterId, p.hostId), eq(householdLinkCorrections.linkedAdopterId, p.linkedId));
        const [l, c] = await Promise.all([
            db.select({ id: householdLinks.id }).from(householdLinks).where(both).limit(1).get(),
            db.select({ id: householdLinkCorrections.id }).from(householdLinkCorrections).where(bothC).limit(1).get(),
        ]);
        if (l && c) disputedPairs.push(p);
    }
    if (moved.links.length || moved.corrections.length || left) {
        logger.info('householdLinks: links moved with a merge', { survivorId, absorbedId, links: moved.links.length, corrections: moved.corrections.length, left, disputed: disputedPairs.length });
    }
    return { ...moved, disputedPairs };
}

/** After a merge stands: the admins hear about each pair it carried back onto a corrected host (D48). Never throws. */
export async function notifyDisputesAfterMerge(pairs: ReadonlyArray<{ hostId: string; linkedId: string }>, actor: string): Promise<void> {
    for (const p of pairs) await notifyIfDisputedRelink({ ...p, actor, viaMerge: true }, { hostId: p.hostId, linkedId: p.linkedId, actor });
}

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

type Counts = { rating: number | null; openAlerts: number; adoptions: number; records: number };

/**
 * Rating (same source as the profile page: AVG over the adoptions view), open
 * alerts, adoptions and records — ONE query per profile (scalar subqueries,
 * the id bound as a parameter). Flags come back as a JSON array so the open-alert rule stays in
 * src/domain (countOpenAlerts), not in SQL. A failure degrades to an empty
 * summary line and is logged.
 */
async function countsFor(db: Db, id: string, ctx: Record<string, unknown>): Promise<Counts> {
    type Raw = { avg: number | null; adopted: number | null; records: number | null; flags: string | null };
    let raw: Raw | undefined;
    try {
        // `await` whether the driver returns a promise (D1) or a value (better-sqlite3 in dev/tests).
        raw = await db.select({
            avg: sql<number | null>`(SELECT AVG(rating) FROM adoptions WHERE adopter_id = ${id})`,
            adopted: sql<number>`(SELECT COUNT(*) FROM placements WHERE adopter_id = ${id} AND record_type = ${RECORD_TYPES.ADOPTION})`,
            records: sql<number>`(SELECT COUNT(*) FROM adopter_events WHERE adopter_id = ${id})`,
            flags: sql<string | null>`(SELECT json_group_array(json_object('reason', reason, 'targetAdopterId', target_adopter_id, 'details', details)) FROM adopter_flags WHERE adopter_id = ${id})`,
        }).from(adopters).where(eq(adopters.id, id)).get() as Raw | undefined;
    } catch (e) {
        logger.warn('householdLinks: counts D1 fallback hit', { ...ctx, profileId: id, error: errMsg(e) });
        return { rating: null, openAlerts: 0, adoptions: 0, records: 0 };
    }
    let flags: Array<{ reason?: string | null; targetAdopterId?: string | null; details?: string | null }> = [];
    try {
        const parsed: unknown = JSON.parse(raw?.flags || '[]');
        if (Array.isArray(parsed)) flags = parsed;
    } catch (e) {
        logger.warn('householdLinks: unreadable flags, no alerts counted', { ...ctx, profileId: id, error: errMsg(e) });
    }
    const avg = raw?.avg ?? null;
    return {
        rating: avg == null ? null : Number(avg),
        openAlerts: countOpenAlerts(flags.map(f => ({ adopterId: id, ...f }))),
        adoptions: Number(raw?.adopted ?? 0),
        records: Number(raw?.records ?? 0),
    };
}

/** Contacts as this viewer may see them on that profile — the same rule getAdopter applies. */
function viewerContacts(
    p: ProfileRow,
    gatingOn: boolean,
    publicFlag: boolean,
    visibility: Visibility | undefined,
): { contacts: LinkedSummary['contacts']; more: number; canSeeContact: boolean } {
    const parsed = deserializeContactEntries(p.contactEntries);
    const source = parsed.length > 0 ? parsed : parseBlobToContactEntries(p.contactInfo);
    const opts = maskOptionsFor(publicFlag, p);
    const fully = !gatingOn || !!opts.adopterIsPublic || !!visibility?.nothingMasked;
    // No verdict (the resolver failed) masks everything: fail closed.
    const entries = fully ? source : maskContactEntries(source, visibility ?? NO_ACCESS_VISIBILITY, opts).entries;
    const { shown, more } = summaryContacts(entries);
    return { contacts: shown, more, canSeeContact: fully };
}

/**
 * Live summaries for the profile page of `adopterId`, as `viewer` may see them:
 * - `members`: for each of this profile's household members linked to a
 *   profile of their own (and recorded in household_links), that profile's
 *   summary, keyed by member id.
 * - `livesWith`: the «Convive con» rows — hosts that list this profile as a
 *   household member (or a profile merged into it, D51).
 * Bounded (MAX_LINKED_SUMMARIES per side). Never throws: a failure yields
 * empty summaries and is logged.
 */
export async function getLinkedSummaries(viewer: string | null | undefined, adopterId: string): Promise<LinkedSummaries> {
    const ctx = { adopterId, viewer: viewer ?? null };
    try {
        const db = await getDb();
        if (!db) return EMPTY_LINKED_SUMMARIES;
        const self = await loadProfile(db, adopterId);
        if (!self || self.deletedAt) return EMPTY_LINKED_SUMMARIES;

        // Oldest first (stable order); liveness is checked BEFORE the cap, so
        // stale rows can't crowd out live links. MAX_LINK_ROWS bounds the read.
        const [outgoing, incoming] = await Promise.all([
            db.select().from(householdLinks).where(eq(householdLinks.hostAdopterId, adopterId))
                .orderBy(asc(householdLinks.createdAt), asc(householdLinks.id)).limit(MAX_LINK_ROWS).all() as Promise<LinkRow[]>,
            // hidden_at (the withdrawn D47) is not read: a row hidden then is live.
            db.select().from(householdLinks).where(eq(householdLinks.linkedAdopterId, adopterId))
                .orderBy(asc(householdLinks.createdAt), asc(householdLinks.id)).limit(MAX_LINK_ROWS).all() as Promise<LinkRow[]>,
        ]);
        if (outgoing.length === 0 && incoming.length === 0) return EMPTY_LINKED_SUMMARIES;
        if (outgoing.length >= MAX_LINK_ROWS || incoming.length >= MAX_LINK_ROWS) {
            logger.warn('householdLinks: link row cap hit, older-than-cap links not read', { ...ctx, outgoing: outgoing.length, incoming: incoming.length, cap: MAX_LINK_ROWS });
        }

        // Host side: only links whose member is still on this profile and still points there.
        const selfMembers = deserializeHouseholdMembers(self.householdMembers);
        const outgoingLive = await Promise.all(outgoing.map(l => isLiveLinkFollowingMerges(l, selfMembers, { ...ctx, linkId: l.id })));
        const liveOutgoing = outgoing.filter((_, i) => outgoingLive[i]);
        const hostLinks = liveOutgoing.slice(0, MAX_LINKED_SUMMARIES);
        const linkedRows = await Promise.all(hostLinks.map(l => liveProfile(db, l.linkedAdopterId, { ...ctx, linkId: l.id })));

        // Linked side: the host (or the profile it was merged into) must still list
        // this profile. Checked a batch at a time until MAX_LINKED_SUMMARIES are live.
        const seenHosts = new Set<string>();
        const reverseLive: Array<{ link: LinkRow; host: ProfileRow }> = [];
        for (let i = 0; i < incoming.length && reverseLive.length < MAX_LINKED_SUMMARIES; i += MAX_LINKED_SUMMARIES) {
            const batch = incoming.slice(i, i + MAX_LINKED_SUMMARIES);
            const hostRows = await Promise.all(batch.map(l => liveProfile(db, l.hostAdopterId, { ...ctx, linkId: l.id })));
            const live = await Promise.all(batch.map((link, j) => {
                const host = hostRows[j];
                return host ? isLiveLinkFollowingMerges(link, deserializeHouseholdMembers(host.householdMembers), { ...ctx, linkId: link.id }) : false;
            }));
            batch.forEach((link, j) => {
                const host = hostRows[j];
                if (reverseLive.length >= MAX_LINKED_SUMMARIES) return;
                if (!host || !live[j] || host.id === adopterId || seenHosts.has(host.id)) return;
                seenHosts.add(host.id);
                reverseLive.push({ link, host });
            });
        }
        if (liveOutgoing.length > MAX_LINKED_SUMMARIES || reverseLive.length >= MAX_LINKED_SUMMARIES) {
            logger.info('householdLinks: summary cap reached', { ...ctx, liveOutgoing: liveOutgoing.length, cap: MAX_LINKED_SUMMARIES });
        }

        const profiles = new Map<string, ProfileRow>();
        linkedRows.forEach(p => { if (p && p.id !== adopterId) profiles.set(p.id, p); });
        reverseLive.forEach(({ host }) => profiles.set(host.id, host));
        if (profiles.size === 0) return EMPTY_LINKED_SUMMARIES;

        const viewerEmail = viewer ?? null;
        const [gatingOn, publicFlag, visibilities, counts, viewerIsAdmin, viewerIsSelfTeam] = await Promise.all([
            isPiiGatingEnabled(),
            isPublicProfilesEnabled(),
            resolveAdoptersVisibility(viewerEmail, [...profiles.values()].map(p => ({ id: p.id, addedBy: p.addedBy }))),
            Promise.all([...profiles.keys()].map(async id => [id, await countsFor(db, id, ctx)] as const)),
            reverseLive.length && viewerEmail
                ? (async () => (await import('@/config/admins')).isAdminAsync(viewerEmail))()
                : Promise.resolve(false),
            reverseLive.length && viewerEmail
                ? (async () => (await import('@/lib/orgMembership')).isOwnerOrOrgMate(viewerEmail, self.addedBy))()
                : Promise.resolve(false),
        ]);
        const countMap = new Map(counts);
        const names = await namesFor([
            ...[...profiles.values()].map(p => p.addedBy),
            ...reverseLive.map(r => r.link.createdBy),
        ], ctx);

        const summarize = (p: ProfileRow, linkId: string): LinkedSummary => {
            const c = countMap.get(p.id) ?? { rating: null, openAlerts: 0, adoptions: 0, records: 0 };
            const { contacts, more, canSeeContact } = viewerContacts(p, gatingOn, publicFlag, visibilities.get(p.id));
            return {
                linkId,
                profileId: p.id,
                name: p.name,
                ownerName: personLabel(p.addedBy, names),
                rating: c.rating,
                openAlerts: c.openAlerts,
                adoptions: c.adoptions,
                records: c.records,
                contacts,
                moreContacts: more,
                canSeeContact,
            };
        };

        const members: LinkedSummaries['members'] = {};
        hostLinks.forEach((l, i) => {
            const p = linkedRows[i];
            if (p && p.id !== adopterId) members[l.memberId] = summarize(p, l.id);
        });
        const canReportNotLiving = canReportNotLivingTogether({ viewerIsAdmin: !!viewerIsAdmin, viewerIsLinkedOwnerTeam: !!viewerIsSelfTeam });
        const livesWith: LivesWithRow[] = reverseLive.map(({ link, host }) => ({
            ...summarize(host, link.id),
            creatorName: personLabel(link.createdBy, names),
            canReportNotLiving,
        }));
        return { members, livesWith };
    } catch (e) {
        logger.warn('householdLinks: summaries failed, profile shows names only', { ...ctx, error: errMsg(e) });
        return EMPTY_LINKED_SUMMARIES;
    }
}
