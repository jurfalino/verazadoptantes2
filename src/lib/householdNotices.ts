/**
 * Households as profiles (spec 2026-10-26-households-as-profiles-design) —
 * who hears about a household change. NOT a 'use server' module: these take
 * the actor as an argument and must never be browser-callable endpoints.
 *
 * "A household's teams" = the real owner and org-mates of every live profile
 * in it, never the actor. Each recipient gets one notice per event, linked to
 * the first profile of theirs it concerns. Everything runs after the response
 * (`runAfterResponse`: Workers kill bare fire-and-forget work) and never throws.
 *
 * - `notifyHouseholdPersonAdded`: the anchor's owner + editors when the adder
 *   is not on its team — a stranger, or an admin from outside it (D54 'household_contribution', the shared
 *   contribution path); the teams of the household's other profiles,
 *   including the person added ('household_linked', D45); the teams of any
 *   other household the person already lives in ('household_also_lives_with').
 * - `notifyHouseholdReaddDisputed`: a person put back where someone said
 *   they don't live (a correction exists), by hand or by a merge — the admins decide (D48).
 * - `notifyHouseholdRelationshipChanged` / `notifyHouseholdMemberRemoved`:
 *   the household's teams.
 *
 * D1: no `IN (array)` — one bounded query per profile / household, fanned out.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { namesFor } from '@/lib/profileSummary';
import { notifyApprovers } from '@/lib/contributionSideEffects';
import { householdIdsOf, membershipsOf } from '@/lib/households';
import { realOwner } from '@/domain/dedupPair';
import { linkNoticeRecipients, personLabel } from '@/domain/householdLinks';
import { MAX_HOUSEHOLDS_PER_PROFILE } from '@/domain/households';
import { notificationContent, type NotificationTemplate } from '@/domain/notificationTemplates';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Ctx = Record<string, unknown>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const norm = (e: string) => e.trim().toLowerCase();

/** A live profile's owner, or null (deleted, missing, a failed read — logged). */
async function ownerOf(db: Db, adopterId: string, ctx: Ctx): Promise<string | null> {
    try {
        const row = await db.select({ addedBy: adopters.addedBy, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, adopterId)).get();
        return row && !row.deletedAt ? realOwner(row.addedBy) : null;
    } catch (e) {
        logger.warn('householdNotices: owner read failed, that profile\'s team not told', { ...ctx, profileId: adopterId, error: errMsg(e) });
        return null;
    }
}

/**
 * The teams of `profileIds` (owner + org-mates, never the actor), each
 * recipient mapped to the FIRST profile of theirs in the list. Recipients in
 * `skip` are left out.
 */
export async function teamsOf(db: Db, profileIds: readonly string[], actor: string, skip: ReadonlySet<string>, ctx: Ctx): Promise<Map<string, string>> {
    const ids = [...new Set(profileIds)];
    const owners = await Promise.all(ids.map(id => ownerOf(db, id, ctx)));
    const teamByOwner = new Map<string, Promise<string[]>>();
    const { getOrgMemberEmailsFor } = await import('@/lib/orgMembership');
    const teamFor = (owner: string) => {
        let p = teamByOwner.get(norm(owner));
        if (!p) {
            p = getOrgMemberEmailsFor(owner).catch((e: unknown) => {
                logger.warn('householdNotices: team lookup failed, only the owner told', { ...ctx, error: errMsg(e) });
                return [] as string[];
            });
            teamByOwner.set(norm(owner), p);
        }
        return p;
    };
    const teams = await Promise.all(owners.map(o => (o ? teamFor(o) : Promise.resolve([] as string[]))));
    const out = new Map<string, string>();
    ids.forEach((id, i) => {
        const owner = owners[i];
        if (!owner) return;
        for (const r of linkNoticeRecipients(owner, teams[i], actor)) {
            if (!skip.has(r) && !out.has(r)) out.set(r, id);
        }
    });
    return out;
}

export async function actorNameOf(actor: string, ctx: Ctx): Promise<string> {
    return personLabel(actor, await namesFor([actor], ctx)) ?? '';
}

async function send(
    recipients: Map<string, string>,
    type: string,
    template: NotificationTemplate,
    metadata: Record<string, unknown>,
    ctx: Ctx,
): Promise<void> {
    if (recipients.size === 0) {
        logger.info(`householdNotices: ${type} — no recipients`, ctx);
        return;
    }
    const { createNotification } = await import('@/app/actions/notifications');
    const content = notificationContent(template);
    await Promise.all([...recipients].map(([userId, profileId]) => createNotification({
        userId,
        type,
        ...content,
        url: `/adopter/${profileId}`,
        icon: '🏠',
        metadata: { ...metadata, profileId },
    })));
    logger.info(`householdNotices: ${type} sent`, { ...ctx, recipients: recipients.size });
}

/** The live member ids of one household (bounded). */
async function memberIds(db: Db, householdId: string): Promise<string[]> {
    return (await membershipsOf(db, householdId)).map(m => m.adopterId);
}

export type PersonAddedNotice = {
    householdId: string;
    membershipId: string;
    anchor: { id: string; name: string; addedBy: string | null };
    person: { id: string; name: string };
    actor: string;
    /** The actor is the anchor's owner or an org-mate: no contribution notice (D54). An admin from outside the team is not. */
    onAnchorTeam: boolean;
    /** An existing profile was linked: the teams of its other households hear too. */
    existingProfile: boolean;
};

export async function notifyHouseholdPersonAdded(n: PersonAddedNotice): Promise<void> {
    const ctx: Ctx = { householdId: n.householdId, membershipId: n.membershipId, anchorId: n.anchor.id, profileId: n.person.id, actor: n.actor };
    await runAfterResponse('household.person_added', async () => {
        const db = await getDb();
        if (!db) return;
        if (!n.onAnchorTeam) {
            await notifyApprovers({
                op: 'addHouseholdPerson', adopterId: n.anchor.id, actor: n.actor, type: 'household_contribution',
                build: (actorName) => ({ key: 'household_contribution', params: { actorName, what: 'member', ...(n.anchor.name ? { adopterName: n.anchor.name } : {}), ...(n.person.name?.trim() ? { personName: n.person.name.trim() } : {}) } }),
                metadata: { membershipId: n.membershipId, profileId: n.person.id, householdId: n.householdId, what: 'member' },
            });
        }
        // The anchor's team is told through the contribution path (or acted themselves).
        const anchorTeam = await teamsOf(db, [n.anchor.id], n.actor, new Set(), ctx);
        const skip = new Set<string>([norm(n.actor), ...anchorTeam.keys()]);
        const actorName = await actorNameOf(n.actor, ctx);
        const others = (await memberIds(db, n.householdId)).filter(id => id !== n.anchor.id);
        // The person first, so their team's notice links to their profile.
        const linked = await teamsOf(db, [n.person.id, ...others], n.actor, skip, ctx);
        await send(linked, 'household_linked',
            { key: 'household_linked', params: { actorName, hostName: n.anchor.name, linkedName: n.person.name } },
            { hostId: n.anchor.id, linkedId: n.person.id, householdId: n.householdId }, ctx);
        if (!n.existingProfile) return;
        const elsewhere = (await householdIdsOf(db, n.person.id)).filter(h => h !== n.householdId).slice(0, MAX_HOUSEHOLDS_PER_PROFILE);
        if (elsewhere.length === 0) return;
        const mates = (await Promise.all(elsewhere.map(h => memberIds(db, h)))).flat().filter(id => id !== n.person.id);
        const also = await teamsOf(db, mates, n.actor, new Set([...skip, ...linked.keys()]), ctx);
        await send(also, 'household_also_lives_with',
            { key: 'household_also_lives_with', params: { actorName, personName: n.person.name, hostName: n.anchor.name } },
            { hostId: n.anchor.id, personId: n.person.id, householdId: n.householdId }, ctx);
    }, ctx);
}

/** D48: `person` is back in a household after a «No vive acá» there — the admins decide. `viaMerge`: a merge carried them back (Task 6). */
export async function notifyHouseholdReaddDisputed(n: {
    householdId: string; membershipId: string; person: { id: string; name: string }; hostName: string | null; actor: string; viaMerge?: boolean;
}): Promise<void> {
    const ctx: Ctx = { householdId: n.householdId, membershipId: n.membershipId, profileId: n.person.id, actor: n.actor, viaMerge: !!n.viaMerge };
    await runAfterResponse('household.readd_disputed', async () => {
        const { notifyAdmins } = await import('@/app/actions/notifications');
        const actorName = await actorNameOf(n.actor, ctx);
        await notifyAdmins({
            actorEmail: n.actor,
            type: 'household_member_disputed',
            ...notificationContent({
                key: 'household_member_disputed',
                params: { actorName, personName: n.person.name, ...(n.hostName ? { hostName: n.hostName } : {}), ...(n.viaMerge ? { viaMerge: '1' } : {}) },
            }),
            url: `/adopter/${n.person.id}`,
            icon: '🏠',
            metadata: { householdId: n.householdId, membershipId: n.membershipId, profileId: n.person.id },
        });
        logger.info('householdNotices: re-added after a correction, admins told', ctx);
    }, ctx);
}

export async function notifyHouseholdRelationshipChanged(n: {
    householdId: string; membershipId: string; person: { id: string; name: string }; relationship: string; relativeName: string | null; actor: string;
}): Promise<void> {
    const ctx: Ctx = { householdId: n.householdId, membershipId: n.membershipId, profileId: n.person.id, actor: n.actor };
    await runAfterResponse('household.relationship_changed', async () => {
        const db = await getDb();
        if (!db) return;
        const ids = await memberIds(db, n.householdId);
        const recipients = await teamsOf(db, [n.person.id, ...ids], n.actor, new Set([norm(n.actor)]), ctx);
        const actorName = await actorNameOf(n.actor, ctx);
        await send(recipients, 'household_relationship_changed',
            { key: 'household_relationship_changed', params: { actorName, personName: n.person.name, relationship: n.relationship, ...(n.relativeName ? { relativeName: n.relativeName } : {}) } },
            { householdId: n.householdId, membershipId: n.membershipId, personId: n.person.id }, ctx);
    }, ctx);
}

export async function notifyHouseholdMemberRemoved(n: {
    householdId: string; membershipId: string; person: { id: string; name: string }; hostName: string | null;
    reason: 'mistake' | 'not_living'; remainingIds: readonly string[]; actor: string;
}): Promise<void> {
    const ctx: Ctx = { householdId: n.householdId, membershipId: n.membershipId, profileId: n.person.id, actor: n.actor, reason: n.reason };
    await runAfterResponse('household.member_removed', async () => {
        const db = await getDb();
        if (!db) return;
        const recipients = await teamsOf(db, [n.person.id, ...n.remainingIds], n.actor, new Set([norm(n.actor)]), ctx);
        const actorName = await actorNameOf(n.actor, ctx);
        await send(recipients, 'household_member_removed',
            { key: 'household_member_removed', params: { actorName, personName: n.person.name, reason: n.reason, ...(n.hostName ? { hostName: n.hostName } : {}) } },
            { householdId: n.householdId, membershipId: n.membershipId, personId: n.person.id, reason: n.reason }, ctx);
    }, ctx);
}
