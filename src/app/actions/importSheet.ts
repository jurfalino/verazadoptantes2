'use server';

import { getDb, getUser } from './_db';
import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { mapSpreadsheetColumns } from '@/lib/gemini';
import { parseColumnMap, type ColumnMap } from '@/domain/importFields';

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
        logger.error('mapImportColumns failed', e, { user, headerCount: headers.length });
        return parseColumnMap(null, headers);
    }
}
