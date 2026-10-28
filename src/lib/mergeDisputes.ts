/**
 * Disputes about a merge that already happened (D50, spec 2026-10-25
 * pendientes D, addendum 2026-10-26 «one shared reality»). The owner team of
 * either profile says «No es la misma persona»; the admins see it in «Pedidos
 * de combinación» and undo the merge (the existing unmergeAdopters, by the
 * merge's audit id) or keep it; both rescuers hear the outcome. Nobody else
 * overrides the merge one-sidedly.
 *
 * A plain server module, NOT 'use server': these take the actor as an
 * argument. The browser goes through src/app/actions/mergeDisputes.ts, which
 * takes it from the session. Who may raise / resolve is decided in
 * src/domain/dedupPair.ts (decideMergeDisputeRaise, decideMergeDisputeResolution).
 * Every status change is compare-and-set.
 */

import { and, asc, eq } from 'drizzle-orm';
import { adopters, auditLog, mergeDisputes } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { unmergeAdopters } from '@/lib/adopterMerge';
import { isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { createNotification, notifyAdmins, resolveDisplayName } from '@/app/actions/notifications';
import { rowsAffected } from '@/lib/interviews/rowsAffected';
import { mergeSideParams } from '@/lib/mergeNotificationSides';
import { keepSeparate } from '@/lib/mergeRequests';
import { compareEntriesOf, pairMatchTypes, type CompareEntry } from '@/lib/mergeAdminCompare';
import { notificationContent } from '@/domain/notificationTemplates';
import {
    decideMergeDisputeRaise,
    decideMergeDisputeResolution,
    KEPT_SEPARATE_FLAG_DETAILS_PREFIX,
    realOwner,
    type MergeDisputeStatus,
} from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DisputeRow = typeof mergeDisputes.$inferSelect;

const ICON = '🔗';

/** One profile of a disputed merge, as the admin list shows it. Admin page: the owner email is shown whole. */
export interface MergeDisputeAdminSide {
    id: string;
    name: string;
    /** Who added the profile; null for an ownerless one. */
    ownerEmail: string | null;
    /** epoch ms the profile was created */
    createdAt: number | null;
    /**
     * Its contacts, whole (admin page), for «Qué coincide y qué no» (audit A4).
     * The survivor's are as they were BEFORE the merge (the merge's undo
     * snapshot): today it also carries the absorbed profile's contacts.
     */
    entries: CompareEntry[];
}

export interface MergeDisputeAdminRow {
    id: string;
    auditId: string;
    status: MergeDisputeStatus;
    /** epoch ms the dispute was raised */
    createdAt: number | null;
    raisedBy: string;
    /** Who merged (the audit row's actor); null when unreadable. */
    mergedBy: string | null;
    /** epoch ms of the merge */
    mergedAt: number | null;
    /** The profile that stayed. */
    survivor: MergeDisputeAdminSide;
    /** The profile that was absorbed (soft-deleted until an undo). */
    absorbed: MergeDisputeAdminSide;
    /** The duplicate scan's match types for the pair ([] when never scanned). */
    matchTypes: string[];
}

/** What the profile page needs to offer «¿No es la misma persona? Avisar a un administrador». */
export interface MergeDisputeOption {
    canRaise: boolean;
    /** This merge's dispute, if any. 'none' also for a viewer who may not see it. */
    status: 'none' | MergeDisputeStatus;
}

interface MergeFacts {
    auditId: string;
    survivorId: string;
    absorbedId: string;
    mergedBy: string | null;
    mergedAt: Date | null;
    undone: boolean;
    /** The survivor was itself merged away (or removed) since: this merge is superseded. */
    survivorGone: boolean;
    survivorOwner: string | null;
    absorbedOwner: string | null;
}

/** The merge behind an audit id: an `adopter_merge` audit row and its two profiles' owners. Null for anything else. */
async function loadMerge(db: Db, auditId: string): Promise<MergeFacts | null> {
    const row = await db.select().from(auditLog).where(eq(auditLog.id, auditId)).get();
    if (!row || row.action !== 'adopter_merge') return null;
    let details: { primaryId?: unknown; secondaryId?: unknown; undoneAt?: unknown };
    try {
        details = JSON.parse(row.details || '{}');
    } catch (e) {
        logger.warn('mergeDisputes: merge audit row unreadable', { auditId, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
    if (typeof details.primaryId !== 'string' || typeof details.secondaryId !== 'string') return null;
    const [survivor, absorbed] = await Promise.all([details.primaryId, details.secondaryId].map(id =>
        db.select({ addedBy: adopters.addedBy, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, id)).get()));
    return {
        auditId,
        survivorId: details.primaryId,
        absorbedId: details.secondaryId,
        mergedBy: row.userEmail ?? null,
        mergedAt: row.createdAt ?? null,
        undone: !!details.undoneAt,
        survivorGone: !survivor || !!survivor.deletedAt,
        survivorOwner: realOwner(survivor?.addedBy),
        absorbedOwner: realOwner(absorbed?.addedBy),
    };
}

/** The open dispute on a merge, else the latest decided one, else null. */
async function disputeFor(db: Db, auditId: string): Promise<DisputeRow | null> {
    const rows = await db.select().from(mergeDisputes).where(eq(mergeDisputes.auditId, auditId))
        .orderBy(asc(mergeDisputes.createdAt)).all() as DisputeRow[];
    return rows.find(r => r.status === 'open') ?? rows[rows.length - 1] ?? null;
}

/** decideMergeDisputeRaise's inputs for this viewer and merge. */
async function raiseDecision(db: Db, merge: MergeFacts, viewer: string) {
    const owners = [merge.survivorOwner, merge.absorbedOwner].filter((e): e is string => !!e);
    const [viewerOnSurvivorTeam, viewerOnAbsorbedTeam, actorTeamOwnsAll, existing] = await Promise.all([
        merge.survivorOwner ? isOwnerOrOrgMate(viewer, merge.survivorOwner) : Promise.resolve(false),
        merge.absorbedOwner ? isOwnerOrOrgMate(viewer, merge.absorbedOwner) : Promise.resolve(false),
        merge.mergedBy
            ? Promise.all(owners.map(o => isOwnerOrOrgMate(merge.mergedBy!, o))).then(all => all.every(Boolean))
            : Promise.resolve(false),
        disputeFor(db, merge.auditId),
    ]);
    const decision = decideMergeDisputeRaise({
        viewerIsActor: !!merge.mergedBy && normEmail(merge.mergedBy) === normEmail(viewer),
        viewerOnSurvivorTeam,
        viewerOnAbsorbedTeam,
        soloMerge: actorTeamOwnsAll,
        undone: merge.undone || existing?.status === 'undone',
        superseded: merge.survivorGone,
        decided: existing?.status === 'kept' || existing?.status === 'closed',
    });
    return { decision, existing };
}

/** Whether `viewer` may raise a dispute on this merge, and its current state (the profile prompt). */
export async function mergeDisputeOption(db: Db, auditId: string, viewer: string): Promise<MergeDisputeOption> {
    const merge = await loadMerge(db, auditId);
    if (!merge) return { canRaise: false, status: 'none' };
    const { decision, existing } = await raiseDecision(db, merge, viewer);
    if (!decision.ok && decision.reason === 'not_found') return { canRaise: false, status: 'none' };
    const status = existing?.status as MergeDisputeStatus | undefined ?? (merge.undone ? 'undone' : 'none');
    return { canRaise: decision.ok && status !== 'open', status };
}

/**
 * «No es la misma persona» on a merge (D50), as `actor` (resolved from the
 * session by the caller). Idempotent: an open dispute on the merge is returned
 * (`created: false`) and nobody is told again. A new one notifies the admins.
 */
export async function fileMergeDispute(db: Db, auditId: string, actor: string): Promise<
    | { ok: true; disputeId: string; created: boolean }
    | { ok: false; reason: 'not_found' | 'already_undone' | 'superseded' | 'already_decided' }
> {
    const merge = await loadMerge(db, auditId);
    if (!merge) return { ok: false, reason: 'not_found' };
    const { decision, existing } = await raiseDecision(db, merge, actor);
    if (!decision.ok) return decision;
    if (existing?.status === 'open') return { ok: true, disputeId: existing.id, created: false };

    const id = crypto.randomUUID();
    // One open dispute per merge (partial unique index): a concurrent raise loses quietly.
    await db.insert(mergeDisputes).values({
        id, auditId, survivorId: merge.survivorId, absorbedId: merge.absorbedId,
        raisedBy: normEmail(actor), createdAt: new Date(), status: 'open',
    }).onConflictDoNothing();
    const open = await db.select({ id: mergeDisputes.id }).from(mergeDisputes)
        .where(and(eq(mergeDisputes.auditId, auditId), eq(mergeDisputes.status, 'open'))).get();
    if (!open) throw new Error('merge dispute not recorded');
    const created = open.id === id;
    const ctx = { disputeId: open.id, auditId, actor, primaryId: merge.survivorId, secondaryId: merge.absorbedId };
    logger.info('fileMergeDispute: raised', { ...ctx, created });
    if (!created) return { ok: true, disputeId: open.id, created };

    // The dispute stands even if telling the admins fails.
    try {
        const [raiserName, sides] = await Promise.all([
            resolveDisplayName(actor),
            mergeSideParams(db, { survivorId: merge.survivorId, absorbedId: merge.absorbedId }),
        ]);
        await notifyAdmins({
            actorEmail: actor,
            type: 'merge_disputed',
            ...notificationContent({ key: 'merge_disputed', params: { raiserName, ...sides } }),
            url: '/admin/merge-requests',
            icon: ICON,
            metadata: { disputeId: id, auditId, primaryId: merge.survivorId, secondaryId: merge.absorbedId },
        });
    } catch (e) {
        logger.warn('fileMergeDispute: admins not notified', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
    return { ok: true, disputeId: id, created };
}

/** Compare-and-set a dispute's status: true when this call moved it from `from`. */
async function casDispute(db: Db, id: string, from: MergeDisputeStatus, to: { status: MergeDisputeStatus; resolvedBy: string | null; resolvedAt: Date | null }): Promise<boolean> {
    const res = await db.update(mergeDisputes).set(to).where(and(eq(mergeDisputes.id, id), eq(mergeDisputes.status, from))).run();
    const changed = rowsAffected(res);
    if (changed !== null) return changed > 0;
    // The driver reported no count: re-read and see whether the row is ours.
    const after = await db.select({ status: mergeDisputes.status, by: mergeDisputes.resolvedBy }).from(mergeDisputes).where(eq(mergeDisputes.id, id)).get();
    return after?.status === to.status && (after?.by ?? null) === to.resolvedBy;
}

/**
 * An admin resolves a dispute (D50): `undo` → unmergeAdopters(auditId) —
 * restoring both profiles and revoking the fold's grants — and the pair is
 * kept separate so it does not come back to anyone's list; `keep` → the merge
 * stands. The status is claimed (compare-and-set) before anything happens, so
 * resolving twice or two admins at once acts once; a failed undo puts the
 * dispute back to open. Both rescuers (each profile's owner, and whoever
 * raised it) are told — never the admin.
 */
export async function answerMergeDispute(db: Db, disputeId: string, actor: string, decision: 'undo' | 'keep'): Promise<
    | { ok: true; status: Exclude<MergeDisputeStatus, 'open'> }
    | { ok: false; reason: 'not_found' | 'not_allowed' | 'not_open' }
    | { ok: false; reason: 'undo_failed'; error: string; errorId: string }
> {
    const dispute = await db.select().from(mergeDisputes).where(eq(mergeDisputes.id, disputeId)).get() as DisputeRow | undefined;
    if (!dispute) return { ok: false, reason: 'not_found' };
    const answer = decideMergeDisputeResolution({ status: dispute.status as MergeDisputeStatus, actorIsAdmin: await isAdminAsync(actor), decision });
    if (!answer.ok) return answer;
    const ctx = { disputeId, auditId: dispute.auditId, actor, decision, primaryId: dispute.survivorId, secondaryId: dispute.absorbedId };

    // Moot: the merge was undone elsewhere (the admin duplicates page) or its
    // survivor was merged away since. Neither «separó» nor «mantuvo» would be
    // true, so it just closes — no notice.
    const merge = await loadMerge(db, dispute.auditId);
    if (!merge || merge.undone || merge.survivorGone) {
        if (!await casDispute(db, disputeId, 'open', { status: 'closed', resolvedBy: normEmail(actor), resolvedAt: new Date() })) {
            logger.warn('answerMergeDispute: lost the race', ctx);
            return { ok: false, reason: 'not_open' };
        }
        logger.info('answerMergeDispute: closed as moot', { ...ctx, undone: !!merge?.undone, survivorGone: merge?.survivorGone ?? true });
        return { ok: true, status: 'closed' };
    }

    if (!await casDispute(db, disputeId, 'open', { status: answer.nextStatus, resolvedBy: normEmail(actor), resolvedAt: new Date() })) {
        logger.warn('answerMergeDispute: lost the race', ctx);
        return { ok: false, reason: 'not_open' };
    }

    if (answer.nextStatus === 'undone') {
        const result = await unmergeAdopters(dispute.auditId, actor);
        if (!result.success) {
            const reopened = await casDispute(db, disputeId, 'undone', { status: 'open', resolvedBy: null, resolvedAt: null });
            const error = result.error ?? 'undo failed';
            const errorId = logger.error('answerMergeDispute: undo failed, dispute reopened', new Error(error), { ...ctx, reopened });
            return { ok: false, reason: 'undo_failed', error, errorId };
        }
        // An admin decided they are two people: the pair leaves both lists.
        await keepSeparate(db, { a: dispute.survivorId, b: dispute.absorbedId }, actor, `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}dispute-${disputeId}`, ctx);
    }
    logger.info('answerMergeDispute: resolved', { ...ctx, status: answer.nextStatus });

    // The outcome stands even if telling people about it fails.
    try {
        await notifyResolved(db, dispute, answer.nextStatus, actor);
    } catch (e) {
        logger.warn('answerMergeDispute: notifications not sent', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
    return { ok: true, status: answer.nextStatus };
}

async function notifyResolved(db: Db, dispute: DisputeRow, status: 'undone' | 'kept', actor: string): Promise<void> {
    const [survivor, absorbed] = await Promise.all([dispute.survivorId, dispute.absorbedId].map(id =>
        db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get()));
    const actorKey = normEmail(actor);
    const recipients = [...new Set([realOwner(survivor?.addedBy), realOwner(absorbed?.addedBy), dispute.raisedBy]
        .filter((e): e is string => !!e)
        .map(normEmail))]
        .filter(e => e && e !== actorKey);
    if (recipients.length === 0) return;
    const sides = await mergeSideParams(db, { survivorId: dispute.survivorId, absorbedId: dispute.absorbedId });
    const content = notificationContent({ key: 'merge_dispute_resolved', params: { outcome: status, ...sides } });
    await Promise.all(recipients.map(userId => createNotification({
        userId,
        type: 'merge_dispute_resolved',
        ...content,
        url: `/adopter/${dispute.survivorId}`,
        icon: ICON,
        metadata: { disputeId: dispute.id, auditId: dispute.auditId, status, primaryId: dispute.survivorId, secondaryId: dispute.absorbedId },
    })));
}

/** Open disputes, oldest first, for the admin «Disputas» list. */
export async function listMergeDisputesForAdmin(db: Db): Promise<MergeDisputeAdminRow[]> {
    const rows = await db.select().from(mergeDisputes).where(eq(mergeDisputes.status, 'open'))
        .orderBy(asc(mergeDisputes.createdAt)).all() as DisputeRow[];
    const side = async (id: string): Promise<MergeDisputeAdminSide> => {
        try {
            const r = await db.select({ name: adopters.name, addedBy: adopters.addedBy, createdAt: adopters.createdAt, contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo })
                .from(adopters).where(eq(adopters.id, id)).get();
            return { id, name: r?.name ?? '', ownerEmail: realOwner(r?.addedBy), createdAt: r?.createdAt ? r.createdAt.getTime() : null, entries: compareEntriesOf(r) };
        } catch (e) {
            logger.warn('listMergeDisputesForAdmin: D1 fallback hit', { adopterId: id, error: e instanceof Error ? e.message : String(e) });
            return { id, name: '', ownerEmail: null, createdAt: null, entries: [] };
        }
    };
    const merge = async (r: DisputeRow) => {
        try {
            return await db.select({ userEmail: auditLog.userEmail, createdAt: auditLog.createdAt, details: auditLog.details }).from(auditLog).where(eq(auditLog.id, r.auditId)).get();
        } catch (e) {
            logger.warn('listMergeDisputesForAdmin: D1 fallback hit', { disputeId: r.id, auditId: r.auditId, error: e instanceof Error ? e.message : String(e) });
            return undefined;
        }
    };
    /** The survivor's contacts before the merge folded the absorbed ones in (the merge's undo snapshot); null when unreadable. */
    const beforeMerge = (r: DisputeRow, details: string | null | undefined): CompareEntry[] | null => {
        if (!details) return null;
        try {
            const snap = (JSON.parse(details) as { undo?: { primarySnapshot?: { contactEntries?: string | null; contactInfo?: string | null } } }).undo?.primarySnapshot;
            return snap ? compareEntriesOf(snap) : null;
        } catch (e) {
            logger.warn('listMergeDisputesForAdmin: merge snapshot unreadable, showing the survivor as it is', { disputeId: r.id, auditId: r.auditId, error: e instanceof Error ? e.message : String(e) });
            return null;
        }
    };
    return Promise.all(rows.map(async (r) => {
        const [survivorRow, absorbedRow, audit, matchTypes] = await Promise.all([
            side(r.survivorId), side(r.absorbedId), merge(r),
            pairMatchTypes(db, r.survivorId, r.absorbedId, { op: 'listMergeDisputesForAdmin', disputeId: r.id }),
        ]);
        const survivor = { ...survivorRow, entries: beforeMerge(r, audit?.details) ?? survivorRow.entries };
        const absorbed = absorbedRow;
        return {
            id: r.id,
            auditId: r.auditId,
            status: r.status as MergeDisputeStatus,
            createdAt: r.createdAt ? r.createdAt.getTime() : null,
            raisedBy: r.raisedBy,
            mergedBy: audit?.userEmail ?? null,
            mergedAt: audit?.createdAt ? audit.createdAt.getTime() : null,
            survivor,
            absorbed,
            matchTypes,
        };
    }));
}
