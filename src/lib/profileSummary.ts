/**
 * A profile's live summary as one viewer may see it (D46) — the read helpers
 * shared by the household reads: today's linked convivientes
 * (src/lib/householdLinks.ts, getLinkedSummaries) and households as profiles
 * (src/lib/households.ts). Plain server module, never 'use server'.
 *
 * - `countsFor`: rating, open alerts and activity by record type (what that
 *   profile's own «Actividad» header counts) — one query per profile.
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
import { countActivity, type ActivityCounts } from '@/domain/activityCounts';
import { realOwner } from '@/domain/dedupPair';
import { summaryContacts, type LinkedSummary } from '@/domain/householdLinks';
import { openAlertKindsOfRows, type OpenAlertKind } from '@/domain/flags';

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

export type ProfileCounts = { rating: number | null; openAlerts: OpenAlertKind[]; activity: ActivityCounts };

export const EMPTY_COUNTS: ProfileCounts = { rating: null, openAlerts: [], activity: {} };

/**
 * Rating (same source as the profile page: AVG over the adoptions view), open
 * alerts, and activity by record type — the same rows the profile's own
 * «Actividad» lists (getAdoptions reads the `adoptions` view) counted by the
 * same rule (countActivity), so fosters and returns count and an ended
 * placement doesn't. ONE query per profile (scalar subqueries, the id bound
 * as a parameter), and ONE pass over that profile's activity rows: the
 * average and the record types come out of the same subquery. Flags come back
 * as a JSON array so the open-alert rule stays in src/domain
 * (openAlertKindsOfRows), not in SQL. A failure degrades to an empty summary line
 * and is logged.
 *
 * `activity: false` (search-card household lines, «¿Es este perfil?»: they show
 * rating and alerts only) skips listing the record types; `activity` is {}.
 */
export async function countsFor(db: Db, id: string, ctx: Record<string, unknown>, opts: { activity?: boolean } = {}): Promise<ProfileCounts> {
    const withActivity = opts.activity !== false;
    type Raw = { act: string | null; flags: string | null };
    let raw: Raw | undefined;
    try {
        // `await` whether the driver returns a promise (D1) or a value (better-sqlite3 in dev/tests).
        raw = await db.select({
            act: withActivity
                ? sql<string | null>`(SELECT json_object('avg', AVG(CASE WHEN rating > 0 THEN rating END), 'kinds', json_group_array(record_type)) FROM adoptions WHERE adopter_id = ${id})`
                : sql<string | null>`(SELECT json_object('avg', AVG(CASE WHEN rating > 0 THEN rating END)) FROM adoptions WHERE adopter_id = ${id})`,
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
    let avg: number | null = null;
    let kinds: Array<string | null> = [];
    try {
        const parsed = JSON.parse(raw?.act || '{}') as { avg?: unknown; kinds?: unknown };
        avg = typeof parsed.avg === 'number' ? parsed.avg : null;
        if (Array.isArray(parsed.kinds)) kinds = parsed.kinds.map(k => (typeof k === 'string' ? k : null));
    } catch (e) {
        logger.warn('profileSummary: unreadable rating/activity, none shown', { ...ctx, profileId: id, error: errMsg(e) });
    }
    return {
        rating: avg,
        openAlerts: openAlertKindsOfRows(flags.map(f => ({ adopterId: id, ...f }))),
        activity: withActivity ? countActivity(kinds.map(recordType => ({ recordType }))) : {},
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
