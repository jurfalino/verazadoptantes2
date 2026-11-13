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
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { adopters, animals, applications, duplicateCandidates, formSubmissions, pairUnsure } from '@/db/schema';
import { APPLICATION_ORIGINS } from '@/domain/constants';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { pairKey, realOwner } from '@/domain/dedupPair';
import { clearPairNotices, reopenPairNotices } from '@/lib/pairNotices';

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

/**
 * sidesFor, but where both profiles are the group's own, "mine" is the one a form created (the one the
 * answer is required for) — whatever order the pair's ids sort in (EM review).
 */
async function answeringSides(db: Db, actor: string, a: Side, b: Side): Promise<{ mine: Side; other: Side; otherInTeam: boolean } | null> {
    const sides = await sidesFor(actor, a, b);
    if (!sides) return null;
    if (await isFormCreated(db, sides.mine.id)) return sides;
    if (sides.otherInTeam && await isFormCreated(db, sides.other.id)) return { mine: sides.other, other: sides.mine, otherInTeam: true };
    return null;
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
    // Only where an answer is required: the actor's side is a profile a form created.
    const sides = await answeringSides(db, actor, pair.a, pair.b);
    if (!sides) return { ok: false, code: 'not_authorized' };
    const asked = askedOf(sides.otherInTeam, sides.other.addedBy);
    const me = normEmail(actor);

    const before = await teamRows(actor, await rowsOf(db, pair.key));
    const lastAsked = Math.max(0, ...before.map(r => (r.askedAt ? r.askedAt.getTime() : 0)));
    await db.insert(pairUnsure).values({ pairKey: pair.key, askerEmail: me, answeredAt: new Date(), withdrawn: 0 })
        .onConflictDoUpdate({ target: [pairUnsure.pairKey, pairUnsure.askerEmail], set: { withdrawn: 0, answeredAt: new Date() } });
    const askNow = asked === 'outside' && Date.now() - lastAsked > REASK_AFTER_MS;
    logger.info('answerPairUnsure: «No sé» recorded', { candidateId, actor, asked, askNow });
    if (askNow && await askOtherSide(db, { candidateId, actor, mine: sides.mine, other: sides.other })) {
        await db.update(pairUnsure).set({ askedAt: new Date() })
            .where(and(eq(pairUnsure.pairKey, pair.key), eq(pairUnsure.askerEmail, me)));
    } else if (asked === 'outside' && !askNow && before.length > 0 && before.every(r => r.withdrawn)) {
        // Undone and answered again within the day: the undo took the question out of their bell — put it back.
        await reopenPairNotices(db, pair.cand.a, pair.cand.b, { types: ['same_person_question'], ctx: { op: 'answerPairUnsure', candidateId, actor } });
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

/** The animal the form that created `adopterId` asks for (its application, else the form's pick); null when none. Never throws. */
async function animalAskedFor(db: Db, adopterId: string, ctx: Record<string, unknown>): Promise<string | null> {
    try {
        const row = await db.select({ appAnimal: applications.animalId, picked: formSubmissions.selectedAnimalId })
            .from(formSubmissions)
            .leftJoin(applications, and(eq(applications.submissionId, formSubmissions.id), ne(applications.origin, APPLICATION_ORIGINS.PROPOSED)))
            .where(and(eq(formSubmissions.autoAdopterId, adopterId), eq(formSubmissions.linkedAdopterId, adopterId)))
            .limit(1).get() as { appAnimal: string | null; picked: string | null } | undefined;
        const animalId = row?.appAnimal ?? row?.picked;
        if (!animalId) return null;
        const animal = await db.select({ name: animals.name }).from(animals).where(eq(animals.id, animalId)).get() as { name: string | null } | undefined;
        return animal?.name?.trim() || null;
    } catch (e) {
        logger.warn('answerPairUnsure: animal name unreadable, question sent without it', { ...ctx, adopterId, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

/** True when the question went out (so the once-a-day hold starts only then). */
async function askOtherSide(db: Db, input: { candidateId: string; actor: string; mine: Side; other: Side }): Promise<boolean> {
    const { candidateId, actor, mine, other } = input;
    try {
        const owner = realOwner(other.addedBy);
        if (!owner) return false;
        const [{ createNotification, resolveDisplayName }, { notificationContent }] = await Promise.all([
            import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
        ]);
        const [askerName, animalName] = await Promise.all([resolveDisplayName(actor), animalAskedFor(db, mine.id, { candidateId, actor })]);
        const content = notificationContent({
            key: 'same_person_question',
            params: {
                askerName, ...(mine.name ? { applicantName: mine.name } : {}), ...(other.name ? { profileName: other.name } : {}),
                ...(animalName ? { animalName } : {}),
            },
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
            createNotification({ userId, type: 'same_person_question', ...content, url: `/my-adopters?pair=${encodeURIComponent(pairKey(other.id, mine.id))}#pendientes`, icon: ICON, metadata })));
        logger.info('answerPairUnsure: other side asked', { candidateId, actor, recipients: recipients.length });
        return recipients.length > 0;
    } catch (e) {
        logger.warn('answerPairUnsure: other side not asked', { candidateId, actor, error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}

/**
 * Before a pair is settled as two people: who has a standing «No sé» on it. Never throws — an unreadable
 * table just tells nobody (logged).
 */
export async function unsureAskersOf(db: Db, a: string, b: string, ctx: Record<string, unknown> = {}, opts: { untoldOnly?: boolean } = {}): Promise<string[]> {
    if (!a || !b || a === b) return [];
    try {
        // untoldOnly: skip askers already told «es la misma persona» (a join request came first).
        const rows = await db.select({ askerEmail: pairUnsure.askerEmail }).from(pairUnsure)
            .where(and(eq(pairUnsure.pairKey, pairKey(a, b)), eq(pairUnsure.withdrawn, 0), ...(opts.untoldOnly ? [isNull(pairUnsure.sameBy)] : []))).all() as Array<{ askerEmail: string }>;
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
    a: string; b: string; actor: string; answer: 'different' | 'household' | 'same'; ctx?: Record<string, unknown>;
    /** false: keep the «No sé» rows (a join request: the pair is still open and her «No sé» keeps counting). */
    forget?: boolean;
    /** «same»: the profile the notice opens (the survivor of a join); else the other side's profile. */
    openId?: string;
}): Promise<void> {
    const { a, b, actor, answer, ctx = {}, forget = true, openId } = input;
    for (const asker of askers) {
        try {
            if (await isOwnerOrOrgMate(actor, asker)) continue;
            // «Es la misma persona» is told once: claim the asker's row first (same_by IS NULL → actor), so a join
            // request and a join — or two «Sí» — landing together never tell her twice (EM review #8).
            if (answer === 'same' && !(await claimSameTell(db, a, b, asker, actor))) continue;
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
            // «Es la misma persona»: open the profile to check (its rating, alerts); otherwise her own.
            const opens = answer === 'same' ? (openId ?? other.id) : mine.id;
            await createNotification({
                userId: asker, type: 'same_person_answered', ...content, url: `/adopter/${encodeURIComponent(opens)}`, icon: ICON,
                metadata: { askerSideId: mine.id, otherSideId: other.id },
            });
            logger.info('tellUnsureAskers: asker told', { ...ctx, a, b, actor, asker, answer });
        } catch (e) {
            logger.warn('tellUnsureAskers: asker not told', { ...ctx, a, b, actor, asker, error: e instanceof Error ? e.message : String(e) });
        }
    }
    if (!a || !b || a === b || !forget) return;
    try {
        await db.delete(pairUnsure).where(eq(pairUnsure.pairKey, pairKey(a, b)));
    } catch (e) {
        logger.warn('tellUnsureAskers: «No sé» rows left behind', { ...ctx, a, b, actor, error: e instanceof Error ? e.message : String(e) });
    }
}

/** Mark the asker told «es la misma persona» by `actor`; false when someone else already told her. */
async function claimSameTell(db: Db, a: string, b: string, asker: string, actor: string): Promise<boolean> {
    const claimed = await db.update(pairUnsure).set({ sameBy: normEmail(actor) })
        .where(and(eq(pairUnsure.pairKey, pairKey(a, b)), eq(pairUnsure.askerEmail, asker), isNull(pairUnsure.sameBy)))
        .returning({ askerEmail: pairUnsure.askerEmail }).all();
    return claimed.length > 0;
}

/**
 * The other side answered «Sí» by asking to join (createMergeRequest): tell each «No sé» asker outside the
 * actor's group, once — their «No sé» keeps counting (Jon 2026-11-12: inform, never block) and their card
 * shows who answered (`same_by`). The actor's group's question about the pair is answered: out of their bell.
 * Never throws (logged).
 */
export async function recordSameAnswer(db: Db, a: string, b: string, actor: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!a || !b || a === b) return;
    try {
        const askers = await unsureAskersOf(db, a, b, ctx, { untoldOnly: true });
        const outside: string[] = [];
        for (const asker of askers) if (!(await isOwnerOrOrgMate(actor, asker))) outside.push(asker);
        // tellUnsureAskers claims each row (same_by) before telling: once per asker, whoever answers first.
        if (outside.length) await tellUnsureAskers(db, outside, { a, b, actor, answer: 'same', forget: false, ctx });
        for (const member of await getOrgMemberEmailsFor(actor)) {
            await clearPairNotices(db, a, b, { types: ['same_person_question'], userId: member, ctx: { ...ctx, op: 'recordSameAnswer', actor } });
        }
    } catch (e) {
        logger.warn('recordSameAnswer: «No sé» askers not told', { ...ctx, a, b, actor, error: e instanceof Error ? e.message : String(e) });
    }
}

/**
 * Forget every «No sé» whose pair is no longer pending: a pair dropped without an answer (the admin Scan no
 * longer pairs them, or they became housemates) must not count again if it is detected again later. Run by
 * the Scan before it rebuilds (so a re-detected pair starts unanswered) and after its swap. One statement,
 * no parameters. Never throws (logged).
 */
export async function sweepOrphanUnsure(db: Db, ctx: Record<string, unknown> = {}): Promise<void> {
    try {
        await db.run(sql`DELETE FROM pair_unsure WHERE NOT EXISTS (
            SELECT 1 FROM duplicate_candidates c WHERE c.status = 'pending' AND pair_unsure.pair_key =
                CASE WHEN c.adopter1_id < c.adopter2_id THEN c.adopter1_id || '|' || c.adopter2_id ELSE c.adopter2_id || '|' || c.adopter1_id END)`);
    } catch (e) {
        logger.warn('sweepOrphanUnsure: stale «No sé» answers left', { ...ctx, error: e instanceof Error ? e.message : String(e) });
    }
}
