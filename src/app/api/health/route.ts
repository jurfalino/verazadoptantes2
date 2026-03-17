export const runtime = 'edge';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getColumnNames(table: any): string[] {
    const columns = getTableColumns(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.values(columns).map((col: any) => col.name as string);
}

// All 18+ schema tables for comprehensive drift detection
const SCHEMA_TABLES = [
    adopters, adoptions, adopterImages, adopterFlags,
    adopterHistory, adopterStats, searches, appConfig,
    duplicateTokens, duplicateCandidates, dataRequests,
    users, accounts, sessions, verificationTokens,
    userProfiles, auditLog, notifications, formSubmissions,
    organizations, orgMembers, orgInvites
];

type ServiceStatus = 'ok' | 'starting' | 'degraded' | 'down';

interface ServiceResult {
    status: ServiceStatus;
    latencyMs: number;
}

/**
 * Probe with timeout via AbortController.
 * Returns { ok, latencyMs } or throws on timeout/error.
 */
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

/**
 * Classify latency into status tiers.
 * < 2s = ok, 2-10s = starting (cold start), > 10s = degraded
 */
function classifyLatency(latencyMs: number, ok: boolean): ServiceStatus {
    if (!ok) return 'down';
    if (latencyMs < 2000) return 'ok';
    if (latencyMs < 10000) return 'starting';
    return 'degraded';
}

/**
 * Probe D1 + R2 (combined as "platform" for public view).
 */
async function probePlatform(env: CloudflareEnv): Promise<{ platform: ServiceResult; schemaDrift: Array<{ table: string; driftDetected: boolean }> }> {
    const start = performance.now();
    const schemaDrift: Array<{ table: string; driftDetected: boolean }> = [];
    let dbOk = false;
    let r2Ok = false;

    // DB check + schema validation
    try {
        for (const table of SCHEMA_TABLES) {
            const tableName = getTableName(table);
            const expectedColumns = getColumnNames(table);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all() as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actualColumns = (result.results || []).map((row: any) => row.name as string);

            const missing = expectedColumns.filter(col => !actualColumns.includes(col));
            const extra = actualColumns.filter((col: string) => !expectedColumns.includes(col));

            if (missing.length > 0 || extra.length > 0) {
                schemaDrift.push({ table: tableName, driftDetected: true });
            }
        }
        dbOk = true;
    } catch {
        dbOk = false;
    }

    // R2 check
    try {
        const bucket = (env as unknown as Record<string, unknown>).IMAGES_BUCKET as R2Bucket | undefined;
        if (bucket) {
            await bucket.list({ limit: 1 });
            r2Ok = true;
        }
    } catch {
        r2Ok = false;
    }

    const latencyMs = Math.round(performance.now() - start);
    const allOk = dbOk && r2Ok;

    return {
        platform: {
            status: schemaDrift.length > 0 ? 'degraded' : (allOk ? 'ok' : (dbOk || r2Ok ? 'degraded' : 'down')),
            latencyMs,
        },
        schemaDrift,
    };
}

/**
 * Probe the contract app (PetShield).
 */
async function probeContractApp(): Promise<ServiceResult> {
    const contractUrl = process.env.NEXT_PUBLIC_CONTRACT_URL || 'https://adoptions.pages.dev';
    try {
        const { ok, latencyMs } = await probeFetch(contractUrl, 5000, 'HEAD');
        return { status: classifyLatency(latencyMs, ok), latencyMs };
    } catch {
        return { status: 'down', latencyMs: 0 };
    }
}

/**
 * Probe the AI scraper (Fly.io).
 * 10s timeout to accommodate cold starts.
 */
async function probeScraper(): Promise<ServiceResult> {
    const scraperUrl = process.env.SCRAPER_URL;
    if (!scraperUrl) {
        return { status: 'down', latencyMs: 0 };
    }
    try {
        const { ok, latencyMs } = await probeFetch(`${scraperUrl}/health`, 10000);
        return { status: classifyLatency(latencyMs, ok), latencyMs };
    } catch {
        return { status: 'down', latencyMs: 0 };
    }
}

export async function GET() {
    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json(
                { status: 'down', message: 'No database binding found' },
                {
                    status: 500,
                    headers: { 'Cache-Control': 'public, max-age=30' },
                }
            );
        }

        // Run all probes in parallel
        const [platformResult, petshieldResult, scraperResult] = await Promise.allSettled([
            probePlatform(env),
            probeContractApp(),
            probeScraper(),
        ]);

        const platform = platformResult.status === 'fulfilled'
            ? platformResult.value.platform
            : { status: 'down' as ServiceStatus, latencyMs: 0 };

        const schemaDrift = platformResult.status === 'fulfilled'
            ? platformResult.value.schemaDrift
            : [];

        const petshield = petshieldResult.status === 'fulfilled'
            ? petshieldResult.value
            : { status: 'down' as ServiceStatus, latencyMs: 0 };

        const scraper = scraperResult.status === 'fulfilled'
            ? scraperResult.value
            : { status: 'down' as ServiceStatus, latencyMs: 0 };

        // Determine overall status
        const statuses = [platform.status, petshield.status, scraper.status];
        let overall: 'ok' | 'degraded' | 'down' = 'ok';
        if (statuses.some(s => s === 'down')) {
            overall = 'down';
        } else if (statuses.some(s => s === 'degraded' || s === 'starting')) {
            overall = 'degraded';
        }

        const body = {
            status: overall,
            services: {
                platform,
                petshield,
                scraper,
            },
            ...(schemaDrift.length > 0 ? { schemaDrift } : {}),
            version: '2.10.0-8',
            checkedAt: new Date().toISOString(),
        };

        return NextResponse.json(body, {
            status: overall === 'down' ? 503 : 200,
            headers: {
                'Cache-Control': 'public, max-age=30',
            },
        });

    } catch (error) {
        return NextResponse.json(
            { status: 'down', message: error instanceof Error ? error.message : String(error) },
            {
                status: 500,
                headers: { 'Cache-Control': 'public, max-age=30' },
            }
        );
    }
}
