/**
 * Builds the interview's question list (spec §4.2). Pure and deterministic:
 * the client calls it on every change and the read-only view calls it again
 * later, with the same result.
 */
import { QUESTION_BANK } from './bank';
import { deriveKnownFacts } from './facts';
import type { InterviewContext, QuestionDef, QueueItem, Stage } from './types';

export const MAX_UPCOMING = 25;
const STAGE_INDEX: Record<Stage, number> = { rapport: 0, story: 1, details: 2 };

type Ranked = QueueItem & { boost: number; priority: number };

export function buildQueue(ctx: InterviewContext, bank: readonly QuestionDef[] = QUESTION_BANK): QueueItem[] {
    const known = deriveKnownFacts(ctx, bank);
    const byId = new Map(bank.map(q => [q.id, q]));
    const customById = new Map(ctx.custom.map(c => [c.id, c]));
    const unconfirmed = !ctx.confirmedAdopterId && ctx.candidates.length > 0;
    const pool = ctx.confirmedAdopterId
        ? ctx.candidates.filter(c => c.adopterId === ctx.confirmedAdopterId)
        : ctx.candidates;

    const locked: QueueItem[] = [];
    for (const id of ctx.visited) {
        const status = ctx.answers[id]?.status;
        const q = byId.get(id);
        const c = customById.get(id);
        if (!status || (!q && !c)) continue;
        locked.push(c
            ? { id, stage: c.stage, state: status, added: { reasonKey: 'interview.reason.custom' } }
            : { id, stage: q!.stage, state: status });
    }

    const upcoming: Ranked[] = [];
    for (const c of ctx.custom) {
        if (ctx.answers[c.id]) continue;
        upcoming.push({ id: c.id, stage: c.stage, state: 'upcoming', added: { reasonKey: 'interview.reason.custom' }, boost: -1, priority: 0 });
    }
    for (const q of bank) {
        if (ctx.answers[q.id]) continue;
        let added: QueueItem['added'];
        if (q.followUpOf) {
            const parent = q.followUpOf.parents.find(p => {
                const a = ctx.answers[p];
                return a?.status === 'answered' && q.followUpOf!.test(a);
            });
            if (!parent) continue;
            added = { reasonKey: 'interview.reason.followup', parentId: parent };
        }
        if (q.when && !q.when(known, ctx)) continue;
        if (q.fills.length > 0 && q.fills.every(f => known.filled.includes(f))) continue;
        let verify: QueueItem['verify'];
        if (q.verifies) {
            const candidateIds = pool.filter(c => c.stored.includes(q.verifies!)).map(c => c.adopterId);
            if (candidateIds.length) {
                verify = { fact: q.verifies, candidateIds };
                if (!added && q.fills.length === 0) added = { reasonKey: 'interview.reason.verify' };
            } else if (q.fills.length === 0) {
                continue; // exists only to verify, and there is nothing to verify against
            }
        }
        const dedup = q.dedup === true || (q.discriminates?.(ctx.candidates) ?? false);
        upcoming.push({
            id: q.id, stage: q.stage, state: 'upcoming',
            ...(added ? { added } : {}), ...(verify ? { verify } : {}),
            boost: unconfirmed && dedup ? 0 : 1, priority: q.priority,
        });
    }

    let kept = upcoming;
    if (kept.length > MAX_UPCOMING) {
        const droppable = kept
            .filter(i => !i.added && i.boost === 1)
            // Priorities are per stage, so compare stage first: later stages give way first.
            .sort((a, b) => STAGE_INDEX[b.stage] - STAGE_INDEX[a.stage] || b.priority - a.priority || b.id.localeCompare(a.id));
        const drop = new Set(droppable.slice(0, kept.length - MAX_UPCOMING).map(i => i.id));
        kept = kept.filter(i => !drop.has(i.id));
    }
    kept.sort((a, b) =>
        STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage] || a.boost - b.boost || a.priority - b.priority || a.id.localeCompare(b.id));

    return [...locked, ...kept.map(({ boost: _b, priority: _p, ...item }) => item)];
}

/** The next unanswered question AFTER `fromId` in queue order, wrapping to the first one left. */
export function nextUpcomingId(queue: QueueItem[], fromId: string | null = null): string | null {
    const upcoming = queue.filter(i => i.state === 'upcoming');
    if (!upcoming.length) return null;
    const pos = fromId ? queue.findIndex(i => i.id === fromId) : -1;
    if (pos === -1) return upcoming[0].id;
    const after = queue.slice(pos + 1).find(i => i.state === 'upcoming');
    if (after) return after.id;
    return upcoming.find(i => i.id !== fromId)?.id ?? null;
}
