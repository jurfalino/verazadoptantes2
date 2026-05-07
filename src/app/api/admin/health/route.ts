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
    const pingStart = performance.now();
    let dbOk = false;
    let trueLatencyMs = 0;

    // True Liveness Ping
    try {
        await db.prepare('SELECT 1').first();
        dbOk = true;
        trueLatencyMs = Math.round(performance.now() - pingStart);
    } catch {
        dbOk = false;
        trueLatencyMs = Math.round(performance.now() - pingStart);
        return { tables: [], dbOk, latencyMs: trueLatencyMs, auditDurationMs: trueLatencyMs };
    }

    const auditStart = performance.now();
    
    // Parallelize schema audits and row counts
    const tablePromises = SCHEMA_TABLES.map(async (table) => {
        const tableName = getTableName(table);
        const expectedColumns = getColumnNames(table);

        try {
            // PRAGMA and COUNT ran in parallel per-table for speed
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [pragmaResult, countResult] = await Promise.all([
                db.prepare(`PRAGMA table_info(${tableName})`).all() as any,
                db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).first().catch(() => ({ cnt: 0 })) as any
            ]);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actualColumns = (pragmaResult.results || []).map((row: any) => row.name as string);

            const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
            const extraColumns = actualColumns.filter((col: string) => !expectedColumns.includes(col));
            const rowCount = countResult?.cnt ?? 0;

            const hasDrift = missingColumns.length > 0 || extraColumns.length > 0;
            const tableExists = actualColumns.length > 0;

            return {
                name: tableName,
                status: !tableExists ? 'missing' : hasDrift ? 'drift' : 'ok',
                expectedColumns,
                actualColumns,
                missingColumns,
                extraColumns,
                fixSql: missingColumns.length > 0 ? generateFixSql(tableName, missingColumns, table) : null,
                rowCount,
            };
        } catch {
            return {
                name: tableName,
                status: 'missing',
                expectedColumns,
                actualColumns: [],
                missingColumns: expectedColumns,
                extraColumns: [],
                fixSql: null,
                rowCount: 0,
            } as any;
        }
    });

    const tables = await Promise.all(tablePromises);
    const auditDurationMs = Math.round(performance.now() - auditStart);

    return { tables, dbOk, latencyMs: trueLatencyMs, auditDurationMs };
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
        'AXIOM_DATASET',
        'AXIOM_TOKEN',
    ];
    const vars: Record<string, boolean> = {};
    for (const key of keys) {
        vars[key] = !!process.env[key];
    }
    return vars;
}

/**
 * Probe Axiom: confirm both env vars are present and the dataset is reachable
 * with the supplied token. Fails fast (3s timeout) and never exposes the token.
 * If `configured === false`, errors emitted by the worker fall back to console
 * only — admins should see the banner immediately.
 */
async function probeAxiom() {
    const dataset = process.env.AXIOM_DATASET || '';
    const token = process.env.AXIOM_TOKEN || '';
    const configured = !!dataset && !!token;
    if (!configured) {
        return {
            configured,
            reachable: false,
            dataset: dataset || null,
            datasetSet: !!dataset,
            tokenSet: !!token,
            latencyMs: 0,
        };
    }
    const start = performance.now();
    try {
        const res = await fetch(`https://api.axiom.co/v1/datasets/${encodeURIComponent(dataset)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(3000),
        });
        const latencyMs = Math.round(performance.now() - start);
        return {
            configured,
            reachable: res.ok,
            dataset,
            datasetSet: true,
            tokenSet: true,
            latencyMs,
            statusCode: res.status,
        };
    } catch (e) {
        return {
            configured,
            reachable: false,
            dataset,
            datasetSet: true,
            tokenSet: true,
            latencyMs: Math.round(performance.now() - start),
            error: e instanceof Error ? e.message : String(e),
        };
    }
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

        const [dbResult, storageResult, migrationsResult, petshieldResult, scraperResult, axiomResult] = await Promise.allSettled([
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
            probeAxiom(),
        ]);

        // Unpack results with safe defaults
        const db = dbResult.status === 'fulfilled' ? dbResult.value : { tables: [], dbOk: false, latencyMs: 0, auditDurationMs: 0 };
        const storage = storageResult.status === 'fulfilled' ? storageResult.value : { ok: false, latencyMs: 0, error: 'probe failed' };
        const migrations = migrationsResult.status === 'fulfilled' ? migrationsResult.value : { applied: [], count: 0 };
        const petshield = petshieldResult.status === 'fulfilled' ? petshieldResult.value : { status: 'down' as ServiceStatus, latencyMs: 0 };
        const scraper = scraperResult.status === 'fulfilled' ? scraperResult.value : { status: 'down' as ServiceStatus, latencyMs: 0 };
        const axiom = axiomResult.status === 'fulfilled' ? axiomResult.value : { configured: false, reachable: false, dataset: null, datasetSet: false, tokenSet: false, latencyMs: 0 };

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
            axiom,
            environment: {
                version: '2.10.0-8',
                runtime: 'edge',
                vars: checkEnvironment(),
            },
            meta: { checkedAt: new Date().toISOString(), auditDurationMs: db.auditDurationMs },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
