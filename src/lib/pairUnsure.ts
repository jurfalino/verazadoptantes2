/**
 * «No sé» on a form's «¿Es la misma persona?» (Jon 2026-11-12).
 *
 * The rescuer evaluating a form must answer each possible duplicate before
 * giving the person an animal (src/domain/samePersonGate.ts). «No sé» is an
 * answer: the pair stays pending (the profiles stay separate), and the people
 * who loaded the OTHER profile — its owner and their group, the same people a
 * merge request asks — are asked in the bell and, per their «Avisos», by email.
 * When the other side later says they are two people, the asker hears it
 * («Responden tu pedido…»). A «Sí» goes through the usual merge flow, whose
 * own notices tell the asker.
 *
 * Not a 'use server' module: the actions in duplicates.ts authorize and call in.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { adopters, duplicateCandidates } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { realOwner } from '@/domain/dedupPair';
import { rowsAffected } from '@/lib/interviews/rowsAffected';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type UnsureRefusal = 'not_found' | 'already_resolved' | 'not_authorized';
/** Who was asked: the other profile's people, nobody (it is the viewer's group's), or nobody (it has no real owner). */
export type UnsureAsked = 'outside' | 'team' | 'none';

const ICON = '❓';

type Side = { id: string; name: string | null; addedBy: string | null };

async function loadPair(db: Db, candidateId: string) {
    const cand = await db.select({
        id: duplicateCandidates.id, a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id,
        status: duplicateCandidates.status, unsureBy: duplicateCandidates.unsureBy,
    }).from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
    if (!cand) return null;
    const [a, b] = await Promise.all([cand.a, cand.b].map(id =>
        db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get()));
    if (!a || !b) return null;
    return { cand, a: a as Side, b: b as Side };
}

/** The viewer's side (their group loaded it) and the other; null when they may answer for neither. */
async function sidesFor(actor: string, a: Side, b: Side): Promise<{ mine: Side; other: Side; otherInTeam: boolean } | null> {
    const [teamA, teamB] = await Promise.all([isOwnerOrOrgMate(actor, a.addedBy), isOwnerOrOrgMate(actor, b.addedBy)]);
    if (!teamA && !teamB) return null;
    return teamA ? { mine: a, other: b, otherInTeam: teamB } : { mine: b, other: a, otherInTeam: teamA };
}

export function askedOf(otherInTeam: boolean, otherAddedBy: string | null): UnsureAsked {
    if (otherInTeam) return 'team';
    return realOwner(otherAddedBy) ? 'outside' : 'none';
}

/**
 * Record «No sé» on a pending pair the actor's group loaded a side of, and ask the other side's people.
 * Answering again (already «No sé») changes nothing and asks nobody twice. A failed notice never undoes
 * the answer (logged).
 */
export async function answerPairUnsure(db: Db, candidateId: string, actor: string): Promise<{ ok: true; asked: UnsureAsked } | { ok: false; code: UnsureRefusal }> {
    const pair = await loadPair(db, candidateId);
    if (!pair) return { ok: false, code: 'not_found' };
    if (pair.cand.status !== 'pending') return { ok: false, code: 'already_resolved' };
    const sides = await sidesFor(actor, pair.a, pair.b);
    if (!sides) return { ok: false, code: 'not_authorized' };
    const asked = askedOf(sides.otherInTeam, sides.other.addedBy);

    // Compare-and-set: only the first «No sé» writes, so two taps (or two teammates) ask once.
    const res = await db.update(duplicateCandidates)
        .set({ unsureBy: normEmail(actor), unsureAt: new Date() })
        .where(and(eq(duplicateCandidates.id, candidateId), eq(duplicateCandidates.status, 'pending'), isNull(duplicateCandidates.unsureBy)))
        .run();
    const changed = rowsAffected(res);
    const wrote = changed === null ? !pair.cand.unsureBy : changed > 0;
    logger.info('answerPairUnsure: «No sé» recorded', { candidateId, actor, asked, wrote });
    if (wrote && asked === 'outside') {
        await askOtherSide(db, { candidateId, actor, mine: sides.mine, other: sides.other });
    }
    return { ok: true, asked };
}

/** «Cambiar mi respuesta»: the pair is unanswered again (the contract waits again). Anyone in either side's group may. */
export async function clearPairUnsure(db: Db, candidateId: string, actor: string): Promise<{ ok: true } | { ok: false; code: UnsureRefusal }> {
    const pair = await loadPair(db, candidateId);
    if (!pair) return { ok: false, code: 'not_found' };
    if (pair.cand.status !== 'pending') return { ok: false, code: 'already_resolved' };
    if (!(await sidesFor(actor, pair.a, pair.b))) return { ok: false, code: 'not_authorized' };
    await db.update(duplicateCandidates).set({ unsureBy: null, unsureAt: null }).where(eq(duplicateCandidates.id, candidateId));
    logger.info('clearPairUnsure: «No sé» withdrawn', { candidateId, actor });
    return { ok: true };
}

async function askOtherSide(db: Db, input: { candidateId: string; actor: string; mine: Side; other: Side }): Promise<void> {
    const { candidateId, actor, mine, other } = input;
    try {
        const owner = realOwner(other.addedBy);
        if (!owner) return;
        const [{ createNotification, resolveDisplayName }, { notificationContent }] = await Promise.all([
            import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
        ]);
        const askerName = await resolveDisplayName(actor);
        const content = notificationContent({
            key: 'same_person_question',
            params: { askerName, ...(mine.name ? { applicantName: mine.name } : {}), ...(other.name ? { profileName: other.name } : {}) },
        });
        // primaryId/secondaryId: clearPairNotices reads them, so settling the pair clears the question everywhere.
        const metadata = { candidateId, primaryId: other.id, secondaryId: mine.id };
        const actorKey = normEmail(actor);
        const seen = new Set<string>();
        const recipients = (await getOrgMemberEmailsFor(owner)).filter(email => {
            const key = normEmail(email);
            if (!key || key === actorKey || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        await Promise.all(recipients.map(userId =>
            createNotification({ userId, type: 'same_person_question', ...content, url: '/my-adopters#pendientes', icon: ICON, metadata })));
        logger.info('answerPairUnsure: other side asked', { candidateId, actor, recipients: recipients.length });
    } catch (e) {
        logger.warn('answerPairUnsure: other side not asked', { candidateId, actor, error: e instanceof Error ? e.message : String(e) });
    }
}

/**
 * Before a pair is settled as two people: who answered «No sé» on its pending row(s). Never throws — an
 * unreadable row just tells nobody (logged).
 */
export async function unsureAskersOf(db: Db, a: string, b: string, ctx: Record<string, unknown> = {}): Promise<string[]> {
    if (!a || !b || a === b) return [];
    try {
        const rows = await db.select({ unsureBy: duplicateCandidates.unsureBy }).from(duplicateCandidates).where(and(
            eq(duplicateCandidates.status, 'pending'),
            or(
                and(eq(duplicateCandidates.adopter1Id, a), eq(duplicateCandidates.adopter2Id, b)),
                and(eq(duplicateCandidates.adopter1Id, b), eq(duplicateCandidates.adopter2Id, a)),
            ),
        )).all() as Array<{ unsureBy: string | null }>;
        return [...new Set(rows.map(r => r.unsureBy).filter((e): e is string => !!e))];
    } catch (e) {
        logger.warn('unsureAskersOf: «No sé» askers unreadable, nobody told', { ...ctx, a, b, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/**
 * After the pair was settled as two people: tell each «No sé» asker, unless they or their group settled it.
 * Written AFTER clearPairNotices (this type is not a pair-notice type, so it is never cleared with the pair).
 * Never throws (logged).
 */
export async function tellUnsureAskers(db: Db, askers: readonly string[], input: {
    a: string; b: string; actor: string; answer: 'different' | 'household'; ctx?: Record<string, unknown>;
}): Promise<void> {
    const { a, b, actor, answer, ctx = {} } = input;
    for (const asker of askers) {
        try {
            if (await isOwnerOrOrgMate(actor, asker)) continue;
            const [sa, sb] = await Promise.all([a, b].map(id =>
                db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get()));
            if (!sa || !sb) continue;
            const askerSideIsA = await isOwnerOrOrgMate(asker, sa.addedBy);
            const [mine, other] = askerSideIsA ? [sa, sb] : [sb, sa];
            const [{ createNotification, resolveDisplayName }, { notificationContent }] = await Promise.all([
                import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
            ]);
            const answererName = await resolveDisplayName(actor);
            const content = notificationContent({
                key: 'same_person_answered',
                params: { answererName, answer, ...(mine.name ? { applicantName: mine.name } : {}), ...(other.name ? { profileName: other.name } : {}) },
            });
            await createNotification({
                userId: asker, type: 'same_person_answered', ...content, url: `/adopter/${encodeURIComponent(mine.id)}`, icon: ICON,
                metadata: { askerSideId: mine.id, otherSideId: other.id },
            });
            logger.info('tellUnsureAskers: asker told', { ...ctx, a, b, actor, asker, answer });
        } catch (e) {
            logger.warn('tellUnsureAskers: asker not told', { ...ctx, a, b, actor, asker, error: e instanceof Error ? e.message : String(e) });
        }
    }
}

/**
 * The admin Scan rebuilds every pending pair (new rows in `rebuildingStatus`, then the old pending rows
 * go). A «No sé» must survive it, or the rescuer's «Enviar contrato» locks again: copy each one onto the
 * same pair's new row, in either orientation. One statement, no per-row parameters. Never throws (logged):
 * the scan stands.
 */
export async function carryUnsureAnswers(db: Db, rebuildingStatus: string): Promise<void> {
    try {
        const same = sql`((p.adopter1_id = r.adopter1_id AND p.adopter2_id = r.adopter2_id) OR (p.adopter1_id = r.adopter2_id AND p.adopter2_id = r.adopter1_id))`;
        const answered = sql`p.status = 'pending' AND p.unsure_by IS NOT NULL AND ${same}`;
        await db.run(sql`UPDATE duplicate_candidates AS r
            SET unsure_by = (SELECT p.unsure_by FROM duplicate_candidates p WHERE ${answered} LIMIT 1),
                unsure_at = (SELECT p.unsure_at FROM duplicate_candidates p WHERE ${answered} LIMIT 1)
            WHERE r.status = ${rebuildingStatus}
              AND EXISTS (SELECT 1 FROM duplicate_candidates p WHERE ${answered})`);
    } catch (e) {
        logger.warn('carryUnsureAnswers: «No sé» answers not carried over', { rebuildingStatus, error: e instanceof Error ? e.message : String(e) });
    }
}
