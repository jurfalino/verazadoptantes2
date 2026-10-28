'use server';
import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters } from '@/db/schema';
import { isRealActorEmail } from '@/lib/piiAccess';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { logger } from '@/lib/logger';
import { isMinor, type HouseholdLine } from '@/domain/households';

export interface MatchContext {
    ok: boolean;
    name: string | null;
    has: { phone: boolean; email: boolean; id: boolean; social: boolean; address: boolean };
    /**
     * Only when asked (`{ standing: true }`): how the person stands, for a match
     * card's header (audit B6) — their own rating and open alerts (countsFor, as a
     * household row counts them), «Menor de edad», and who they live with. Not
     * PII: the same a search card shows any signed-in rescuer. Absent when it
     * could not be read (logged).
     */
    standing?: { rating: number | null; openAlerts: number; isMinor: boolean; households: HouseholdLine[] };
}

/** Presence-only summary of an existing adopter's contact types — for the import
 *  "por qué" panel. Returns booleans, NEVER the values (the record may be protected),
 *  so it can't leak PII while still explaining why a match scored low. */
export async function getMatchContext(adopterId: string, opts?: { standing?: boolean }): Promise<MatchContext> {
    const empty = { ok: false, name: null, has: { phone: false, email: false, id: false, social: false, address: false } };
    let actor = '';
    try { actor = await getUser(); } catch { /* anon */ }
    if (!isRealActorEmail(actor)) return empty;
    try {
        const db = await getDb();
        if (!db) return empty;
        const row = await db.select({
            name: adopters.name, contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo,
            age: adopters.age, ageAsOf: adopters.ageAsOf, isMinor: adopters.isMinor,
        }).from(adopters).where(eq(adopters.id, adopterId)).get();
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
        // Legacy records may only have contactInfo (free-text blob) with contactEntries
        // null/empty. Scan it for phone/email presence to avoid false-negative "sin
        // teléfono/email" badges that would contradict a match found via the blob.
        // Only presence booleans are derived here — the blob itself is never returned or logged.
        const blob = (row.contactInfo ?? '').toString();
        if (!has.phone && /\d[\d\s().-]{6,}/.test(blob)) has.phone = true;
        if (!has.email && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(blob)) has.email = true;
        if (opts?.standing !== true) return { ok: true, name: row.name, has };
        return { ok: true, name: row.name, has, ...(await standingOf(db, actor, adopterId, row)) };
    } catch (e) {
        logger.warn('getMatchContext failed', { adopterId, error: e instanceof Error ? e.message : String(e) });
        return empty;
    }
}

/** The header's standing; a failed read leaves it out (the card shows no standing) and is logged. */
async function standingOf(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    actor: string,
    adopterId: string,
    row: { age: number | null; ageAsOf: string | null; isMinor: number | null },
): Promise<Pick<MatchContext, 'standing'>> {
    try {
        const [{ countsFor }, { householdLinesFor }] = await Promise.all([import('@/lib/profileSummary'), import('@/lib/households')]);
        const ctx = { op: 'getMatchContext', adopterId, actor };
        const [counts, lines] = await Promise.all([
            countsFor(db, adopterId, ctx, { activity: false }),
            householdLinesFor(db, actor, [adopterId]),
        ]);
        return { standing: { rating: counts.rating, openAlerts: counts.openAlerts, isMinor: isMinor(row), households: lines[adopterId] ?? [] } };
    } catch (e) {
        logger.warn('getMatchContext: standing could not be read, the card shows none', { adopterId, actor, error: e instanceof Error ? e.message : String(e) });
        return {};
    }
}
