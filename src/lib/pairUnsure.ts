/**
 * «No sé» on a form's «¿Es la misma persona?» (Jon 2026-11-12).
 *
 * The rescuer evaluating a form must answer each possible duplicate before
 * giving the person an animal (src/domain/samePersonGate.ts). «No sé» is an
 * answer FOR THE ASKER'S GROUP: the pair stays pending (the profiles stay
 * separate), and the people who loaded the OTHER profile — its owner and their
 * group, the same people a merge request asks — are asked in the bell and, per
 * their «Avisos», by email. When the other side later says they are two people,
 * the asker hears it («Responden tu pedido…»). A «Sí» goes through the usual
 * merge flow, whose own notices tell the asker.
 *
 * Stored in `pair_unsure` by pair key (sorted ids — the admin Scan rebuilds
 * duplicate_candidates with new ids) and asker. Only offered where it is
 * required: a pending, non-weak pair on a profile a form created and still
 * sits on, answered by that profile's group.
 *
 * Not a 'use server' module: the actions in duplicates.ts read the session and call in.
 */
import { and, eq } from 'drizzle-orm';
import { adopters, duplicateCandidates, formSubmissions, pairUnsure } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { pairKey, realOwner } from '@/domain/dedupPair';
import { clearPairNotices } from '@/lib/pairNotices';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type UnsureRefusal = 'not_found' | 'already_resolved' | 'not_authorized';
/** Who «No sé» asks: the other profile's people, nobody (it is the viewer's group's), or nobody (no real owner). */
export type UnsureAsked = 'outside' | 'team' | 'none';

/** Toggling «No sé» off and on asks the other side again at most once a day. */
export const REASK_AFTER_MS = 24 * 60 * 60 * 1000;

const ICON = '❓';

type Side = { id: string; name: string | null; addedBy: string | null };
type UnsureRow = { askerEmail: string; askedAt: Date | null; withdrawn: number };

async function loadPair(db: Db, candidateId: string) {
    const cand = await db.select({
        id: duplicateCandidates.id, a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id,
        status: duplicateCandidates.status, confidence: duplicateCandidates.confidence,
    }).from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
    if (!cand) return null;
    const [a, b] = await Promise.all([cand.a, cand.b].map(id =>
        db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get()));
    if (!a || !b) return null;
    return { cand, a: a as Side, b: b as Side, key: pairKey(cand.a, cand.b) };
}

/** The viewer's side (their group loaded it) and the other; null when they may answer for neither. */
async function sidesFor(actor: string, a: Side, b: Side): Promise<{ mine: Side; other: Side; otherInTeam: boolean } | null> {
    const [teamA, teamB] = await Promise.all([isOwnerOrOrgMate(actor, a.addedBy), isOwnerOrOrgMate(actor, b.addedBy)]);
    if (!teamA && !teamB) return null;
    return teamA ? { mine: a, other: b, otherInTeam: teamB } : { mine: b, other: a, otherInTeam: teamA };
}

/** A profile a form created and still sits on (formLinkKind 'new_profile'). */
async function isFormCreated(db: Db, adopterId: string): Promise<boolean> {
    const row = await db.select({ id: formSubmissions.id }).from(formSubmissions)
        .where(and(eq(formSubmissions.autoAdopterId, adopterId), eq(formSubmissions.linkedAdopterId, adopterId)))
        .limit(1).get();
    return !!row;
}

async function rowsOf(db: Db, key: string): Promise<UnsureRow[]> {
    return await db.select({ askerEmail: pairUnsure.askerEmail, askedAt: pairUnsure.askedAt, withdrawn: pairUnsure.withdrawn })
        .from(pairUnsure).where(eq(pairUnsure.pairKey, key)).all() as UnsureRow[];
}

async function teamRows(actor: string, rows: readonly UnsureRow[]): Promise<UnsureRow[]> {
    const mine = await Promise.all(rows.map(r => isOwnerOrOrgMate(actor, r.askerEmail)));
    return rows.filter((_, i) => mine[i]);
}

export function askedOf(otherInTeam: boolean, otherAddedBy: string | null): UnsureAsked {
    if (otherInTeam) return 'team';
    return realOwner(otherAddedBy) ? 'outside' : 'none';
}

/**
 * Record «No sé» for the actor (their group's answer) and ask the other side's people — unless the group
 * asked them in the last REASK_AFTER_MS. A failed notice never undoes the answer (logged).
 */
export async function answerPairUnsure(db: Db, candidateId: string, actor: string): Promise<{ ok: true; asked: UnsureAsked } | { ok: false; code: UnsureRefusal }> {
    const pair = await loadPair(db, candidateId);
    if (!pair || pair.cand.confidence === 'low') return { ok: false, code: 'not_found' };
    if (pair.cand.status !== 'pending') return { ok: false, code: 'already_resolved' };
    const sides = await sidesFor(actor, pair.a, pair.b);
    // Only where an answer is required: the actor's side is a profile a form created.
    if (!sides || !(await isFormCreated(db, sides.mine.id))) return { ok: false, code: 'not_authorized' };
    const asked = askedOf(sides.otherInTeam, sides.other.addedBy);
    const me = normEmail(actor);

    const before = await teamRows(actor, await rowsOf(db, pair.key));
    const lastAsked = Math.max(0, ...before.map(r => (r.askedAt ? r.askedAt.getTime() : 0)));
    await db.insert(pairUnsure).values({ pairKey: pair.key, askerEmail: me, answeredAt: new Date(), withdrawn: 0 })
        .onConflictDoUpdate({ target: [pairUnsure.pairKey, pairUnsure.askerEmail], set: { withdrawn: 0, answeredAt: new Date() } });
    const askNow = asked === 'outside' && Date.now() - lastAsked > REASK_AFTER_MS;
    logger.info('answerPairUnsure: «No sé» recorded', { candidateId, actor, asked, askNow });
    if (askNow) {
        await askOtherSide(db, { candidateId, actor, mine: sides.mine, other: sides.other });
        await db.update(pairUnsure).set({ askedAt: new Date() })
            .where(and(eq(pairUnsure.pairKey, pair.key), eq(pairUnsure.askerEmail, me)));
    }
    return { ok: true, asked };
}

/**
 * «Cambiar mi respuesta»: the actor's group's «No sé» is withdrawn (their contract waits again). Only the
 * asker's group may; another group's answer is untouched. With no «No sé» left on the pair, the question
 * leaves the other side's bell.
 */
export async function clearPairUnsure(db: Db, candidateId: string, actor: string): Promise<{ ok: true } | { ok: false; code: UnsureRefusal }> {
    const pair = await loadPair(db, candidateId);
    if (!pair) return { ok: false, code: 'not_found' };
    if (pair.cand.status !== 'pending') return { ok: false, code: 'already_resolved' };
    if (!(await sidesFor(actor, pair.a, pair.b))) return { ok: false, code: 'not_authorized' };
    const all = await rowsOf(db, pair.key);
    const ours = await teamRows(actor, all);
    for (const r of ours) {
        await db.update(pairUnsure).set({ withdrawn: 1 }).where(and(eq(pairUnsure.pairKey, pair.key), eq(pairUnsure.askerEmail, r.askerEmail)));
    }
    const stillAsking = all.some(r => !r.withdrawn && !ours.includes(r));
    if (!stillAsking) {
        await clearPairNotices(db, pair.cand.a, pair.cand.b, { types: ['same_person_question'], ctx: { op: 'clearPairUnsure', candidateId, actor } });
    }
    logger.info('clearPairUnsure: «No sé» withdrawn', { candidateId, actor, rows: ours.length });
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
 * Before a pair is settled as two people: who has a standing «No sé» on it. Never throws — an unreadable
 * table just tells nobody (logged).
 */
export async function unsureAskersOf(db: Db, a: string, b: string, ctx: Record<string, unknown> = {}): Promise<string[]> {
    if (!a || !b || a === b) return [];
    try {
        const rows = await db.select({ askerEmail: pairUnsure.askerEmail }).from(pairUnsure)
            .where(and(eq(pairUnsure.pairKey, pairKey(a, b)), eq(pairUnsure.withdrawn, 0))).all() as Array<{ askerEmail: string }>;
        return [...new Set(rows.map(r => r.askerEmail))];
    } catch (e) {
        logger.warn('unsureAskersOf: «No sé» askers unreadable, nobody told', { ...ctx, a, b, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/**
 * After the pair was settled as two people: tell each «No sé» asker, unless they or their group settled it,
 * then forget the pair's «No sé» rows (it is answered — a later settle tells nobody twice). Written AFTER
 * clearPairNotices (this type is not a pair-notice type, so it is never cleared with the pair). Never throws.
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
    if (!a || !b || a === b) return;
    try {
        await db.delete(pairUnsure).where(eq(pairUnsure.pairKey, pairKey(a, b)));
    } catch (e) {
        logger.warn('tellUnsureAskers: «No sé» rows left behind', { ...ctx, a, b, actor, error: e instanceof Error ? e.message : String(e) });
    }
}
