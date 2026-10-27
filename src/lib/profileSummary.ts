/**
 * A profile's live summary as one viewer may see it (D46) — the read helpers
 * shared by the household reads: today's linked convivientes
 * (src/lib/householdLinks.ts, getLinkedSummaries) and households as profiles
 * (src/lib/households.ts). Plain server module, never 'use server'.
 *
 * - `countsFor`: rating, open alerts, adoptions, records — one query per profile.
 * - `viewerContacts`: the profile's contacts masked exactly as getAdopter would
 *   mask them for this viewer (same masking, fail closed), capped.
 * - `namesFor`: rescuers' display names (a failure falls back to handles).
 */
import { eq, sql } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { deserializeContactEntries, parseBlobToContactEntries } from '@/lib/contactEntries';
import { maskContactEntries, NO_ACCESS_VISIBILITY, type Visibility } from '@/lib/piiAccess';
import { maskOptionsFor } from '@/lib/piiAccessServer';
import { RECORD_TYPES } from '@/domain/constants';
import { realOwner } from '@/domain/dedupPair';
import { countOpenAlerts, summaryContacts, type LinkedSummary } from '@/domain/householdLinks';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Display names keyed by the email as stored; a lookup failure falls back to handles. */
export async function namesFor(emails: Array<string | null | undefined>, ctx: Record<string, unknown>): Promise<Record<string, string>> {
    const real = [...new Set(emails.map(e => realOwner(e ?? null)).filter((e): e is string => !!e))];
    if (real.length === 0) return {};
    try {
        const { resolveUserNames } = await import('@/app/actions/userNames');
        return await resolveUserNames(real);
    } catch (e) {
        logger.warn('profileSummary: name lookup failed, showing handles', { ...ctx, error: errMsg(e) });
        return {};
    }
}

export type ProfileCounts = { rating: number | null; openAlerts: number; adoptions: number; records: number };

export const EMPTY_COUNTS: ProfileCounts = { rating: null, openAlerts: 0, adoptions: 0, records: 0 };

/**
 * Rating (same source as the profile page: AVG over the adoptions view), open
 * alerts, adoptions and records — ONE query per profile (scalar subqueries,
 * the id bound as a parameter). Flags come back as a JSON array so the open-alert rule stays in
 * src/domain (countOpenAlerts), not in SQL. A failure degrades to an empty
 * summary line and is logged.
 */
export async function countsFor(db: Db, id: string, ctx: Record<string, unknown>): Promise<ProfileCounts> {
    type Raw = { avg: number | null; adopted: number | null; records: number | null; flags: string | null };
    let raw: Raw | undefined;
    try {
        // `await` whether the driver returns a promise (D1) or a value (better-sqlite3 in dev/tests).
        raw = await db.select({
            avg: sql<number | null>`(SELECT AVG(rating) FROM adoptions WHERE adopter_id = ${id})`,
            adopted: sql<number>`(SELECT COUNT(*) FROM placements WHERE adopter_id = ${id} AND record_type = ${RECORD_TYPES.ADOPTION})`,
            records: sql<number>`(SELECT COUNT(*) FROM adopter_events WHERE adopter_id = ${id})`,
            flags: sql<string | null>`(SELECT json_group_array(json_object('reason', reason, 'targetAdopterId', target_adopter_id, 'details', details)) FROM adopter_flags WHERE adopter_id = ${id})`,
        }).from(adopters).where(eq(adopters.id, id)).get() as Raw | undefined;
    } catch (e) {
        logger.warn('profileSummary: counts D1 fallback hit', { ...ctx, profileId: id, error: errMsg(e) });
        return { ...EMPTY_COUNTS };
    }
    let flags: Array<{ reason?: string | null; targetAdopterId?: string | null; details?: string | null }> = [];
    try {
        const parsed: unknown = JSON.parse(raw?.flags || '[]');
        if (Array.isArray(parsed)) flags = parsed;
    } catch (e) {
        logger.warn('profileSummary: unreadable flags, no alerts counted', { ...ctx, profileId: id, error: errMsg(e) });
    }
    const avg = raw?.avg ?? null;
    return {
        rating: avg == null ? null : Number(avg),
        openAlerts: countOpenAlerts(flags.map(f => ({ adopterId: id, ...f }))),
        adoptions: Number(raw?.adopted ?? 0),
        records: Number(raw?.records ?? 0),
    };
}

/** Contacts as this viewer may see them on that profile — the same rule getAdopter applies. */
export function viewerContacts(
    p: { contactEntries: string | null; contactInfo: string | null; isPublic: number | boolean | null },
    gatingOn: boolean,
    publicFlag: boolean,
    visibility: Visibility | undefined,
): { contacts: LinkedSummary['contacts']; more: number; canSeeContact: boolean } {
    const parsed = deserializeContactEntries(p.contactEntries);
    const source = parsed.length > 0 ? parsed : parseBlobToContactEntries(p.contactInfo);
    const opts = maskOptionsFor(publicFlag, p);
    const fully = !gatingOn || !!opts.adopterIsPublic || !!visibility?.nothingMasked;
    // No verdict (the resolver failed) masks everything: fail closed.
    const entries = fully ? source : maskContactEntries(source, visibility ?? NO_ACCESS_VISIBILITY, opts).entries;
    const { shown, more } = summaryContacts(entries);
    return { contacts: shown, more, canSeeContact: fully };
}
