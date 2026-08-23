'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getDb, checkIsModeratorOrAdminAsync } from './_db';

/**
 * "Calidad de datos" moderation report (v2.44.0). Two live, self-clearing
 * lists that surface records likely needing cleanup:
 *
 *   1. PII in notes — adopters whose activity notes (`adopter_events.details`)
 *      contain the adopter's own contact info (phone / social / address). These
 *      belong in structured contact fields, not free-text notes.
 *   2. Likely duplicates — pairs with the EXACT same name that also share at
 *      least one contact token (phone/email/social/address). High-signal merge
 *      candidates, distinct from the general `/admin/duplicates` queue.
 *
 * Both queries are read-only and run on demand (no cache, no resolution
 * tracking): a row drops off automatically once the note is cleaned or the
 * pair is merged. Gated to moderators + admins. The SQL mirrors the validated
 * ad-hoc audit queries; `is_demo = 0` excludes walkthrough demo records.
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

export interface DupSharedContact {
    type: string;   // phone | email | social | address_word
    value: string;
}

export interface DupPair {
    name: string;
    idA: string;
    idB: string;
    shared: DupSharedContact[];
}

export interface DataQualityReport {
    pii: PiiNoteRow[];
    dups: DupPair[];
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

// One row per shared token per name-matched pair (a < b dedupes the pair);
// grouped into pairs in JS below.
const DUP_SQL = `
SELECT a.name AS name, t1.adopter_id AS idA, t2.adopter_id AS idB,
  t1.token_type AS sharedType, t1.token_value AS sharedValue
FROM duplicate_tokens t1
JOIN duplicate_tokens t2
  ON t1.token_type = t2.token_type
  AND t1.token_value = t2.token_value
  AND t1.adopter_id < t2.adopter_id
JOIN adopters a ON a.id = t1.adopter_id AND a.deleted_at IS NULL AND a.is_demo = 0
JOIN adopters b ON b.id = t2.adopter_id AND b.deleted_at IS NULL AND b.is_demo = 0
WHERE t1.token_type IN ('phone','email','social','address_word')
  AND a.name IS NOT NULL AND trim(a.name) <> ''
  AND lower(trim(a.name)) = lower(trim(b.name))
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
            return { pii: [], dups: [], error: 'Unauthorized' };
        }

        const [piiRows, dupRows] = await Promise.all([
            runReadonly(PII_SQL),
            runReadonly(DUP_SQL),
        ]);

        const pii: PiiNoteRow[] = piiRows.map((r) => ({
            adopterId: String(r.adopterId ?? ''),
            name: (r.name as string) ?? '',
            hasPhone: Number(r.hasPhone) === 1,
            hasSocial: Number(r.hasSocial) === 1,
            hasAddress: Number(r.hasAddress) === 1,
            note: (r.note as string) ?? '',
        }));

        // Collapse the per-token rows into one entry per pair.
        const pairMap = new Map<string, DupPair>();
        for (const r of dupRows) {
            const idA = String(r.idA ?? '');
            const idB = String(r.idB ?? '');
            const key = `${idA}|${idB}`;
            let pair = pairMap.get(key);
            if (!pair) {
                pair = { name: (r.name as string) ?? '', idA, idB, shared: [] };
                pairMap.set(key, pair);
            }
            pair.shared.push({ type: String(r.sharedType ?? ''), value: String(r.sharedValue ?? '') });
        }
        const dups = Array.from(pairMap.values());

        logger.info('getDataQualityReport: served', { user: email, piiCount: pii.length, dupPairs: dups.length });
        return { pii, dups };
    } catch (e) {
        const errorId = logger.error('getDataQualityReport: failed', { user: email, error: e instanceof Error ? e.message : String(e) });
        return { pii: [], dups: [], error: errorId };
    }
}
