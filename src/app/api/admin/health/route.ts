export const runtime = 'edge';

import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';
import { getTableName, getTableColumns } from 'drizzle-orm';
import {
    adopters, adoptions, adopterImages, adopterFlags,
    adopterHistory, adopterStats, searches, appConfig,
    duplicateTokens, duplicateCandidates, dataRequests,
    users, accounts, sessions, verificationTokens,
    userProfiles, auditLog, notifications, formSubmissions,
    organizations, orgMembers, orgInvites
} from '@/db/schema';

// All schema tables for drift detection
const SCHEMA_TABLES = [
    adopters, adoptions, adopterImages, adopterFlags,
    adopterHistory, adopterStats, searches, appConfig,
    duplicateTokens, duplicateCandidates, dataRequests,
    users, accounts, sessions, verificationTokens,
    userProfiles, auditLog, notifications, formSubmissions,
    organizations, orgMembers, orgInvites
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getColumnNames(table: any): string[] {
    const columns = getTableColumns(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values(columns).map((col: any) => col.name as string);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getColumnTypes(table: any): Record<string, string> {
    const columns = getTableColumns(table);
    const types: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const col of Object.values(columns) as any[]) {
        types[col.name] = col.columnType || 'unknown';
    }
    return types;
}

/** Generate ALTER TABLE SQL to fix missing columns */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateFixSql(tableName: string, missingColumns: string[], table: any): string {
    const types = getColumnTypes(table);
    return missingColumns.map(col => {
        const sqlType = types[col]?.includes('Integer') ? 'INTEGER' : 'TEXT';
        return `ALTER TABLE ${tableName} ADD COLUMN ${col} ${sqlType};`;
    }).join('\n');
}

type ServiceStatus = 'ok' | 'starting' | 'degraded' | 'down';

interface ServiceResult {
    status: ServiceStatus;
    latencyMs: number;
    url?: string;
    statusCode?: number;
    error?: string;
}

function classifyLatency(latencyMs: number, ok: boolean): ServiceStatus {
    if (!ok) return 'down';
    if (latencyMs < 2000) return 'ok';
    if (latencyMs < 10000) return 'starting';
    return 'degraded';
}

async function probeFetch(url: string, timeoutMs: number, method: 'GET' | 'HEAD' = 'GET'): Promise<{ ok: boolean; status: number; latencyMs: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    try {
        const res = await fetch(url, { method, signal: controller.signal });
        const latencyMs = Math.round(performance.now() - start);
        return { ok: res.ok, status: res.status, latencyMs };
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Probe D1 database + schema drift + row counts */
async function probeDatabase(db: D1Database) {
    const start = performance.now();
    const tables: Array<{
        name: string;
        status: 'ok' | 'drift' | 'missing';
        expectedColumns: string[];
        actualColumns: string[];
        missingColumns: string[];
        extraColumns: string[];
        fixSql: string | null;
        rowCount: number;
    }> = [];
    let dbOk = false;

    try {
        for (const table of SCHEMA_TABLES) {
            const tableName = getTableName(table);
            const expectedColumns = getColumnNames(table);

            // PRAGMA table_info
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pragmaResult = await db.prepare(`PRAGMA table_info(${tableName})`).all() as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actualColumns = (pragmaResult.results || []).map((row: any) => row.name as string);

            const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
            const extraColumns = actualColumns.filter((col: string) => !expectedColumns.includes(col));

            // Row count
            let rowCount = 0;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const countResult = await db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).first() as any;
                rowCount = countResult?.cnt ?? 0;
            } catch {
                // Table may not exist
            }

            const hasDrift = missingColumns.length > 0 || extraColumns.length > 0;
            const tableExists = actualColumns.length > 0;

            tables.push({
                name: tableName,
                status: !tableExists ? 'missing' : hasDrift ? 'drift' : 'ok',
                expectedColumns,
                actualColumns,
                missingColumns,
                extraColumns,
                fixSql: missingColumns.length > 0 ? generateFixSql(tableName, missingColumns, table) : null,
                rowCount,
            });
        }
        dbOk = true;
    } catch {
        dbOk = false;
    }

    const latencyMs = Math.round(performance.now() - start);
    return { tables, dbOk, latencyMs };
}

/** Probe R2 storage */
async function probeStorage(env: CloudflareEnv) {
    const start = performance.now();
    try {
        const bucket = (env as unknown as Record<string, unknown>).IMAGES_BUCKET as R2Bucket | undefined;
        if (!bucket) {
            return { ok: false, latencyMs: 0, error: 'IMAGES_BUCKET binding not found' };
        }
        const list = await bucket.list({ limit: 1 });
        const latencyMs = Math.round(performance.now() - start);
        return { ok: true, latencyMs, objectSample: list.objects.length };
    } catch (e) {
        const latencyMs = Math.round(performance.now() - start);
        return { ok: false, latencyMs, error: e instanceof Error ? e.message : String(e) };
    }
}

/** Check applied D1 migrations */
async function getMigrations(db: D1Database) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await db.prepare(`SELECT name FROM d1_migrations ORDER BY id DESC`).all() as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const names = (result.results || []).map((row: any) => row.name as string);
        return { applied: names, count: names.length };
    } catch {
        // d1_migrations may not exist in local dev
        return { applied: [], count: 0, error: 'd1_migrations table not accessible' };
    }
}

/** Check env var presence (never expose values) */
function checkEnvironment() {
    const keys = [
        'SCRAPER_URL',
        'NEXT_PUBLIC_CONTRACT_URL',
        'AUTH_URL',
        'AUTH_SECRET',
        'AUTH_GOOGLE_ID',
        'AUTH_GOOGLE_SECRET',
        'GEMINI_API_KEY',
    ];
    const vars: Record<string, boolean> = {};
    for (const key of keys) {
        vars[key] = !!process.env[key];
    }
    return vars;
}

export async function GET() {
    // Auth guard
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json(
                { error: 'No database binding found' },
                { status: 500 }
            );
        }

        // Run all probes in parallel
        const contractUrl = process.env.NEXT_PUBLIC_CONTRACT_URL || 'https://adoptions.pages.dev';
        const scraperUrl = process.env.SCRAPER_URL;

        const [dbResult, storageResult, migrationsResult, petshieldResult, scraperResult] = await Promise.allSettled([
            probeDatabase(env.DB),
            probeStorage(env),
            getMigrations(env.DB),
            // PetShield probe
            (async (): Promise<ServiceResult> => {
                try {
                    const { ok, status, latencyMs } = await probeFetch(contractUrl, 5000, 'HEAD');
                    return { status: classifyLatency(latencyMs, ok), latencyMs, url: contractUrl, statusCode: status };
                } catch (e) {
                    return { status: 'down', latencyMs: 0, url: contractUrl, error: e instanceof Error ? e.message : String(e) };
                }
            })(),
            // Scraper probe
            (async (): Promise<ServiceResult> => {
                if (!scraperUrl) {
                    return { status: 'down', latencyMs: 0, error: 'SCRAPER_URL not configured' };
                }
                try {
                    const healthUrl = `${scraperUrl}/health`;
                    const { ok, status, latencyMs } = await probeFetch(healthUrl, 10000);
                    return { status: classifyLatency(latencyMs, ok), latencyMs, url: healthUrl, statusCode: status };
                } catch (e) {
                    return { status: 'down', latencyMs: 0, url: `${scraperUrl}/health`, error: e instanceof Error ? e.message : String(e) };
                }
            })(),
        ]);

        // Unpack results with safe defaults
        const db = dbResult.status === 'fulfilled' ? dbResult.value : { tables: [], dbOk: false, latencyMs: 0 };
        const storage = storageResult.status === 'fulfilled' ? storageResult.value : { ok: false, latencyMs: 0, error: 'probe failed' };
        const migrations = migrationsResult.status === 'fulfilled' ? migrationsResult.value : { applied: [], count: 0 };
        const petshield = petshieldResult.status === 'fulfilled' ? petshieldResult.value : { status: 'down' as ServiceStatus, latencyMs: 0 };
        const scraper = scraperResult.status === 'fulfilled' ? scraperResult.value : { status: 'down' as ServiceStatus, latencyMs: 0 };

        // Platform status = DB + R2 combined
        const hasDrift = db.tables.some(t => t.status !== 'ok');
        const platformStatus: ServiceStatus = hasDrift ? 'degraded' : (db.dbOk && storage.ok ? 'ok' : (db.dbOk || storage.ok ? 'degraded' : 'down'));

        return NextResponse.json({
            services: {
                platform: { status: platformStatus, latencyMs: db.latencyMs, dbOk: db.dbOk, r2Ok: storage.ok },
                petshield,
                scraper,
            },
            schema: { tables: db.tables },
            storage: {
                ok: storage.ok,
                latencyMs: storage.latencyMs,
                error: storage.ok ? undefined : (storage as { error?: string }).error,
            },
            migrations,
            environment: {
                version: '2.10.0-8',
                runtime: 'edge',
                vars: checkEnvironment(),
            },
            meta: { checkedAt: new Date().toISOString() },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
