// NOT 'use server' (since the reel-11 fixes): a server-only helper called by
// actions and routes. As an export of a 'use server' module it was a
// browser-callable endpoint that checked no session. Never import this file
// from a client component.

import { getDb } from './_db';
import { users } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/** D1 caps a statement at 100 bound parameters; stay well under it. */
const CHUNK = 90;
/**
 * This is a `'use server'` export, so anyone can POST it an array. Bound the
 * work per call: no legitimate caller (a profile's editors, an animal's
 * recorders, a team's animals) comes close to this many distinct people.
 */
const MAX_UNIQUE_EMAILS = 200;

/**
 * Resolve a list of emails to user display names.
 * Returns a Record<email, name> — only includes entries where a name exists.
 * Emails match exactly as stored (case-sensitive), as before.
 *
 * D1 does not expand an array bound parameter (`inArray` → `IN (?)` with one
 * value), which silently dropped every name but the first. This builds
 * `IN (?, ?, …)` with one explicit bind per email (`sql.join`), ≤90 per
 * statement — the same shape as `resolveDisplayNames` in notifications.ts.
 * A failed chunk is logged and loses only that chunk's names; callers fall
 * back to the email handle.
 */
export async function resolveUserNames(emails: string[]): Promise<Record<string, string>> {
    let unique = [...new Set((Array.isArray(emails) ? emails : []).filter((e): e is string => typeof e === 'string' && e.length > 0))];
    if (unique.length === 0) return {};
    if (unique.length > MAX_UNIQUE_EMAILS) {
        logger.warn('resolveUserNames: too many emails, truncating', { requested: unique.length, kept: MAX_UNIQUE_EMAILS });
        unique = unique.slice(0, MAX_UNIQUE_EMAILS);
    }

    const db = await getDb();
    if (!db) return {};

    const map: Record<string, string> = {};
    for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const inList = sql.join(chunk.map(e => sql`${e}`), sql`, `);
        const rows = await db.select({ email: users.email, name: users.name })
            .from(users)
            .where(sql`${users.email} IN (${inList})`)
            .catch((e: unknown) => {
                // No addresses in the log (privacy): chunk position + size is enough to triage.
                logger.warn('resolveUserNames: D1 fallback hit', {
                    chunkStart: i, chunkSize: chunk.length, total: unique.length,
                    error: e instanceof Error ? e.message : String(e),
                });
                return [] as Array<{ email: string | null; name: string | null }>;
            });
        for (const row of rows) {
            if (row.name && row.email) map[row.email] = row.name;
        }
    }
    return map;
}
