'use server';
import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters } from '@/db/schema';
import { isRealActorEmail } from '@/lib/piiAccess';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { logger } from '@/lib/logger';

export interface MatchContext {
    ok: boolean;
    name: string | null;
    has: { phone: boolean; email: boolean; id: boolean; social: boolean; address: boolean };
}

/** Presence-only summary of an existing adopter's contact types — for the import
 *  "por qué" panel. Returns booleans, NEVER the values (the record may be protected),
 *  so it can't leak PII while still explaining why a match scored low. */
export async function getMatchContext(adopterId: string): Promise<MatchContext> {
    const empty = { ok: false, name: null, has: { phone: false, email: false, id: false, social: false, address: false } };
    let actor = '';
    try { actor = await getUser(); } catch { /* anon */ }
    if (!isRealActorEmail(actor)) return empty;
    try {
        const db = await getDb();
        if (!db) return empty;
        const row = await db.select({ name: adopters.name, contactEntries: adopters.contactEntries })
            .from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!row) return empty;
        const has = { phone: false, email: false, id: false, social: false, address: false };
        for (const e of deserializeContactEntries(row.contactEntries)) {
            if (!e.value?.trim()) continue;
            if (e.type === 'phone') has.phone = true;
            else if (e.type === 'email') has.email = true;
            else if (e.type === 'id') has.id = true;
            else if (e.type === 'social') has.social = true;
            else if (e.type === 'address') has.address = true;
        }
        return { ok: true, name: row.name, has };
    } catch (e) {
        logger.warn('getMatchContext failed', { adopterId, error: e instanceof Error ? e.message : String(e) });
        return empty;
    }
}
