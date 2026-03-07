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
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getColumnNames(table: any): string[] {
    const columns = getTableColumns(table);
    return Object.values(columns).map((col: any) => col.name as string);
}

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

    const components: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json(
                { status: 'error', message: 'No database binding found' },
                { status: 500 }
            );
        }

        // ── DB schema check ─────────────────────────────────
        const dbStart = performance.now();
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
        components.db = {
            status: mismatches.length > 0 ? 'schema_mismatch' : 'ok',
            latencyMs: Math.round(performance.now() - dbStart),
        };

        // ── R2 bucket probe ─────────────────────────────────
        try {
            const r2Start = performance.now();
            const bucket = (env as unknown as Record<string, unknown>).IMAGES_BUCKET as R2Bucket | undefined;
            if (bucket) {
                await bucket.list({ limit: 1 });
                components.r2 = { status: 'ok', latencyMs: Math.round(performance.now() - r2Start) };
            } else {
                components.r2 = { status: 'no_binding' };
            }
        } catch (e) {
            components.r2 = { status: 'error', error: e instanceof Error ? e.message : String(e) };
        }

        // ── Axiom probe ─────────────────────────────────────
        try {
            const axiomToken = (env as unknown as Record<string, string | undefined>)?.AXIOM_TOKEN || process.env.AXIOM_TOKEN;
            if (axiomToken) {
                const axiomStart = performance.now();
                const res = await fetch('https://api.axiom.co/v1/datasets', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${axiomToken}` },
                });
                components.axiom = { status: res.ok ? 'ok' : `http_${res.status}`, latencyMs: Math.round(performance.now() - axiomStart) };
            } else {
                components.axiom = { status: 'no_token' };
            }
        } catch (e) {
            components.axiom = { status: 'error', error: e instanceof Error ? e.message : String(e) };
        }

        // Overall status
        const allOk = mismatches.length === 0 &&
            components.r2?.status === 'ok' &&
            (components.axiom?.status === 'ok' || components.axiom?.status === 'no_token');
        const overallStatus = mismatches.length > 0 ? 'schema_mismatch' : (allOk ? 'ok' : 'degraded');

        if (mismatches.length > 0) {
            return NextResponse.json(
                {
                    status: overallStatus,
                    message: `${mismatches.length} table(s) have schema mismatches`,
                    mismatches,
                    components,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            status: overallStatus,
            tables: SCHEMA_TABLES.length,
            message: allOk ? 'All systems operational' : 'Some components degraded',
            components,
        });

    } catch (error) {
        return NextResponse.json(
            { status: 'error', message: error instanceof Error ? error.message : String(error), components },
            { status: 500 }
        );
    }
}
