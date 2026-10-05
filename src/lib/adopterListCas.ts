/**
 * Compare-and-swap writes of the JSON lists stored on an adopter row
 * (`contact_entries` + its derived `contact_info` blob, `household_members`).
 *
 * Every add / edit / remove is a read-modify-write of the WHOLE list, so two
 * people changing different entries at the same moment used to lose one of
 * them (last write wins). Here the write lands only if the list is still
 * exactly what was read; otherwise the row is re-read and the same change is
 * re-applied to the fresh list — so both survive. D1 has no multi-statement
 * transactions, hence the conditional UPDATE … RETURNING. Plain server module.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Row = typeof adopters.$inferSelect;

/** A list write is retried this many times against fresh reads before giving up. */
export const LIST_SAVE_ATTEMPTS = 3;

/** What one attempt decided: the columns to write (none = nothing to write) and the result to hand back. */
export type ListStep<R> = { write?: Partial<Pick<Row, 'contactEntries' | 'contactInfo' | 'householdMembers'>>; result: R };

export type ListCasOutcome<R> =
    | { status: 'done'; result: R; wrote: boolean; row: Row }
    | { status: 'missing' }
    | { status: 'busy'; errorId: string };

/**
 * Run `step` against the current row and write what it returns, conditional
 * on every written column (and, for contact entries, the derived blob) still
 * holding what was read. `step` must be a pure function of the row — it runs
 * again on a fresh read after a lost race.
 */
export async function casAdopterLists<R>(
    db: Db,
    adopterId: string,
    step: (row: Row) => ListStep<R>,
    ctx: Record<string, unknown> = {},
): Promise<ListCasOutcome<R>> {
    for (let attempt = 0; attempt < LIST_SAVE_ATTEMPTS; attempt++) {
        const row = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get() as Row | undefined;
        if (!row) return { status: 'missing' };
        const { write, result } = step(row);
        if (!write || !Object.keys(write).length) return { status: 'done', result, wrote: false, row };

        const conds = [eq(adopters.id, adopterId)];
        const guard = (col: 'contactEntries' | 'contactInfo' | 'householdMembers') => {
            const v = row[col];
            conds.push(v === null || v === undefined ? isNull(adopters[col]) : eq(adopters[col], v));
        };
        if ('contactEntries' in write || 'contactInfo' in write) { guard('contactEntries'); guard('contactInfo'); }
        if ('householdMembers' in write) guard('householdMembers');

        const won = await db.update(adopters).set({ ...write, updatedAt: new Date() })
            .where(and(...conds)).returning({ id: adopters.id });
        if (won.length) return { status: 'done', result, wrote: true, row };
        logger.info('casAdopterLists: lost a race, re-reading', { adopterId, attempt, ...ctx });
    }
    const errorId = logger.error('casAdopterLists: lost the race repeatedly', new Error('busy'), { adopterId, ...ctx });
    return { status: 'busy', errorId };
}
