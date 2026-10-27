/**
 * A profile's name and age, changed by anyone signed in (households as
 * profiles, Task 3 — Jon, 2026-10-27). The rules live in
 * src/domain/profileIdentity.ts; this is the write side and the notices.
 * Plain server module: every function takes the actor as an argument, so none
 * of it may ever be a browser-callable action (src/app/actions/profileIdentity.ts
 * is the session-checked door).
 *
 * - `renameProfile`: one compare-and-swap of name + contact entries + blob
 *   (the old name lands as a rename alias in the same write — never a renamed
 *   profile without its alias), then history, audit and re-tokenizing.
 * - `setProfileAge`: compare-and-swap of age / age_as_of / is_minor + history.
 * - Notices run after the response and never throw.
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { adopterFlags, adopterHistory, adopters, adoptions, notifications } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { runAfterResponse } from '@/lib/background';
import { casAdopterLists } from '@/lib/adopterListCas';
import { contactEntriesToBlob, deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { historyKindForOwner, isPrivilegedOnProfile } from '@/lib/profilePrivilege';
import { isRealActorEmail } from '@/lib/piiAccess';
import { actorNameOf, teamsOf } from '@/lib/householdNotices';
import { currentAge, isMinor } from '@/domain/households';
import { countOpenAlerts } from '@/domain/householdLinks';
import { realOwner } from '@/domain/dedupPair';
import { ageColumns, parseNameChange, renameEntries, sameName, RENAME_NOTICE_WINDOW_MS } from '@/domain/profileIdentity';
import { notificationContent, type NotificationTemplate } from '@/domain/notificationTemplates';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Ctx = Record<string, unknown>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type RenameResult =
    | { status: 'renamed'; from: string; to: string; aliasKept: boolean; historyId: string | null; ownerEmail: string | null; warningErrorId?: string;
        /** The row's other inline fields as stored at the write (for «Actualizado por …»). */
        others: { familyMembers: string | null; status: string | null } }
    | { status: 'unchanged' }
    | { status: 'conflict'; theirs: string }
    | { status: 'missing' }
    | { status: 'busy'; errorId: string };

/**
 * Rename `adopterId` from `expectedName` to `name`, as `actor`. Lands only
 * while the stored name still equals `expectedName` (else `conflict` with the
 * stored name). `undoOf`: this rename undoes that history row.
 */
export async function renameProfile(db: Db, input: {
    /** `undefined`: no baseline (a caller that does no collision check) — renames whatever is stored, still race-safe. */
    adopterId: string; name: string; expectedName: string | null | undefined; actor: string; undoOf?: string;
}): Promise<RenameResult> {
    const { adopterId, actor, undoOf } = input;
    const to = input.name.trim();
    const ctx: Ctx = { op: undoOf ? 'undoProfileRename' : 'renameProfile', adopterId, actor, ...(undoOf ? { undoOf } : {}) };
    type Step = { kind: 'conflict'; theirs: string } | { kind: 'unchanged' } | { kind: 'write'; from: string; aliasKept: boolean };
    const out = await casAdopterLists<Step>(db, adopterId, (row) => {
        // Already what I typed (a teammate typed the same): saved, nothing to write.
        if (sameName(row.name, to)) return { result: { kind: 'unchanged' } };
        if (input.expectedName !== undefined && !sameName(row.name, input.expectedName)) return { result: { kind: 'conflict', theirs: row.name ?? '' } };
        const current = deserializeContactEntries(row.contactEntries);
        const base = current.length ? current : parseBlobToContactEntries(row.contactInfo).map(e => ({ id: crypto.randomUUID(), ...e }));
        const { entries, aliasKept, changed } = renameEntries(base, { from: row.name, to, actor, newId: crypto.randomUUID() });
        // Nothing kept, upgraded or dropped: only the name is written (a legacy blob stays as it is).
        return {
            write: !changed
                ? { name: to }
                : { name: to, contactEntries: entries.length ? JSON.stringify(entries) : null, contactInfo: contactEntriesToBlob(entries) || null },
            result: { kind: 'write', from: (row.name ?? '').trim(), aliasKept },
        };
    }, ctx, { requireLive: true });

    if (out.status === 'missing') return { status: 'missing' };
    if (out.status === 'busy') return { status: 'busy', errorId: out.errorId };
    const step = out.result;
    if (step.kind === 'conflict') {
        logger.info('renameProfile: conflict — the name changed since it was loaded', ctx);
        return { status: 'conflict', theirs: step.theirs };
    }
    if (step.kind === 'unchanged') return { status: 'unchanged' };

    const ownerEmail = out.row.addedBy ?? null;
    const change = { from: step.from || null, to, aliasKept: step.aliasKept, ...(undoOf ? { undoOf } : {}) };
    let historyId: string | null = crypto.randomUUID();
    let warningErrorId: string | undefined;
    try {
        // `name` keeps the field-author lookup (conflict «por …») working; `name_changed` is what the history list reads.
        await db.insert(adopterHistory).values({
            id: historyId,
            adopterId,
            changedBy: actor,
            kind: await historyKindForOwner(actor, ownerEmail, ctx),
            changes: JSON.stringify({ name: { from: step.from || null, to }, name_changed: change }),
            changedAt: new Date(),
        });
    } catch (e) {
        // The name and its alias landed; only the history line (and so «Deshacer») is missing.
        warningErrorId = logger.error('renameProfile: renamed, but the history row failed', e, ctx);
        historyId = null;
    }
    logAudit({ userEmail: actor, action: undoOf ? 'adopter_rename_undone' : 'adopter_renamed', target: adopterId, details: change });
    try {
        const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
        await tokenizeAdopter(adopterId);
    } catch (e) {
        logger.error('renameProfile: tokenize failed (the old name stays findable once re-indexed)', e, ctx);
    }
    logger.info('renameProfile: renamed', { ...ctx, aliasKept: step.aliasKept });
    return {
        status: 'renamed', from: step.from, to, aliasKept: step.aliasKept, historyId, ownerEmail,
        others: { familyMembers: out.row.familyMembers ?? null, status: out.row.status ?? null },
        ...(warningErrorId ? { warningErrorId } : {}),
    };
}

/**
 * How many renames `actor` made since `since` (final fix S5's per-person rate
 * limit). Indexed on (changed_by, changed_at) — migration 0100.
 */
export async function renamesBySince(db: Db, actor: string, since: Date): Promise<number> {
    const row = await db.select({ n: sql<number>`COUNT(*)` }).from(adopterHistory).where(and(
        eq(adopterHistory.changedBy, actor),
        gte(adopterHistory.changedAt, since),
        sql`json_extract(${adopterHistory.changes}, '$.name_changed') IS NOT NULL`,
        // Undoing renames never counts: a team cleaning up a flood can still rename.
        sql`json_extract(${adopterHistory.changes}, '$.name_changed.undoOf') IS NULL`,
    )).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
}

export type UndoState =
    | { status: 'can_undo'; adopterId: string; from: string; to: string; renamer: string | null; ownerEmail: string | null }
    | { status: 'not_found' | 'not_undoable' | 'not_authorized' | 'already_undone' | 'superseded'; adopterId?: string };

/**
 * The history row this undo references, whether it was already undone, and
 * whether `viewer` may undo it. Permission comes first: an unknown id, a gone
 * profile and someone else's profile all answer `not_authorized`, so the
 * answer never tells a stranger whether a history id exists.
 */
export async function renameUndoState(db: Db, historyId: string, viewer: string): Promise<UndoState> {
    const row = await db.select().from(adopterHistory).where(eq(adopterHistory.id, historyId)).get() as typeof adopterHistory.$inferSelect | undefined;
    if (!row) return { status: 'not_authorized' };
    const adopterId = row.adopterId;
    const profile = await db.select({ name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
        .from(adopters).where(eq(adopters.id, adopterId)).get() as { name: string | null; addedBy: string | null; deletedAt: Date | null } | undefined;
    if (!profile || profile.deletedAt || !(await isPrivilegedOnProfile(viewer, profile.addedBy))) return { status: 'not_authorized' };
    const change = parseNameChange(row.changes);
    if (!change || change.undoOf || change.to === null) return { status: 'not_undoable', adopterId };
    if (await isUndone(db, adopterId, historyId)) return { status: 'already_undone', adopterId };
    if (!sameName(profile.name, change.to)) return { status: 'superseded', adopterId };
    return { status: 'can_undo', adopterId, from: change.from ?? '', to: change.to, renamer: row.changedBy ?? null, ownerEmail: profile.addedBy };
}

async function isUndone(db: Db, adopterId: string, historyId: string): Promise<boolean> {
    const hit = await db.select({ id: adopterHistory.id }).from(adopterHistory).where(and(
        eq(adopterHistory.adopterId, adopterId),
        sql`json_extract(${adopterHistory.changes}, '$.name_changed.undoOf') = ${historyId}`,
    )).limit(1).get();
    return !!hit;
}

export type UndoResult =
    | { status: 'undone'; adopterId: string; restored: string; reverted: string; warningErrorId?: string }
    | { status: 'not_found' | 'not_undoable' | 'not_authorized' | 'already_undone' | 'superseded'; adopterId?: string }
    | { status: 'busy'; errorId: string };

/** Undo the rename `historyId` as `actor` (owner team, admin or moderator): name restored, the reverted name kept as a rename alias, the renamer told. */
export async function undoRename(db: Db, historyId: string, actor: string): Promise<UndoResult> {
    const state = await renameUndoState(db, historyId, actor);
    if (state.status !== 'can_undo') return state;
    const res = await renameProfile(db, { adopterId: state.adopterId, name: state.from, expectedName: state.to, actor, undoOf: historyId });
    if (res.status === 'busy') return res;
    if (res.status === 'missing') return { status: 'not_found', adopterId: state.adopterId };
    if (res.status === 'conflict' || res.status === 'unchanged') {
        // Someone renamed (or undid) in between.
        return { status: (await isUndone(db, state.adopterId, historyId)) ? 'already_undone' : 'superseded', adopterId: state.adopterId };
    }
    await notifyRenameUndone(db, { adopterId: state.adopterId, actor, renamer: state.renamer, restored: res.to, reverted: res.from });
    return { status: 'undone', adopterId: state.adopterId, restored: res.to, reverted: res.from, ...(res.warningErrorId ? { warningErrorId: res.warningErrorId } : {}) };
}

/** Records on the profile, or open alerts — what a minor must not have. */
export async function profileHasActivity(db: Db, adopterId: string): Promise<boolean> {
    const [record, flags] = await Promise.all([
        db.select({ id: adoptions.id }).from(adoptions).where(eq(adoptions.adopterId, adopterId)).limit(1).get(),
        db.select({ reason: adopterFlags.reason, targetAdopterId: adopterFlags.targetAdopterId, details: adopterFlags.details })
            .from(adopterFlags).where(eq(adopterFlags.adopterId, adopterId)).orderBy(desc(adopterFlags.createdAt)).limit(50).all(),
    ]);
    if (record) return true;
    return countOpenAlerts((flags as Array<{ reason: string | null; targetAdopterId: string | null; details: string | null }>)
        .map(f => ({ adopterId, ...f }))) > 0;
}

export type AgeResult =
    | { status: 'changed'; from: { age: number | null; minor: boolean }; to: { age: number | null; minor: boolean }; name: string; ownerEmail: string | null; historyId: string | null; warningErrorId?: string }
    | { status: 'unchanged' }
    | { status: 'missing' }
    | { status: 'has_activity' }
    /** Final fix P1: the age / box shown when the form opened is no longer what is stored. */
    | { status: 'conflict' }
    | { status: 'busy'; errorId: string };

/**
 * Set the age (as told today) and «Es menor de edad». With an age the box
 * follows it; the box counts only with no age. Marking a profile minor is
 * refused while it has records or open alerts: a minor's profile hides the
 * «¿Qué pasó con …?» actions and refuses new records, so marking an adult with
 * a history as a child would bury it (anyone signed in can change an age).
 * The activity check and the write are not atomic: a record landing in
 * between can end up on a profile just marked minor. That is the rare,
 * harmless side — the AUTHORITATIVE rule is the other way round: every record
 * and alert insert refuses a minor (src/lib/minors.ts), so nothing new lands
 * on a minor once the mark is in.
 */
export async function setProfileAge(db: Db, input: {
    adopterId: string; age: number | null; isMinor: boolean; actor: string; today?: Date;
    /** What the form showed (the age counted up to then, and «menor»); a different stored value is a conflict. */
    expected?: { age: number | null; isMinor: boolean };
}): Promise<AgeResult> {
    const { adopterId, actor } = input;
    const today = input.today ?? new Date();
    const ctx: Ctx = { op: 'setProfileAge', adopterId, actor };
    const next = ageColumns(input.age, input.isMinor, today);
    const nextMinor = isMinor(next, today);
    for (let attempt = 0; attempt < 2; attempt++) {
        const row = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get() as typeof adopters.$inferSelect | undefined;
        if (!row || row.deletedAt) return { status: 'missing' };
        const was = { age: currentAge(row, today), minor: isMinor(row, today) };
        if (was.age === next.age && was.minor === nextMinor && (next.age !== null || !!row.isMinor === !!next.isMinor)) return { status: 'unchanged' };
        // A birthday passing while the form is open reads as a change too: the safe side (shown, never overwritten).
        if (input.expected && (input.expected.age !== was.age || input.expected.isMinor !== was.minor)) {
            logger.info('setProfileAge: conflict — the age changed since the form opened', ctx);
            return { status: 'conflict' };
        }
        if (nextMinor && !was.minor && await profileHasActivity(db, adopterId)) {
            logger.info('setProfileAge: refused — the profile has records or alerts', ctx);
            return { status: 'has_activity' };
        }
        const won = await db.update(adopters).set({ age: next.age, ageAsOf: next.ageAsOf, isMinor: next.isMinor, updatedAt: new Date() })
            .where(and(
                eq(adopters.id, adopterId), isNull(adopters.deletedAt),
                row.age === null ? isNull(adopters.age) : eq(adopters.age, row.age),
                row.ageAsOf === null ? isNull(adopters.ageAsOf) : eq(adopters.ageAsOf, row.ageAsOf),
                eq(adopters.isMinor, row.isMinor ?? 0),
            )).returning({ id: adopters.id });
        if (!won.length) continue;

        const to = { age: next.age, minor: nextMinor };
        let historyId: string | null = crypto.randomUUID();
        let warningErrorId: string | undefined;
        try {
            await db.insert(adopterHistory).values({
                id: historyId, adopterId, changedBy: actor,
                kind: await historyKindForOwner(actor, row.addedBy, ctx),
                changes: JSON.stringify({ age_changed: { from: was, to } }),
                changedAt: new Date(),
            });
        } catch (e) {
            warningErrorId = logger.error('setProfileAge: changed, but the history row failed', e, ctx);
            historyId = null;
        }
        logAudit({ userEmail: actor, action: 'adopter_age_changed', target: adopterId, details: { from: was, to } });
        logger.info('setProfileAge: changed', { ...ctx, minor: to.minor });
        return { status: 'changed', from: was, to, name: row.name ?? '', ownerEmail: row.addedBy ?? null, historyId, ...(warningErrorId ? { warningErrorId } : {}) };
    }
    const errorId = logger.error('setProfileAge: lost the race twice', new Error('busy'), ctx);
    return { status: 'busy', errorId };
}

// ── Notices ─────────────────────────────────────────────────────

async function sendTo(recipients: Map<string, string>, type: string, template: NotificationTemplate, metadata: Record<string, unknown>, icon: string, ctx: Ctx) {
    if (recipients.size === 0) {
        logger.info(`profileIdentity: ${type} — no recipients`, ctx);
        return;
    }
    const { createNotification } = await import('@/app/actions/notifications');
    const content = notificationContent(template);
    await Promise.all([...recipients].map(([userId, profileId]) => createNotification({
        userId, type, ...content, url: `/adopter/${profileId}`, icon, metadata: { ...metadata, adopterId: profileId, profileId },
    })));
    logger.info(`profileIdentity: ${type} sent`, { ...ctx, recipients: recipients.size });
}

/**
 * Is the actor on the profile's team (owner or org-mate)? Their own edits are
 * not news to the team (D54: the contribution notice keys on team, not on
 * privilege — an admin from outside the team still notifies). A failed check
 * counts as "not on the team": an extra notice, never a missed one (logged).
 */
async function actorOnTeam(actor: string, ownerEmail: string | null, ctx: Ctx): Promise<boolean> {
    try {
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        return await isOwnerOrOrgMate(actor, ownerEmail);
    } catch (e) {
        logger.warn('profileIdentity: team check failed, the owner team is told', { ...ctx, error: errMsg(e) });
        return false;
    }
}

/** Who a contract signature's write-back is credited to (src/app/api/contract/[id]/submit). */
export const CONTRACT_SIGNER_ACTOR = 'contract-signed-via-invitation';

/**
 * A contract signature renamed the profile (the signer's own name, final fix
 * S7): the rename's history row — credited to the signature, «Deshacer» for
 * the owner's team — then the same notice as any rename, titled for the
 * signature. The name and its alias already landed (contactUpdateOnSign);
 * failures here are logged and never fail the signature.
 */
export async function recordSignerRename(db: Db, r: { adopterId: string; ownerEmail: string | null; from: string | null; to: string; aliasKept: boolean }): Promise<void> {
    const ctx: Ctx = { op: 'recordSignerRename', adopterId: r.adopterId };
    let historyId: string | null = crypto.randomUUID();
    try {
        await db.insert(adopterHistory).values({
            id: historyId,
            adopterId: r.adopterId,
            changedBy: CONTRACT_SIGNER_ACTOR,
            kind: await historyKindForOwner(CONTRACT_SIGNER_ACTOR, r.ownerEmail, ctx),
            changes: JSON.stringify({ name: { from: r.from || null, to: r.to }, name_changed: { from: r.from || null, to: r.to, aliasKept: r.aliasKept } }),
            changedAt: new Date(),
        });
    } catch (e) {
        logger.error('recordSignerRename: rename history row failed (the name and its alias landed)', e, ctx);
        historyId = null;
    }
    await notifyProfileRenamed(db, { adopterId: r.adopterId, actor: CONTRACT_SIGNER_ACTOR, ownerEmail: r.ownerEmail, from: r.from ?? '', to: r.to, historyId, viaContract: true });
}

/** The owner's team hears about a rename by someone outside it, with «Deshacer» (`metadata.undo`). */
export async function notifyProfileRenamed(db: Db, n: { adopterId: string; actor: string; ownerEmail: string | null; from: string; to: string; historyId: string | null; viaContract?: boolean }): Promise<void> {
    const ctx: Ctx = { op: 'notifyProfileRenamed', adopterId: n.adopterId, actor: n.actor };
    if (await actorOnTeam(n.actor, n.ownerEmail, ctx)) {
        logger.info('profileIdentity: renamed by the owner team — no notice', ctx);
        return;
    }
    await runAfterResponse('profileIdentity.renamed', async () => {
        try {
            // A signature names no rescuer: the signer (the new name) stands in for the actor.
            const actorName = n.viaContract ? n.to : await actorNameOf(n.actor, ctx);
            const template: NotificationTemplate = { key: 'profile_renamed', params: { actorName, fromName: n.from || undefined, toName: n.to, ...(n.viaContract ? { viaContract: '1' } : {}) } };
            const metadata = n.historyId ? { undo: { historyId: n.historyId } } : {};
            if (!realOwner(n.ownerEmail)) {
                // Nobody owns it (imported / anonymous): the admins are its team — they can undo.
                const { notifyAdmins } = await import('@/app/actions/notifications');
                await notifyAdmins({
                    actorEmail: n.actor, type: 'profile_renamed', ...notificationContent(template),
                    url: `/adopter/${n.adopterId}`, icon: '✏️', metadata: { ...metadata, adopterId: n.adopterId, profileId: n.adopterId },
                });
                logger.info('profileIdentity: profile_renamed sent to the admins (no owner)', ctx);
                return;
            }
            const recipients = await teamsOf(db, [n.adopterId], n.actor, new Set(), ctx);
            const renamerKey = await renamerKeyOf(n.actor);
            // Final fix S5: the same person's next renames of this profile within the
            // window update this teammate's notice in place — no second notice, no second email.
            const fresh = new Map<string, string>();
            await Promise.all([...recipients].map(async ([userId, profileId]) => {
                if (!(await collapseRenameNotice(db, { userId, profileId, renamerKey, actorName, to: n.to, historyId: n.historyId }, ctx))) fresh.set(userId, profileId);
            }));
            await sendTo(fresh, 'profile_renamed', template, { ...metadata, renamerKey }, '✏️', ctx);
        } catch (e) {
            logger.warn('profileIdentity: rename notice failed', { ...ctx, error: errMsg(e) });
        }
    }, ctx);
}

/** A non-reversible key for who renamed (the notice's metadata never carries another rescuer's email). */
async function renamerKeyOf(actor: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rename-notice:${actor.trim().toLowerCase()}`));
    return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The recipient's «cambió el nombre» notice of the same renamer and profile from
 * the last RENAME_NOTICE_WINDOW_MS, updated in place: the name it was before the
 * first of these renames → the latest name, «Deshacer» on the latest rename,
 * unread again. True when collapsed. A failed read or write is logged and
 * answered false (a fresh notice is sent: an extra one, never a missed one).
 */
async function collapseRenameNotice(
    db: Db,
    c: { userId: string; profileId: string; renamerKey: string; actorName: string; to: string; historyId: string | null },
    ctx: Ctx,
): Promise<boolean> {
    try {
        const since = new Date(Date.now() - RENAME_NOTICE_WINDOW_MS);
        const prev = await db.select({ id: notifications.id, metadata: notifications.metadata }).from(notifications).where(and(
            eq(notifications.userId, c.userId),
            eq(notifications.type, 'profile_renamed'),
            gte(notifications.createdAt, since),
            sql`json_extract(${notifications.metadata}, '$.profileId') = ${c.profileId}`,
            sql`json_extract(${notifications.metadata}, '$.renamerKey') = ${c.renamerKey}`,
        )).orderBy(desc(notifications.createdAt)).limit(1).get() as { id: string; metadata: string | null } | undefined;
        if (!prev) return false;
        let meta: Record<string, unknown> = {};
        try { meta = prev.metadata ? JSON.parse(prev.metadata) as Record<string, unknown> : {}; } catch { meta = {}; }
        const params = ((meta.template as { params?: Record<string, unknown> } | undefined)?.params) ?? {};
        const firstFrom = typeof params.fromName === 'string' && params.fromName ? params.fromName : undefined;
        const viaContract = typeof params.viaContract === 'string' ? { viaContract: params.viaContract } : {};
        const template: NotificationTemplate = { key: 'profile_renamed', params: { actorName: c.actorName, fromName: firstFrom, toName: c.to, ...viaContract } };
        const content = notificationContent(template);
        const { undo: _oldUndo, ...rest } = meta;
        void _oldUndo;
        const next = { ...rest, ...(c.historyId ? { undo: { historyId: c.historyId } } : {}), template };
        await db.update(notifications).set({ title: content.title, body: content.body, metadata: JSON.stringify(next), read: 0, dismissed: 0 })
            .where(eq(notifications.id, prev.id)).run();
        logger.info('profileIdentity: profile_renamed collapsed into the recent notice', { ...ctx, notificationId: prev.id });
        return true;
    } catch (e) {
        logger.warn('profileIdentity: rename notice collapse failed, a fresh notice is sent', { ...ctx, error: errMsg(e) });
        return false;
    }
}

/** The renamer hears their change was undone (unless they undid it themselves). */
export async function notifyRenameUndone(db: Db, n: { adopterId: string; actor: string; renamer: string | null; restored: string; reverted: string }): Promise<void> {
    const ctx: Ctx = { op: 'notifyRenameUndone', adopterId: n.adopterId, actor: n.actor };
    const renamer = n.renamer?.trim().toLowerCase() ?? '';
    if (!isRealActorEmail(renamer) || renamer === n.actor.trim().toLowerCase()) {
        logger.info('profileIdentity: rename undone — nobody else to tell', ctx);
        return;
    }
    await runAfterResponse('profileIdentity.undone', async () => {
        try {
            const actorName = await actorNameOf(n.actor, ctx);
            await sendTo(new Map([[renamer, n.adopterId]]), 'profile_rename_undone',
                { key: 'profile_rename_undone', params: { actorName, restoredName: n.restored || undefined, revertedName: n.reverted || undefined } },
                {}, '↩️', ctx);
        } catch (e) {
            logger.warn('profileIdentity: undo notice failed', { ...ctx, error: errMsg(e) });
        }
    }, ctx);
}

/** The owner's team hears about an age change by someone outside it. */
export async function notifyProfileAgeChanged(db: Db, n: { adopterId: string; actor: string; ownerEmail: string | null; name: string; age: number | null; minor: boolean }): Promise<void> {
    const ctx: Ctx = { op: 'notifyProfileAgeChanged', adopterId: n.adopterId, actor: n.actor };
    if (await actorOnTeam(n.actor, n.ownerEmail, ctx)) {
        logger.info('profileIdentity: age changed by the owner team — no notice', ctx);
        return;
    }
    await runAfterResponse('profileIdentity.age', async () => {
        try {
            const [recipients, actorName] = await Promise.all([teamsOf(db, [n.adopterId], n.actor, new Set(), ctx), actorNameOf(n.actor, ctx)]);
            await sendTo(recipients, 'profile_age_changed',
                { key: 'profile_age_changed', params: { actorName, personName: n.name || undefined, ...(n.age !== null ? { age: String(n.age) } : {}), ...(n.minor ? { minor: '1' } : {}) } },
                {}, '🎂', ctx);
        } catch (e) {
            logger.warn('profileIdentity: age notice failed', { ...ctx, error: errMsg(e) });
        }
    }, ctx);
}
