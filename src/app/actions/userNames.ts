'use server';

import { getDb } from './_db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * Resolve a list of emails to user display names.
 * Returns a Record<email, name> — only includes entries where a name exists.
 *
 * D1 does not expand an array bound parameter (`inArray` → `IN (?)` with one
 * value), so this fans out one `eq` per distinct email. The previous
 * `inArray` version matched at most one email per batch and silently dropped
 * every other name. A failed lookup is logged and that email falls back to
 * the caller's own default (the email handle); it never loses the others.
 */
export async function resolveUserNames(emails: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(emails.filter(Boolean))];
    if (unique.length === 0) return {};

    const db = await getDb();
    if (!db) return {};

    const rows = (await Promise.all(unique.map((email, index) =>
        db.select({ email: users.email, name: users.name })
            .from(users)
            .where(eq(users.email, email))
            .catch((e: unknown) => {
                // No address in the log (privacy): position + batch size is enough to triage.
                logger.warn('resolveUserNames: D1 fallback hit', {
                    index, count: unique.length,
                    error: e instanceof Error ? e.message : String(e),
                });
                return [] as Array<{ email: string | null; name: string | null }>;
            }),
    ))).flat();

    const map: Record<string, string> = {};
    for (const row of rows) {
        if (row.name && row.email) map[row.email] = row.name;
    }
    return map;
}
