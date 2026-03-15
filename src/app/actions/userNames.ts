'use server';

import { getDb } from '@/app/actions';
import { users } from '@/db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Resolve a list of emails to user display names.
 * Returns a Record<email, name> — only includes entries where a name exists.
 */
export async function resolveUserNames(emails: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(emails.filter(Boolean))];
    if (unique.length === 0) return {};

    const db = await getDb();
    if (!db) return {};

    // D1 IN clause limit: batch in groups of 50
    const BATCH = 50;
    const map: Record<string, string> = {};

    for (let i = 0; i < unique.length; i += BATCH) {
        const batch = unique.slice(i, i + BATCH);
        const rows = await db
            .select({ email: users.email, name: users.name })
            .from(users)
            .where(inArray(users.email, batch));

        for (const row of rows) {
            if (row.name && row.email) {
                map[row.email] = row.name;
            }
        }
    }

    return map;
}
