'use server';

import { getDb, getUser } from './_db';
import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { mapSpreadsheetColumns, aiTransformRows, extractAdopterData } from '@/lib/gemini';
import { parseColumnMap, type ColumnMap, type MappedRow } from '@/domain/importFields';
import type { ExtraContacts } from '@/lib/importRow';

/** Admin-configured default Gemini model (mirrors the extract-from-post route). */
async function getDefaultModel(): Promise<string | undefined> {
    try {
        const db = await getDb();
        if (!db) return undefined;
        const row = await db.select().from(appConfig).where(eq(appConfig.key, 'GEMINI_DEFAULT_MODEL')).get();
        const v = row?.value?.trim();
        return v || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Ask the AI to map a spreadsheet's columns to our schema. Auth-gated (any
 * signed-in user). Returns a validated ColumnMap (never raw model output). On
 * failure returns an all-`ignore` map so the user maps manually. Headers +
 * sample rows are parsed client-side and passed here — the raw file never
 * touches the server.
 */
export async function mapImportColumns(
    headers: string[],
    sampleRows: string[][],
    language: string = 'es',
): Promise<ColumnMap> {
    const user = await getUser();
    if (!user || user === 'anonymous') throw new Error('Not authorized');
    if (!Array.isArray(headers) || headers.length === 0) return parseColumnMap(null, headers || []);

    try {
        const model = await getDefaultModel();
        const map = await mapSpreadsheetColumns(headers, Array.isArray(sampleRows) ? sampleRows : [], model, language);
        logger.info('Spreadsheet columns mapped', { user, headerCount: headers.length, sampleRows: (sampleRows || []).length });
        return map;
    } catch (e) {
        // Handled: returns an all-ignore map so the user maps manually. warn, not error.
        logger.warn('mapImportColumns failed (returned all-ignore map)', { user, headerCount: headers.length, error: e instanceof Error ? e.message : String(e) });
        return parseColumnMap(null, headers);
    }
}

/**
 * AI ingestion: interpret a chunk of raw spreadsheet rows directly into
 * structured records (MappedRow[]). Auth-gated. The client calls this per chunk
 * (~20 rows) so it can show progress and avoid one long request. Returns [] on
 * failure so the caller can fall back to deterministic column-mapping.
 */
export async function interpretRows(headers: string[], rows: string[][], language: string = 'es'): Promise<MappedRow[]> {
    const user = await getUser();
    if (!user || user === 'anonymous') throw new Error('Not authorized');
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const model = await getDefaultModel();
    const out = await aiTransformRows(headers, rows, model, language);
    logger.info('Spreadsheet rows interpreted by AI', { user, rows: rows.length });
    return out;
}

/**
 * AI escalation for a single messy "combined contact" cell that the deterministic
 * `categorizeContactText` couldn't structure (P2). Best-effort — returns {} on
 * failure so the row still imports with whatever was parsed deterministically.
 * NOTE: reuses `extractAdopterData`, whose prompt is tuned for social-post prose;
 * it extracts contacts adequately but a dedicated cell-cleanup prompt is a known
 * follow-up. Called only for the unparseable tail, so cost stays bounded.
 */
export async function aiCleanRowContacts(text: string): Promise<ExtraContacts> {
    const user = await getUser();
    if (!user || user === 'anonymous') throw new Error('Not authorized');
    if (!text || !text.trim()) return {};
    try {
        const model = await getDefaultModel();
        const data = await extractAdopterData(text, undefined, model, 'es');
        return {
            phones: data.phones ?? [],
            emails: data.emails ?? [],
            socials: data.socialProfiles ?? [],
            addresses: data.addresses ?? [],
            ids: [],
        };
    } catch (e) {
        logger.warn('aiCleanRowContacts failed (row imports with deterministic contacts only)', { user, error: e instanceof Error ? e.message : String(e) });
        return {};
    }
}
