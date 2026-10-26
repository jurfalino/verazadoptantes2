/**
 * Linked convivientes (spec 2026-10-25 pendientes D, addendum D44–D47) —
 * server side. NOT a 'use server' module: every export here is called by
 * server code only (addHouseholdMember / removeHouseholdMember, the profile
 * page, the hide action), so none of it is a browser-callable endpoint.
 *
 * - `recordHouseholdLink` / `deleteHouseholdLink`: the `household_links` row
 *   kept beside a household member that carries a `profileId`.
 * - `notifyHouseholdLinked`: the linked profile's owner team hears about it (D45).
 * - `getLinkedSummaries`: the live summaries for a profile page (D46) — the
 *   host's linked members and the linked profile's «Convive con» rows — with
 *   each profile's contacts masked exactly as `getAdopter` would mask them
 *   for this viewer (same resolver, same flags), never more.
 *
 * Decisions live in src/domain/householdLinks.ts. D1: no `IN (array)` —
 * one bounded query set per profile, fanned out with Promise.all.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { adopters, householdLinks } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { maskContactEntries, NO_ACCESS_VISIBILITY, type Visibility } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, maskOptionsFor, resolveAdoptersVisibility } from '@/lib/piiAccessServer';
import { notificationContent } from '@/domain/notificationTemplates';
import { RECORD_TYPES } from '@/domain/constants';
import { realOwner } from '@/domain/dedupPair';
import {
    EMPTY_LINKED_SUMMARIES,
    MAX_LINKED_SUMMARIES,
    MAX_LINK_ROWS,
    canHideHouseholdLink,
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
 *   household member, not hidden by this profile's team.
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
            db.select().from(householdLinks)
                .where(and(eq(householdLinks.linkedAdopterId, adopterId), isNull(householdLinks.hiddenAt)))
                .orderBy(asc(householdLinks.createdAt), asc(householdLinks.id)).limit(MAX_LINK_ROWS).all() as Promise<LinkRow[]>,
        ]);
        if (outgoing.length === 0 && incoming.length === 0) return EMPTY_LINKED_SUMMARIES;
        if (outgoing.length >= MAX_LINK_ROWS || incoming.length >= MAX_LINK_ROWS) {
            logger.warn('householdLinks: link row cap hit, older-than-cap links not read', { ...ctx, outgoing: outgoing.length, incoming: incoming.length, cap: MAX_LINK_ROWS });
        }

        // Host side: only links whose member is still on this profile and still points there.
        const selfMembers = deserializeHouseholdMembers(self.householdMembers);
        const liveOutgoing = outgoing.filter(l => isLiveLink(l, selfMembers));
        const hostLinks = liveOutgoing.slice(0, MAX_LINKED_SUMMARIES);
        const linkedRows = await Promise.all(hostLinks.map(l => liveProfile(db, l.linkedAdopterId, { ...ctx, linkId: l.id })));

        // Linked side: the host (or the profile it was merged into) must still list
        // this profile. Checked a batch at a time until MAX_LINKED_SUMMARIES are live.
        const seenHosts = new Set<string>();
        const reverseLive: Array<{ link: LinkRow; host: ProfileRow }> = [];
        for (let i = 0; i < incoming.length && reverseLive.length < MAX_LINKED_SUMMARIES; i += MAX_LINKED_SUMMARIES) {
            const batch = incoming.slice(i, i + MAX_LINKED_SUMMARIES);
            const hostRows = await Promise.all(batch.map(l => liveProfile(db, l.hostAdopterId, { ...ctx, linkId: l.id })));
            batch.forEach((link, j) => {
                const host = hostRows[j];
                if (reverseLive.length >= MAX_LINKED_SUMMARIES) return;
                if (!host || host.id === adopterId || seenHosts.has(host.id)) return;
                if (!isLiveLink(link, deserializeHouseholdMembers(host.householdMembers))) return;
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
        const canHide = canHideHouseholdLink({ viewerIsAdmin: !!viewerIsAdmin, viewerIsLinkedOwnerTeam: !!viewerIsSelfTeam });
        const livesWith: LivesWithRow[] = reverseLive.map(({ link, host }) => ({
            ...summarize(host, link.id),
            creatorName: personLabel(link.createdBy, names),
            canHide,
        }));
        return { members, livesWith };
    } catch (e) {
        logger.warn('householdLinks: summaries failed, profile shows names only', { ...ctx, error: errMsg(e) });
        return EMPTY_LINKED_SUMMARIES;
    }
}
