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
import { openMergeRequestStatus } from '@/lib/mergeRequestClose';
import {
    decideMergeRequestAnswer,
    KEPT_SEPARATE_FLAG_DETAILS_PREFIX,
    type MergeRequestStatus,
} from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type RequestRow = typeof mergeRequests.$inferSelect;

export type MergeRequestDecision = 'accept' | 'decline' | 'cancel';

export type MergeRequestAnswerResult =
    | { ok: true; status: MergeRequestStatus }
    | { ok: false; reason: 'not_found' | 'not_allowed' | 'not_open' | 'profiles_changed' | 'merge_failed' };

export interface MergeRequestAdminRow {
    id: string;
    status: MergeRequestStatus;
    /** epoch ms */
    createdAt: number | null;
    primary: { id: string; name: string };
    secondary: { id: string; name: string };
    requesterEmail: string;
    ownerEmail: string | null;
}

const ICON = '🔗';

async function adopterName(db: Db, id: string): Promise<string> {
    const row = await db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, id)).get();
    return row?.name ?? '';
}

/** Open request for this pair, in either orientation. */
async function findOpenRequestForPair(db: Db, a: string, b: string): Promise<{ id: string } | undefined> {
    return db.select({ id: mergeRequests.id }).from(mergeRequests).where(and(
        or(
            and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
            and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
        ),
        openMergeRequestStatus(),
    )).get();
}

/**
 * File a request asking the other profile's owner (and their team, D16) to let
 * the pair be merged; with no real owner it goes to the admins (D15). One open
 * request per pair: asking again returns the existing one and notifies nobody.
 */
export async function createMergeRequest(db: Db, input: {
    primaryId: string;
    secondaryId: string;
    candidateId: string | null;
    flagId: string | null;
    requesterEmail: string;
    ownerEmail: string | null;
}): Promise<{ id: string; created: boolean }> {
    const existing = await findOpenRequestForPair(db, input.primaryId, input.secondaryId);
    if (existing) return { id: existing.id, created: false };

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
    return { id, created: true };
}

async function notifyRequestFiled(db: Db, requestId: string, input: {
    primaryId: string; secondaryId: string; requesterEmail: string; ownerEmail: string | null;
}): Promise<void> {
    const [requester, primaryName, secondaryName] = await Promise.all([
        resolveDisplayName(input.requesterEmail),
        adopterName(db, input.primaryId),
        adopterName(db, input.secondaryId),
    ]);
    const title = `${requester} pidió combinar dos perfiles`;
    const body = `Pidió combinar «${secondaryName}» con «${primaryName}» porque serían la misma persona. Podés aceptar o rechazar el pedido.`;
    const metadata = { mergeRequestId: requestId, primaryId: input.primaryId, secondaryId: input.secondaryId };

    if (input.ownerEmail === null) {
        await notifyAdmins({ actorEmail: input.requesterEmail, type: 'merge_request', title, body, url: '/admin/merge-requests', icon: ICON, metadata });
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
        createNotification({ userId, type: 'merge_request', title, body, url: '/my-adopters', icon: ICON, metadata })));
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
 * Accept, decline or cancel a request as `actor` (already resolved from the
 * session by the caller).
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
        db.select({ name: adopters.name, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, id)).get()));
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

    if (answer.merges) {
        const result = await mergeAdopters(req.primaryId, req.secondaryId, actor);
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
    } else if (answer.nextStatus === 'declined' || answer.nextStatus === 'admin_declined') {
        await keepSeparate(db, req, actor);
    }

    logger.info('answerMergeRequest: answered', { ...ctx, status: answer.nextStatus });
    if (answer.nextStatus !== 'cancelled') {
        await notifyAnswered(req, answer.nextStatus, actor, { primary: primary.name, secondary: secondary.name });
    }
    return { ok: true, status: answer.nextStatus };
}

/** A declined pair is resolved as kept-separate, so it leaves both lists (D4b). */
async function keepSeparate(db: Db, req: RequestRow, actor: string): Promise<void> {
    try {
        if (req.candidateId) {
            await db.update(duplicateCandidates)
                .set({ status: 'dismissed', resolvedBy: actor, resolvedAt: new Date() })
                .where(eq(duplicateCandidates.id, req.candidateId));
        }
        if (req.flagId) {
            await db.update(adopterFlags)
                .set({ details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}${actor}` })
                .where(eq(adopterFlags.id, req.flagId));
        }
    } catch (e) {
        // The decline stands; the pair just keeps showing until dismissed by hand.
        logger.error('answerMergeRequest: pair not marked kept-separate', e, {
            requestId: req.id, actor, candidateId: req.candidateId, flagId: req.flagId,
        });
    }
}

/**
 * Tell the requester how it ended (D5), and the owner too when an admin
 * decided. Never the actor.
 */
async function notifyAnswered(req: RequestRow, status: MergeRequestStatus, actor: string, names: { primary: string; secondary: string }): Promise<void> {
    const byAdmin = status === 'admin_approved' || status === 'admin_declined';
    const merged = status === 'accepted' || status === 'admin_approved';
    const actorKey = normEmail(actor);
    const recipients = [req.requesterEmail, ...(byAdmin && req.ownerEmail ? [req.ownerEmail] : [])]
        .filter((email, i, all) => normEmail(email) !== actorKey && all.findIndex(o => normEmail(o) === normEmail(email)) === i);
    if (recipients.length === 0) return;

    const who = byAdmin ? 'Un administrador' : await resolveDisplayName(actor);
    const title = merged
        ? `Se unieron dos perfiles: ${names.secondary} → ${names.primary}`
        : `${who} mantuvo separados dos perfiles`;
    const body = merged
        ? `${who} aceptó combinar «${names.secondary}» con «${names.primary}». Todo quedó en un solo perfil.`
        : `«${names.secondary}» y «${names.primary}» siguen como perfiles separados.${byAdmin ? '' : ' Un administrador todavía puede revisarlo.'}`;
    await Promise.all(recipients.map(userId => createNotification({
        userId,
        type: 'merge_request_resolved',
        title,
        body,
        url: merged ? `/adopter/${req.primaryId}` : '/my-adopters',
        icon: ICON,
        metadata: { mergeRequestId: req.id, status, primaryId: req.primaryId, secondaryId: req.secondaryId },
    })));
}

/** Requests an admin can still act on: pending first, then declined, each oldest first. */
export async function listMergeRequestsForAdmin(db: Db): Promise<MergeRequestAdminRow[]> {
    const byStatus = (status: 'pending' | 'declined') =>
        db.select().from(mergeRequests).where(eq(mergeRequests.status, status)).orderBy(asc(mergeRequests.createdAt)).all() as Promise<RequestRow[]>;
    const [pendingRows, declinedRows] = await Promise.all([byStatus('pending'), byStatus('declined')]);
    const rows = [...pendingRows, ...declinedRows];

    const ids = [...new Set(rows.flatMap(r => [r.primaryId, r.secondaryId]))];
    const names = new Map(await Promise.all(ids.map(async id => [id, await adopterName(db, id).catch((e: unknown) => {
        logger.warn('listMergeRequestsForAdmin: D1 fallback hit', { adopterId: id, error: e instanceof Error ? e.message : String(e) });
        return '';
    })] as const)));

    return rows.map(r => ({
        id: r.id,
        status: r.status as MergeRequestStatus,
        createdAt: r.createdAt ? r.createdAt.getTime() : null,
        primary: { id: r.primaryId, name: names.get(r.primaryId) ?? '' },
        secondary: { id: r.secondaryId, name: names.get(r.secondaryId) ?? '' },
        requesterEmail: r.requesterEmail,
        ownerEmail: r.ownerEmail ?? null,
    }));
}
