'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { sql, eq, desc } from 'drizzle-orm';
import { adopterFlags, adopters, adopterEvents } from '@/db/schema';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, checkIsModeratorOrAdminAsync } from './_db';
import { detectNotePii, noteHash, type NotePiiFlags } from '@/domain/notePii';

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
    /** The adopter_events row this note belongs to — the edit target. */
    eventId: string;
    adopterId: string;
    name: string;
    hasPhone: boolean;
    hasSocial: boolean;
    hasAddress: boolean;
    /** true = record is Protegido (is_public=0); false = Público. */
    isProtected: boolean;
    /** The event's own note (`adopter_events.details`) — editable inline. */
    note: string;
}

export interface DataQualityReport {
    pii: PiiNoteRow[];
    error?: string;
}

// One row per PII-bearing EVENT (not grouped) so each note maps to its own
// adopter_events.id and can be edited/saved inline.
// Coarse DB-side PREFILTER only. The AUTHORITY for what counts as PII in a note
// is `detectNotePii` (src/domain/notePii.ts), applied in JS below — single source
// of truth. This WHERE must stay a SUPERSET of detectNotePii so nothing is dropped
// before the JS check. Dismissal is content-bound and also resolved in JS (hash).
const PII_SQL = `
SELECT e.id AS eventId, e.adopter_id AS adopterId, a.name AS name, a.is_public AS isPublic,
  e.pii_dismissed_hash AS piiDismissedHash,
  e.details AS note
FROM adopter_events e
JOIN adopters a ON a.id = e.adopter_id AND a.deleted_at IS NULL AND a.is_demo = 0
WHERE e.details IS NOT NULL AND (
  e.details GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
  OR e.details GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*'
  OR lower(e.details) LIKE '%facebook%' OR lower(e.details) LIKE '%instagram%'
  OR lower(e.details) LIKE '%http%' OR lower(e.details) LIKE '%wa.me%'
  OR lower(e.details) LIKE '%barrio%' OR lower(e.details) LIKE '%calle %' OR lower(e.details) LIKE '%avenida%'
)
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
        const pii: PiiNoteRow[] = [];
        for (const r of piiRows) {
            const note = (r.note as string) ?? '';
            const flags = detectNotePii(note); // authority (SQL was only a prefilter)
            if (!flags.hasPhone && !flags.hasSocial && !flags.hasAddress) continue;
            // Content-bound dismissal: suppress only while the note is UNCHANGED
            // since it was reviewed. Any edit (any write path) changes the hash →
            // the row re-appears automatically.
            const dismissedHash = (r.piiDismissedHash as string) || null;
            if (dismissedHash && dismissedHash === noteHash(note)) continue;
            pii.push({
                eventId: String(r.eventId ?? ''),
                adopterId: String(r.adopterId ?? ''),
                name: (r.name as string) ?? '',
                hasPhone: flags.hasPhone,
                hasSocial: flags.hasSocial,
                hasAddress: flags.hasAddress,
                isProtected: Number(r.isPublic) !== 1,
                note,
            });
        }

        logger.info('getDataQualityReport: served', { user: email, piiCount: pii.length });
        return { pii };
    } catch (e) {
        const errorId = logger.error('getDataQualityReport: failed', { user: email, error: e instanceof Error ? e.message : String(e) });
        return { pii: [], error: errorId };
    }
}

/**
 * Save an edited activity note from the "Contacto en notas" tab (moderators +
 * admins) so PII can be cleaned in place. Only touches `adopter_events.details`
 * — not a token source, so no re-tokenization needed. Empty → NULL. Audited
 * (event id only; never the note content, which may hold PII).
 */
export async function updateEventDetails(eventId: string, details: string): Promise<{ success: boolean; error?: string; flags?: NotePiiFlags }> {
    const session = await auth();
    const email = session?.user?.email;
    try {
        if (!email || !(await checkIsModeratorOrAdminAsync(email))) {
            logger.warn('updateEventDetails: unauthorized', { user: email, eventId });
            return { success: false, error: 'Unauthorized' };
        }
        if (!eventId) return { success: false, error: 'Missing event id' };
        const db = await getDb();
        if (!db) return { success: false, error: 'No database' };

        const trimmed = details.trim();
        await db.update(adopterEvents).set({ details: trimmed || null, piiDismissedAt: null, piiDismissedHash: null }).where(eq(adopterEvents.id, eventId));
        logAudit({ userEmail: email, action: 'data_quality_edit_note', details: { eventId, length: trimmed.length } });
        logger.info('updateEventDetails: saved', { user: email, eventId });
        // Server is the authority for whether the saved note still qualifies for
        // the report (single source of truth = detectNotePii). The panel uses this
        // to drop the row / refresh badges without a reload.
        return { success: true, flags: detectNotePii(trimmed) };
    } catch (e) {
        const errorId = logger.error('updateEventDetails: failed', { user: email, eventId, error: e instanceof Error ? e.message : String(e) });
        return { success: false, error: errorId };
    }
}

export interface ReportedFlagRow {
    id: string;
    reason: string;
    details: string | null;
    flaggedBy: string | null;
    /** Epoch ms (serializable for the client), or null. */
    createdAt: number | null;
    adopterId: string;
    adopterName: string | null;
    /** false = the flagged adopter row was deleted (vs a nameless-but-present adopter). */
    adopterFound: boolean;
}

/**
 * User-reported flags for the "Contenido reportado" tab (moved from
 * /admin/flags). Mod + admin may view; DISMISS is admin-only (see dismissFlag).
 * The client filters/counts by reason (default 'duplicate').
 */
export async function getReportedFlags(): Promise<{ flags: ReportedFlagRow[]; error?: string }> {
    const session = await auth();
    const email = session?.user?.email;
    try {
        if (!email || !(await checkIsModeratorOrAdminAsync(email))) {
            logger.warn('getReportedFlags: unauthorized', { user: email });
            return { flags: [], error: 'Unauthorized' };
        }
        const db = await getDb();
        if (!db) return { flags: [], error: 'Database unavailable' };

        const rows = await db.select({
            id: adopterFlags.id,
            reason: adopterFlags.reason,
            details: adopterFlags.details,
            flaggedBy: adopterFlags.flaggedBy,
            createdAt: adopterFlags.createdAt,
            adopterId: adopterFlags.adopterId,
            adopterName: adopters.name,
            adopterFound: adopters.id,
        })
            .from(adopterFlags)
            .leftJoin(adopters, eq(adopterFlags.adopterId, adopters.id))
            .orderBy(desc(adopterFlags.createdAt))
            .all();

        type FlagQueryRow = {
            id: string; reason: string; details: string | null; flaggedBy: string | null;
            createdAt: Date | number | null; adopterId: string; adopterName: string | null; adopterFound: string | null;
        };
        const flags: ReportedFlagRow[] = (rows as FlagQueryRow[]).map((r) => ({
            id: r.id,
            reason: r.reason,
            details: r.details ?? null,
            flaggedBy: r.flaggedBy ?? null,
            createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
            adopterId: r.adopterId,
            adopterName: r.adopterName ?? null,
            adopterFound: r.adopterFound != null,
        }));

        logger.info('getReportedFlags: served', { user: email, flagCount: flags.length });
        return { flags };
    } catch (e) {
        const errorId = logger.error('getReportedFlags: failed', { user: email, error: e instanceof Error ? e.message : String(e) });
        return { flags: [], error: errorId };
    }
}


/**
 * Mark a "Contacto en notas" row as a reviewed FALSE POSITIVE (e.g. "de la calle"
 * tripping the address heuristic). Sets `adopter_events.pii_dismissed_at` so the
 * row drops off the report without changing the note text. Moderators + admins.
 * Reversible via `undismissPiiNote`; also auto-cleared if the note is later edited.
 */
export async function dismissPiiNote(eventId: string): Promise<{ success: boolean; error?: string }> {
    const session = await auth();
    const email = session?.user?.email;
    try {
        if (!email || !(await checkIsModeratorOrAdminAsync(email))) {
            logger.warn('dismissPiiNote: unauthorized', { user: email, eventId });
            return { success: false, error: 'Unauthorized' };
        }
        if (!eventId) return { success: false, error: 'Missing event id' };
        const db = await getDb();
        if (!db) return { success: false, error: 'No database' };
        // Hash the CURRENT persisted note so the dismissal only holds while the
        // note is unchanged (content-bound — survives no write path, re-surfaces
        // on any edit). Fetch server-side; never trust a client-supplied note.
        const rows = await db.select({ details: adopterEvents.details }).from(adopterEvents).where(eq(adopterEvents.id, eventId)).limit(1);
        if (!rows.length) return { success: false, error: 'Not found' };
        await db.update(adopterEvents).set({ piiDismissedAt: new Date(), piiDismissedHash: noteHash(rows[0].details ?? '') }).where(eq(adopterEvents.id, eventId));
        logAudit({ userEmail: email, action: 'data_quality_dismiss_note', details: { eventId } });
        logger.info('dismissPiiNote: dismissed', { user: email, eventId });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('dismissPiiNote: failed', { user: email, eventId, error: e instanceof Error ? e.message : String(e) });
        return { success: false, error: errorId };
    }
}

/** Undo a `dismissPiiNote` — the row reappears in the report. Moderators + admins. */
export async function undismissPiiNote(eventId: string): Promise<{ success: boolean; error?: string }> {
    const session = await auth();
    const email = session?.user?.email;
    try {
        if (!email || !(await checkIsModeratorOrAdminAsync(email))) {
            logger.warn('undismissPiiNote: unauthorized', { user: email, eventId });
            return { success: false, error: 'Unauthorized' };
        }
        if (!eventId) return { success: false, error: 'Missing event id' };
        const db = await getDb();
        if (!db) return { success: false, error: 'No database' };
        await db.update(adopterEvents).set({ piiDismissedAt: null, piiDismissedHash: null }).where(eq(adopterEvents.id, eventId));
        logAudit({ userEmail: email, action: 'data_quality_undismiss_note', details: { eventId } });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('undismissPiiNote: failed', { user: email, eventId, error: e instanceof Error ? e.message : String(e) });
        return { success: false, error: errorId };
    }
}
