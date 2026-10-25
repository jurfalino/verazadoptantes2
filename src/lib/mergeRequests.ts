/**
 * Merge requests between rescuers (spec docs/superpowers/specs/2026-10-25-
 * merge-requests-design.md). A plain server module, NOT 'use server': these
 * take the requester / actor as an argument, so as actions anyone could forge
 * one. Callers resolve the actor from the session first:
 *   - mergePendingDedupPair (src/app/actions/duplicates.ts) files requests;
 *   - resolveMergeRequest / cancelMergeRequest (src/app/actions/mergeRequests.ts)
 *     answer them;
 *   - the admin list reads listMergeRequestsForAdmin.
 * Who may answer what is decideMergeRequestAnswer (src/domain/dedupPair.ts);
 * this module only builds its inputs, and the merge itself is mergeAdopters.
 *
 * v2 (spec 2026-10-25-pendientes-d): a request stores the requester's chosen
 * survivor (`primaryId`) and the profile to absorb (`secondaryId`); the asked
 * owner may accept, flip it (their own profile stays, D26) or decline. A
 * declined pair stays on both lists (D27): the requester can't ask again
 * (D43) but the owner team can still accept later. After every merge the
 * absorbed profile's owner team keeps access to the survivor (D40).
 */

import { and, asc, eq, or } from 'drizzle-orm';
import { adopterFlags, adopters, duplicateCandidates, mergeRequests } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { mergeAdopters } from '@/lib/adopterMerge';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { createNotification, notifyAdmins, resolveDisplayName } from '@/app/actions/notifications';
import { rowsAffected } from '@/lib/interviews/rowsAffected';
import { grantAccessAfterFold } from '@/lib/mergeAccess';
import { mergeSideParams } from '@/lib/mergeNotificationSides';
import { notificationContent, type MergeSides, type NotificationTemplate } from '@/domain/notificationTemplates';
import {
    canRequestAgain,
    decideMergeRequestAnswer,
    KEPT_SEPARATE_FLAG_DETAILS_PREFIX,
    type MergeRequestStatus,
} from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type RequestRow = typeof mergeRequests.$inferSelect;

export type MergeRequestDecision = 'accept' | 'decline' | 'cancel' | 'flip';

export type MergeRequestAnswerResult =
    | { ok: true; status: MergeRequestStatus }
    | { ok: false; reason: 'not_found' | 'not_allowed' | 'not_open' | 'profiles_changed' | 'merge_failed' };

export interface MergeRequestAdminRow {
    id: string;
    status: MergeRequestStatus;
    /** epoch ms */
    createdAt: number | null;
    /** The side that stays («se conserva»): the request's primaryId. */
    primary: MergeRequestAdminSide;
    /** The side that is absorbed («se absorbe»). */
    secondary: MergeRequestAdminSide;
    requesterEmail: string;
    ownerEmail: string | null;
}

/** One profile of a request, as the admin list shows it (D31). Admin page, so the owner email is shown whole. */
export interface MergeRequestAdminSide {
    id: string;
    name: string;
    /** Who added the profile; null for an anonymous one. */
    ownerEmail: string | null;
    /** epoch ms the profile was created */
    createdAt: number | null;
}

const ICON = '🔗';

/**
 * The PENDING request for this pair, in either orientation. A declined one
 * does not count: if the pair resurfaces (a rescan) and someone asks again,
 * that is a new question for the owner.
 */
async function findPendingRequestForPair(db: Db, a: string, b: string): Promise<{ id: string; requesterEmail: string } | undefined> {
    return db.select({ id: mergeRequests.id, requesterEmail: mergeRequests.requesterEmail }).from(mergeRequests).where(and(
        or(
            and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
            and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
        ),
        eq(mergeRequests.status, 'pending'),
    )).get();
}

/** Every request ever filed on this pair, in either orientation (for canRequestAgain). */
async function requestsForPair(db: Db, a: string, b: string): Promise<Array<{ requesterEmail: string; status: MergeRequestStatus }>> {
    const rows = await db.select({ requesterEmail: mergeRequests.requesterEmail, status: mergeRequests.status }).from(mergeRequests).where(or(
        and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
        and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
    )).all() as Array<{ requesterEmail: string; status: string }>;
    return rows.map(r => ({ requesterEmail: r.requesterEmail, status: r.status as MergeRequestStatus }));
}

/**
 * Did an owner decline one of `viewer`'s requests on this pair (D43)? Then the
 * viewer may not ask again. Every request on the pair, either orientation —
 * the one rule createMergeRequest enforces, for pairChoices in the feed and the
 * click. One query.
 */
export async function declinedForViewer(db: Db, a: string, b: string, viewer: string): Promise<boolean> {
    return !canRequestAgain(await requestsForPair(db, a, b), viewer);
}

/**
 * File a request asking the other profile's owner (and their team, D16) to let
 * the pair be merged, keeping `primaryId` (the requester's choice, D24); with
 * no real owner it goes to the admins (D15). One pending request per pair: if
 * one exists it is returned (`created: false`, with ITS requester — the caller
 * decides whether that is "you already asked" or someone else's request) and
 * nobody is notified. A requester whose earlier request on this pair was
 * declined may not ask again (D43): `{ refused: 'declined_before' }`.
 */
export async function createMergeRequest(db: Db, input: {
    primaryId: string;
    secondaryId: string;
    candidateId: string | null;
    flagId: string | null;
    requesterEmail: string;
    ownerEmail: string | null;
}): Promise<{ id: string; created: boolean; requesterEmail: string } | { refused: 'declined_before' }> {
    // Stored normalized: the feed and the answer checks find a request by
    // these emails, and `added_by` (where ownerEmail comes from) keeps
    // whatever case it was written with.
    input = {
        ...input,
        requesterEmail: normEmail(input.requesterEmail),
        ownerEmail: input.ownerEmail ? normEmail(input.ownerEmail) : null,
    };
    const existing = await findPendingRequestForPair(db, input.primaryId, input.secondaryId);
    if (existing) return { id: existing.id, created: false, requesterEmail: existing.requesterEmail };
    if (!canRequestAgain(await requestsForPair(db, input.primaryId, input.secondaryId), input.requesterEmail)) {
        logger.info('createMergeRequest: declined before, not asking again', {
            primaryId: input.primaryId, secondaryId: input.secondaryId, actor: input.requesterEmail,
        });
        return { refused: 'declined_before' };
    }

    const id = crypto.randomUUID();
    await db.insert(mergeRequests).values({
        id,
        primaryId: input.primaryId,
        secondaryId: input.secondaryId,
        candidateId: input.candidateId,
        flagId: input.flagId,
        requesterEmail: input.requesterEmail,
        ownerEmail: input.ownerEmail,
        status: 'pending',
        createdAt: new Date(),
    });
    logger.info('createMergeRequest: filed', {
        requestId: id, primaryId: input.primaryId, secondaryId: input.secondaryId,
        actor: input.requesterEmail, toAdmins: input.ownerEmail === null,
    });

    // The request stands even if telling people about it fails.
    try {
        await notifyRequestFiled(db, id, input);
    } catch (e) {
        logger.warn('createMergeRequest: notifications not sent', {
            requestId: id, actor: input.requesterEmail, error: e instanceof Error ? e.message : String(e),
        });
    }
    return { id, created: true, requesterEmail: input.requesterEmail };
}

async function notifyRequestFiled(db: Db, requestId: string, input: {
    primaryId: string; secondaryId: string; requesterEmail: string; ownerEmail: string | null;
}): Promise<void> {
    // The requester's choice: primary stays, secondary is absorbed (D31 names both owners and dates).
    const [requester, sides] = await Promise.all([
        resolveDisplayName(input.requesterEmail),
        mergeSideParams(db, { survivorId: input.primaryId, absorbedId: input.secondaryId }),
    ]);
    const content = notificationContent({ key: 'merge_request', params: { requesterName: requester, ...sides } });
    const metadata = { mergeRequestId: requestId, primaryId: input.primaryId, secondaryId: input.secondaryId };

    if (input.ownerEmail === null) {
        await notifyAdmins({ actorEmail: input.requesterEmail, type: 'merge_request', ...content, url: '/admin/merge-requests', icon: ICON, metadata });
        return;
    }
    const requesterKey = normEmail(input.requesterEmail);
    const seen = new Set<string>();
    const recipients = (await getOrgMemberEmailsFor(input.ownerEmail)).filter(email => {
        const key = normEmail(email);
        if (!key || key === requesterKey || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    await Promise.all(recipients.map(userId =>
        createNotification({ userId, type: 'merge_request', ...content, url: '/my-adopters#pendientes', icon: ICON, metadata })));
}

/**
 * Compare-and-set the request's resolution: writes only while the row is still
 * in `from`. True when this call moved it — the guard that makes two people
 * answering at once merge exactly once.
 */
async function casRequest(db: Db, id: string, from: string, to: { status: string; resolvedByEmail: string | null; resolvedAt: Date | null }): Promise<boolean> {
    const res = await db.update(mergeRequests).set(to)
        .where(and(eq(mergeRequests.id, id), eq(mergeRequests.status, from))).run();
    const changed = rowsAffected(res);
    if (changed !== null) return changed > 0;
    // The driver reported no count: re-read and see whether the row is ours.
    const after = await db.select({ status: mergeRequests.status, by: mergeRequests.resolvedByEmail })
        .from(mergeRequests).where(eq(mergeRequests.id, id)).get();
    return after?.status === to.status && (after?.by ?? null) === to.resolvedByEmail;
}

/**
 * Accept, decline, cancel or flip a request as `actor` (already resolved from
 * the session by the caller). `flip` merges the other way round: the request's
 * secondary (the asked owner's profile) survives.
 */
export async function answerMergeRequest(
    db: Db,
    requestId: string,
    actor: string,
    decision: MergeRequestDecision,
): Promise<MergeRequestAnswerResult> {
    const req = await db.select().from(mergeRequests).where(eq(mergeRequests.id, requestId)).get() as RequestRow | undefined;
    if (!req) return { ok: false, reason: 'not_found' };
    const status = req.status as MergeRequestStatus;
    const ctx = { requestId, actor, decision, primaryId: req.primaryId, secondaryId: req.secondaryId };

    // The authorization inputs. A request with no real owner (null) has no
    // owner team: only an admin can answer it.
    const actorIsRequester = !!normEmail(actor) && normEmail(actor) === normEmail(req.requesterEmail);
    const [actorOnOwnerTeam, actorIsAdmin] = await Promise.all([
        req.ownerEmail ? isOwnerOrOrgMate(actor, req.ownerEmail) : Promise.resolve(false),
        isAdminAsync(actor),
    ]);
    const answer = decideMergeRequestAnswer({ status, actorIsRequester, actorOnOwnerTeam, actorIsAdmin, decision });
    if (!answer.ok) return answer;

    // Both profiles must still be live (Review Focus 2). A profile merged or
    // removed elsewhere closes the request — but only while it is still open,
    // so a late click never overwrites a finished answer.
    const [primary, secondary] = await Promise.all([req.primaryId, req.secondaryId].map(id =>
        db.select({ name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, id)).get()));
    if (!primary || !secondary || primary.deletedAt || secondary.deletedAt) {
        const closed = await casRequest(db, requestId, status, { status: 'closed', resolvedByEmail: null, resolvedAt: new Date() });
        logger.info('answerMergeRequest: a profile changed, request closed', { ...ctx, closed });
        return { ok: false, reason: closed ? 'profiles_changed' : 'not_open' };
    }

    // Claim the answer before doing anything (Review Focus 1).
    const won = await casRequest(db, requestId, status, { status: answer.nextStatus, resolvedByEmail: actor, resolvedAt: new Date() });
    if (!won) {
        logger.warn('answerMergeRequest: lost the race', { ...ctx, from: status });
        return { ok: false, reason: 'not_open' };
    }

    // Who survives: the requester's choice, or the asked owner's on a flip.
    const keep = answer.swap
        ? { survivorId: req.secondaryId, absorbedId: req.primaryId, survivor: secondary, absorbed: primary }
        : { survivorId: req.primaryId, absorbedId: req.secondaryId, survivor: primary, absorbed: secondary };

    if (answer.merges) {
        const result = await mergeAdopters(keep.survivorId, keep.absorbedId, actor);
        if (!result.success) {
            // Put the request back as it was (keeping an owner's earlier
            // decline) — or closed, when the failure was a profile merged
            // away in the meantime, so it does not reopen against a dead pair.
            const gone = (await Promise.all([req.primaryId, req.secondaryId].map(id =>
                db.select({ deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, id)).get())))
                .some(r => !r || r.deletedAt);
            const restored = await casRequest(db, requestId, answer.nextStatus, gone
                ? { status: 'closed', resolvedByEmail: null, resolvedAt: new Date() }
                : { status, resolvedByEmail: req.resolvedByEmail ?? null, resolvedAt: req.resolvedAt ?? null });
            logger.error('answerMergeRequest: merge failed', new Error(result.error ?? 'merge failed'), { ...ctx, restored, profileGone: gone });
            return { ok: false, reason: gone ? 'profiles_changed' : 'merge_failed' };
        }
        // D40: the absorbed side's owner team keeps seeing the survivor. Best-effort.
        // Accepted or flipped by the owner team, or approved by an admin: a
        // consented fold, so full contact (D40).
        await grantAccessAfterFold(db, {
            survivorId: keep.survivorId, absorbedOwnerEmail: keep.absorbed.addedBy ?? null, actor, mergeAuditId: result.auditId ?? null,
            access: { scope: 'all_contact' },
        });
    } else if (answer.nextStatus === 'admin_declined') {
        // An admin's decline is final (no one may reopen it), so the pair is
        // resolved as kept-separate. An owner's decline leaves the pair on
        // both lists (D27): the owner may still accept, the requester may
        // still keep the other's profile (D43).
        await keepSeparate(db, { a: req.primaryId, b: req.secondaryId }, actor, `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}${req.id}`, {
            requestId: req.id, candidateId: req.candidateId, flagId: req.flagId,
        });
    }

    logger.info('answerMergeRequest: answered', { ...ctx, status: answer.nextStatus, swap: !!answer.swap });
    if (answer.nextStatus !== 'cancelled') {
        // The answer stands even if telling people about it fails.
        try {
            await notifyAnswered(db, req, answer.nextStatus, actor, {
                survivorId: keep.survivorId, absorbedId: keep.absorbedId, survivor: keep.survivor.name, absorbed: keep.absorbed.name, flipped: !!answer.swap,
            });
        } catch (e) {
            logger.warn('answerMergeRequest: notifications not sent', { ...ctx, status: answer.nextStatus, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return { ok: true, status: answer.nextStatus };
}

/**
 * Resolve a pair as kept-separate, so it leaves both lists: every pending
 * detected candidate AND every duplicate flag between the two profiles, in
 * either orientation. Used by an admin's decline and by «No, es alguien de su
 * hogar» (D35, mergePendingDedupPair). `flagMarker` is written into the flags'
 * details and must start with KEPT_SEPARATE_FLAG_DETAILS_PREFIX; it must never
 * carry an email (flag details render to every viewer of the profile).
 * Best-effort: a failure is logged, the pair just keeps showing.
 */
export async function keepSeparate(
    db: Db,
    pair: { a: string; b: string },
    actor: string,
    flagMarker: string,
    ctx: Record<string, unknown> = {},
): Promise<void> {
    const { a, b } = pair;
    try {
        await db.update(duplicateCandidates)
            .set({ status: 'dismissed', resolvedBy: actor, resolvedAt: new Date() })
            .where(and(
                eq(duplicateCandidates.status, 'pending'),
                or(
                    and(eq(duplicateCandidates.adopter1Id, a), eq(duplicateCandidates.adopter2Id, b)),
                    and(eq(duplicateCandidates.adopter1Id, b), eq(duplicateCandidates.adopter2Id, a)),
                ),
            ));
        await db.update(adopterFlags)
            .set({ details: flagMarker })
            .where(and(
                eq(adopterFlags.reason, 'duplicate'),
                or(
                    and(eq(adopterFlags.adopterId, a), eq(adopterFlags.targetAdopterId, b)),
                    and(eq(adopterFlags.adopterId, b), eq(adopterFlags.targetAdopterId, a)),
                ),
            ));
    } catch (e) {
        // The answer stands; the pair just keeps showing until dismissed by hand.
        logger.error('keepSeparate: pair not marked kept-separate', e, { ...ctx, actor, primaryId: a, secondaryId: b });
    }
}

/**
 * «No, es alguien de su hogar» (D35) settled the pair as two people, so no
 * merge request on it may stay answerable. A PENDING request asking the actor
 * (or their team) is recorded as their decline — compare-and-set, the
 * requester gets the usual «rechazó» notice, and the D43 re-ask block applies.
 * Any other pending request (the actor's own, or one for the admins) closes.
 * Declined requests stay declined. Never `IN (…)`.
 */
export async function settleRequestsAsHousehold(db: Db, a: string, b: string, actor: string): Promise<{ declined: number; closed: number }> {
    const rows = await db.select().from(mergeRequests).where(and(
        or(
            and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
            and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
        ),
        eq(mergeRequests.status, 'pending'),
    )).all() as RequestRow[];
    let declined = 0, closed = 0;
    for (const req of rows) {
        const askedActor = !!req.ownerEmail && normEmail(req.requesterEmail) !== normEmail(actor)
            && await isOwnerOrOrgMate(actor, req.ownerEmail);
        if (!askedActor) {
            if (await casRequest(db, req.id, 'pending', { status: 'closed', resolvedByEmail: null, resolvedAt: new Date() })) closed++;
            continue;
        }
        if (!await casRequest(db, req.id, 'pending', { status: 'declined', resolvedByEmail: actor, resolvedAt: new Date() })) continue;
        declined++;
        // The decline stands (and the loop goes on) even if telling the requester fails.
        try {
            await notifyAnswered(db, req, 'declined', actor, { survivorId: req.primaryId, absorbedId: req.secondaryId, flipped: false });
        } catch (e) {
            logger.warn('settleRequestsAsHousehold: decline notice not sent', {
                requestId: req.id, primaryId: req.primaryId, secondaryId: req.secondaryId, actor, error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    if (rows.length) logger.info('settleRequestsAsHousehold: settled', { primaryId: a, secondaryId: b, actor, declined, closed });
    return { declined, closed };
}

/**
 * The template and link of the notice an answer sends. The ONE place these are
 * chosen. «rechazó», never «mantuvo separados», and no promise of an admin
 * review (D30). The owner's copy when a teammate answered reads as the
 * teammate's answer to the requester (D26).
 */
function answerNotice(input: {
    status: MergeRequestStatus;
    byAdmin: boolean;
    actorName: string;
    requesterName: string;
    forOwnerTeammateAnswer: boolean;
    survivorId: string;
    flipped: boolean;
    sides: MergeSides;
}): { template: NotificationTemplate; url: string } {
    const { status, byAdmin, actorName, requesterName, survivorId, flipped, sides } = input;
    const merged = status === 'accepted' || status === 'admin_approved';
    const url = merged ? `/adopter/${survivorId}` : '/my-adopters#pendientes';
    if (input.forOwnerTeammateAnswer) {
        const outcome = !merged ? 'declined' : flipped ? 'flipped' : 'accepted';
        return { template: { key: 'merge_request_answered_by_teammate', params: { actorName, requesterName, outcome, ...sides } }, url };
    }
    const who = byAdmin ? { byAdmin: '1' } : { actorName };
    const key = !merged ? 'merge_request_declined' : flipped ? 'merge_request_flipped' : 'merge_request_accepted';
    return { template: { key, params: { ...who, ...sides } }, url };
}

/**
 * Tell the requester how it ended (D5), and the owner too whenever someone
 * else on their side answered — a teammate (D26) or an admin. Never the actor.
 */
async function notifyAnswered(
    db: Db,
    req: RequestRow,
    status: MergeRequestStatus,
    actor: string,
    merge: { survivorId: string; absorbedId: string; survivor?: string; absorbed?: string; flipped: boolean },
): Promise<void> {
    const byAdmin = status === 'admin_approved' || status === 'admin_declined';
    const actorKey = normEmail(actor);
    const recipients = [req.requesterEmail, ...(req.ownerEmail ? [req.ownerEmail] : [])]
        .filter((email, i, all) => normEmail(email) !== actorKey && all.findIndex(o => normEmail(o) === normEmail(email)) === i);
    if (recipients.length === 0) return;

    const [actorName, requesterName, sides] = await Promise.all([
        byAdmin ? Promise.resolve('') : resolveDisplayName(actor),
        resolveDisplayName(req.requesterEmail),
        mergeSideParams(db, { survivorId: merge.survivorId, absorbedId: merge.absorbedId }, { survivorName: merge.survivor, absorbedName: merge.absorbed }),
    ]);
    const ownerKey = req.ownerEmail ? normEmail(req.ownerEmail) : null;
    await Promise.all(recipients.map(userId => {
        // Not an admin and not the requester (requesters only cancel, which notifies nobody): a teammate of the owner answered.
        const forOwnerTeammateAnswer = !byAdmin && normEmail(userId) === ownerKey;
        const { template, url } = answerNotice({
            status, byAdmin, actorName, requesterName, forOwnerTeammateAnswer, survivorId: merge.survivorId, flipped: merge.flipped, sides,
        });
        return createNotification({
            userId,
            type: 'merge_request_resolved',
            ...notificationContent(template),
            url,
            icon: ICON,
            metadata: { mergeRequestId: req.id, status, primaryId: req.primaryId, secondaryId: req.secondaryId, survivorId: merge.survivorId, flipped: merge.flipped },
        });
    }));
}

/** Requests an admin can still act on: pending first, then declined, each oldest first. */
export async function listMergeRequestsForAdmin(db: Db): Promise<MergeRequestAdminRow[]> {
    const byStatus = (status: 'pending' | 'declined') =>
        db.select().from(mergeRequests).where(eq(mergeRequests.status, status)).orderBy(asc(mergeRequests.createdAt)).all() as Promise<RequestRow[]>;
    const [pendingRows, declinedRows] = await Promise.all([byStatus('pending'), byStatus('declined')]);
    const rows = [...pendingRows, ...declinedRows];

    const ids = [...new Set(rows.flatMap(r => [r.primaryId, r.secondaryId]))];
    const sides = new Map(await Promise.all(ids.map(async id => {
        let row: { name: string | null; addedBy: string | null; createdAt: Date | null } | undefined;
        try {
            row = await db.select({ name: adopters.name, addedBy: adopters.addedBy, createdAt: adopters.createdAt })
                .from(adopters).where(eq(adopters.id, id)).get();
        } catch (e) {
            logger.warn('listMergeRequestsForAdmin: D1 fallback hit', { adopterId: id, error: e instanceof Error ? e.message : String(e) });
        }
        const owner = row?.addedBy && row.addedBy !== 'anonymous' ? row.addedBy : null;
        const side: MergeRequestAdminSide = { id, name: row?.name ?? '', ownerEmail: owner, createdAt: row?.createdAt ? row.createdAt.getTime() : null };
        return [id, side] as const;
    })));
    const side = (id: string): MergeRequestAdminSide => sides.get(id) ?? { id, name: '', ownerEmail: null, createdAt: null };

    return rows.map(r => ({
        id: r.id,
        status: r.status as MergeRequestStatus,
        createdAt: r.createdAt ? r.createdAt.getTime() : null,
        primary: side(r.primaryId),
        secondary: side(r.secondaryId),
        requesterEmail: r.requesterEmail,
        ownerEmail: r.ownerEmail ?? null,
    }));
}
