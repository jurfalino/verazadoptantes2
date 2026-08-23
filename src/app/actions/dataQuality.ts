'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getDb, checkIsModeratorOrAdminAsync } from './_db';

/**
 * "Calidad de datos" moderation report.
 *
 * PII in notes — adopters whose activity notes (`adopter_events.details`)
 * contain the adopter's own contact info (phone / social / address), which
 * belongs in structured contact fields, not free-text notes. Read-only, runs on
 * demand (no cache): a row drops off once the note is cleaned. Gated to
 * moderators + admins; `is_demo = 0` excludes walkthrough demo records.
 *
 * Duplicate detection lives in the page's second tab (DuplicatesPanel → the
 * fuzzy `/api/admin/duplicates` queue), which supersedes the old exact-name
 * Query-2 that used to live here (v2.44.2): the fuzzy engine catches near-name
 * pairs the exact-match SQL missed.
 */

export interface PiiNoteRow {
    adopterId: string;
    name: string;
    hasPhone: boolean;
    hasSocial: boolean;
    hasAddress: boolean;
    /** Concatenated PII-bearing note(s) for this adopter — preview only. */
    note: string;
}

export interface DataQualityReport {
    pii: PiiNoteRow[];
    error?: string;
}

// One row per adopter (grouped), flags OR-ed across their events.
const PII_SQL = `
SELECT e.adopter_id AS adopterId, a.name AS name,
  MAX(CASE WHEN e.details GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' OR e.details GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*' THEN 1 ELSE 0 END) AS hasPhone,
  MAX(CASE WHEN lower(e.details) LIKE '%facebook%' OR lower(e.details) LIKE '%instagram%' OR lower(e.details) LIKE '%http%' OR lower(e.details) LIKE '%wa.me%' THEN 1 ELSE 0 END) AS hasSocial,
  MAX(CASE WHEN lower(e.details) LIKE '%barrio%' OR lower(e.details) LIKE '%calle %' OR lower(e.details) LIKE '%avenida%' THEN 1 ELSE 0 END) AS hasAddress,
  group_concat(e.details, '  ·  ') AS note
FROM adopter_events e
JOIN adopters a ON a.id = e.adopter_id AND a.deleted_at IS NULL AND a.is_demo = 0
WHERE e.details IS NOT NULL AND (
  e.details GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
  OR e.details GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*'
  OR lower(e.details) LIKE '%facebook%' OR lower(e.details) LIKE '%instagram%'
  OR lower(e.details) LIKE '%http%' OR lower(e.details) LIKE '%wa.me%'
  OR lower(e.details) LIKE '%barrio%' OR lower(e.details) LIKE '%calle %' OR lower(e.details) LIKE '%avenida%'
)
GROUP BY e.adopter_id, a.name
ORDER BY a.name
`.trim();

async function runReadonly(query: string): Promise<Record<string, unknown>[]> {
    let env: { DB?: { prepare: (q: string) => { all: () => Promise<{ results?: unknown[] }> } } } | undefined;
    try {
        env = getRequestContext().env as typeof env;
    } catch {
        env = undefined; // local dev (no CF request context)
    }
    if (env?.DB) {
        const res = await env.DB.prepare(query).all();
        return (res.results ?? []) as Record<string, unknown>[];
    }
    // Local dev fallback via Drizzle (better-sqlite3).
    const db = await getDb();
    if (!db) throw new Error('Database unavailable');
    return await (db as unknown as { all: (q: unknown) => Promise<Record<string, unknown>[]> }).all(sql.raw(query));
}

export async function getDataQualityReport(): Promise<DataQualityReport> {
    const session = await auth();
    const email = session?.user?.email;
    try {
        if (!email || !(await checkIsModeratorOrAdminAsync(email))) {
            logger.warn('getDataQualityReport: unauthorized', { user: email });
            return { pii: [], error: 'Unauthorized' };
        }

        const piiRows = await runReadonly(PII_SQL);
        const pii: PiiNoteRow[] = piiRows.map((r) => ({
            adopterId: String(r.adopterId ?? ''),
            name: (r.name as string) ?? '',
            hasPhone: Number(r.hasPhone) === 1,
            hasSocial: Number(r.hasSocial) === 1,
            hasAddress: Number(r.hasAddress) === 1,
            note: (r.note as string) ?? '',
        }));

        logger.info('getDataQualityReport: served', { user: email, piiCount: pii.length });
        return { pii };
    } catch (e) {
        const errorId = logger.error('getDataQualityReport: failed', { user: email, error: e instanceof Error ? e.message : String(e) });
        return { pii: [], error: errorId };
    }
}
