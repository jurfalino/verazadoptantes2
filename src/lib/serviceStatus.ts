/**
 * Client-side Cloudflare service-status probe.
 *
 * When a request fails in a way that could be caused by platform degradation
 * (a 5xx / network error, not a validation error), we check whether Cloudflare
 * is currently reporting an incident so the UI can show an honest "it's the
 * provider, not you" message instead of a bare error id.
 *
 * KEY DESIGN CHOICE — this runs in the BROWSER and hits Cloudflare's status
 * page DIRECTLY. That page is hosted by Atlassian Statuspage (independent of
 * Cloudflare) and serves CORS-open `/api/v2/*` JSON. We deliberately do NOT
 * proxy it through our own edge: during a real outage our Worker/D1 may be the
 * thing that's down, so the check must not depend on the same infrastructure.
 *
 * The probe is best-effort: it NEVER throws, times out fast, and caches the
 * result briefly so a burst of errors can't hammer the status endpoint.
 */

const STATUS_SUMMARY_URL = 'https://www.cloudflarestatus.com/api/v2/summary.json';

const CACHE_KEY = 'cf-status-probe';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 2_500;

export interface ServiceStatus {
    /** True when the upstream platform is reporting any active incident / non-normal status. */
    degraded: boolean;
}

interface CachedProbe {
    degraded: boolean;
    ts: number;
}

function readCache(): CachedProbe | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedProbe;
        if (Date.now() - parsed.ts < CACHE_TTL_MS) return parsed;
    } catch {
        // SSR-safe / private-mode: treat as no cache.
    }
    return null;
}

function writeCache(degraded: boolean): void {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ degraded, ts: Date.now() }));
    } catch {
        // Non-fatal — the probe still works without caching.
    }
}

/**
 * Returns `{ degraded }` reflecting Cloudflare's current status. On ANY failure
 * (network, timeout, parse) it resolves to `degraded: false` — we never let the
 * probe itself surface an error or block the caller for long.
 */
export async function checkCloudflareStatus(): Promise<ServiceStatus> {
    const result: ServiceStatus = { degraded: false };
    if (typeof window === 'undefined') return result;

    const cached = readCache();
    if (cached) return { ...result, degraded: cached.degraded };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(STATUS_SUMMARY_URL, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) return result;
        const data = (await res.json()) as {
            status?: { indicator?: string };
            incidents?: Array<{ impact?: string; resolved_at?: string | null }>;
        };
        // Degraded if the overall indicator isn't "none", OR there's an
        // unresolved incident. Component-level checks alone are unreliable:
        // a real D1 outage can be filed as a "network" incident while the D1
        // component still reads "operational" (observed 2026-07-03).
        const indicatorBad = !!data.status?.indicator && data.status.indicator !== 'none';
        const hasActiveIncident = (data.incidents ?? []).some(i => !i.resolved_at);
        result.degraded = indicatorBad || hasActiveIncident;
        writeCache(result.degraded);
        return result;
    } catch {
        return result;
    } finally {
        clearTimeout(timer);
    }
}
