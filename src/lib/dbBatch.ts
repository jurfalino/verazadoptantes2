/**
 * Run several write statements all-or-nothing. On Cloudflare D1 that is
 * `db.batch([...])` (one implicit transaction); the local better-sqlite3
 * database (dev, tests) has no batch, so the same statements run inside one
 * synchronous transaction there. Plain server module.
 */
import type { BatchItem } from 'drizzle-orm/batch';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function runBatch(db: Db, statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]): Promise<void> {
    if ('batch' in db && typeof db.batch === 'function') {
        await db.batch(statements);
        return;
    }
    // better-sqlite3: statements run synchronously on the one connection, so a
    // transaction around them is atomic.
    const local = db as unknown as { transaction: (fn: () => void) => void };
    local.transaction(() => {
        for (const s of statements) (s as unknown as { run: () => unknown }).run();
    });
}
