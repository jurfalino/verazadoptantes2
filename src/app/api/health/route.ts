export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';
import { getTableName, getTableColumns } from 'drizzle-orm';
import {
    adopters, adoptions, adopterImages, adopterFlags,
    adopterHistory, adopterStats, searches, appConfig
} from '@/db/schema';

/**
 * Derive expected column names from a Drizzle table definition.
 * Uses drizzle-orm's getTableColumns() which returns { columnKey: Column } where each Column has a `.name` property.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getColumnNames(table: any): string[] {
    const columns = getTableColumns(table);
    return Object.values(columns).map((col: any) => col.name as string);
}

/**
 * Schema generated from Drizzle table definitions — always in sync with src/db/schema.ts.
 * No manual maintenance needed: adding a column to the schema automatically updates this check.
 */
const SCHEMA_TABLES = [
    adopters, adoptions, adopterImages, adopterFlags,
    adopterHistory, adopterStats, searches, appConfig
];

export async function GET() {
    const mismatches: Array<{
        table: string;
        missing: string[];
        extra: string[];
    }> = [];

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json(
                { status: 'error', message: 'No database binding found' },
                { status: 500 }
            );
        }

        for (const table of SCHEMA_TABLES) {
            const tableName = getTableName(table);
            const expectedColumns = getColumnNames(table);
            const result = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
            const actualColumns = (result.results || []).map((row: any) => row.name as string);

            const missing = expectedColumns.filter(col => !actualColumns.includes(col));
            const extra = actualColumns.filter(col => !expectedColumns.includes(col));

            if (missing.length > 0 || extra.length > 0) {
                mismatches.push({ table: tableName, missing, extra });
            }
        }

        if (mismatches.length > 0) {
            return NextResponse.json(
                {
                    status: 'schema_mismatch',
                    message: `${mismatches.length} table(s) have schema mismatches`,
                    mismatches,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            status: 'ok',
            tables: SCHEMA_TABLES.length,
            message: 'All tables match expected schema',
        });

    } catch (error) {
        return NextResponse.json(
            { status: 'error', message: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
