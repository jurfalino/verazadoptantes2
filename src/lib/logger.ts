/**
 * Axiom Logger for Cloudflare Workers/Pages
 * 
 * Features:
 * - Unique error IDs for log correlation
 * - Performance timing traces
 * - Edge Runtime compatible (HTTP API, no SDK)
 */

import { getRequestContext } from '@/lib/requestContext';

// Generate short unique error ID (8 chars)
/**
 * The `cause` chain of an error, as name + message (no stacks, at most 3 deep).
 * Drizzle wraps every D1 failure as "Failed query: …" and puts the database's
 * own reason in `cause` — without it a failed duplicate Scan (2026-10-10,
 * errorId 60d0dc35) was logged with the SQL but not why D1 rejected it.
 */
/**
 * Drizzle puts the bound values of a failed query in its error text
 * ("Failed query: insert into adopters …\nparams: Ana Pérez,11 4455…") — a
 * person's name and contacts. Log text keeps the query, never the values
 * (2026-11-04 audit: two production errors had shipped them to Axiom). Pure.
 */
export function scrubDbParams(text: string): string {
    const i = text.indexOf('params:');
    if (i === -1) return text;
    // Everything after "params:" goes — a bound value can span lines (a pretty-printed
    // request body) — except a stack's "at" frames, which hold no values.
    const frames = text.slice(i).split('\n').filter(l => /^\s+at /.test(l));
    return `${text.slice(0, i)}params: [redacted]${frames.length ? `\n${frames.join('\n')}` : ''}`;
}

/**
 * Every string in a log entry, scrubbed. Recurses into plain objects and arrays
 * only; an Error becomes its redacted fields (a raw one carries the query's
 * values), a value with toJSON (Date, URL) its JSON, anything deeper a string.
 */
export function scrubLogValues<T>(value: T, depth = 0): T {
    if (typeof value === 'string') return scrubDbParams(value) as T;
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) {
        const e = { name: value.name, message: scrubDbParams(value.message), ...causeChain(value) };
        return e as T;
    }
    const withJson = value as { toJSON?: () => unknown };
    if (typeof withJson.toJSON === 'function') return scrubLogValues(withJson.toJSON(), depth) as T;
    if (depth > 4) return scrubDbParams(JSON.stringify(value) ?? '') as T;
    if (Array.isArray(value)) return value.map(v => scrubLogValues(v, depth + 1)) as T;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return scrubDbParams(String(value)) as T;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubLogValues(v, depth + 1)])) as T;
}

export function causeChain(error: Error): { cause?: Array<{ name: string; message: string }> } {
    const chain: Array<{ name: string; message: string }> = [];
    let c: unknown = (error as { cause?: unknown }).cause;
    while (c && chain.length < 3) {
        chain.push(c instanceof Error ? { name: c.name, message: scrubDbParams(c.message) } : { name: 'Unknown', message: scrubDbParams(String(c)) });
        c = c instanceof Error ? (c as { cause?: unknown }).cause : undefined;
    }
    return chain.length ? { cause: chain } : {};
}

export function generateErrorId(): string {
    return crypto.randomUUID().slice(0, 8);
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    _time: string;
    level: LogLevel;
    message: string;
    errorId?: string;
    userId?: string;
    path?: string;
    duration?: number;
    error?: {
        name: string;
        message: string;
        stack?: string;
        /** The underlying error's chain (`error.cause`), outermost first. */
        cause?: Array<{ name: string; message: string }>;
    };
    [key: string]: unknown;
}

interface TraceContext {
    name: string;
    startTime: number;
    metadata?: Record<string, unknown>;
}

// Get Axiom config from env
function getAxiomConfig() {
    try {
        const { env } = getRequestContext();
        return {
            dataset: env?.AXIOM_DATASET || process.env.AXIOM_DATASET || '',
            token: env?.AXIOM_TOKEN || process.env.AXIOM_TOKEN || ''
        };
    } catch {
        return {
            dataset: process.env.AXIOM_DATASET || '',
            token: process.env.AXIOM_TOKEN || ''
        };
    }
}

// Extract request correlation ID from Cloudflare CF-Ray header (or generate fallback)
function getRequestId(): string | undefined {
    try {
        const { cf } = getRequestContext() as unknown as { cf?: { ray?: string } };
        if (cf?.ray) return cf.ray;
    } catch { /* not in request context */ }
    return undefined;
}

// Detect environment (staging, production, local) and domain
function getEnvironmentInfo(): { env: string; domain?: string; branch?: string; requestId?: string; cfRay?: string } {
    try {
        const { env } = getRequestContext();
        const cfEnv = env as unknown as Record<string, string | undefined>;
        // CF_PAGES_BRANCH is set by Cloudflare Pages
        const branch = cfEnv?.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH;
        // CF_PAGES_URL is the deployment URL
        const url = cfEnv?.CF_PAGES_URL || process.env.CF_PAGES_URL;

        // Determine environment from branch or URL
        let envName = 'local';
        if (branch === 'master' || branch === 'main') {
            envName = 'production';
        } else if (branch === 'staging' || url?.includes('staging')) {
            envName = 'staging';
        } else if (branch) {
            envName = `preview-${branch}`;
        }

        // Extract domain from URL if available
        let domain: string | undefined;
        if (url) {
            try {
                domain = new URL(url).hostname;
            } catch {
                domain = url;
            }
        }

        // cfRay too: a caller's own requestId (the API's) replaces requestId, and the ray must survive.
        const ray = getRequestId();
        return { env: envName, domain, branch, requestId: ray, cfRay: ray };
    } catch {
        return { env: 'local' };
    }
}

// v2.19.44: counter of entries dropped to console-only because Axiom isn't
// configured. Surfaces in every fallback log so a misconfigured deploy can't
// silently lose observability — the audit found this was the worst-case
// failure mode (the caller gets a fresh errorId that points to nothing).
let _axiomDroppedCount = 0;
// One-time prominent banner per worker boot when Axiom env is missing in a
// non-local environment. The previous version warned once and then went
// silent; now every subsequent fallback entry below is also tagged with
// `🚨 LOGGER_FALLBACK_NOT_IN_AXIOM` so an operator scanning Cloudflare
// worker logs can't miss it.
let _axiomMissingBannerEmitted = false;

function emitAxiomMissingBannerOnce(envName: string) {
    if (_axiomMissingBannerEmitted) return;
    if (envName === 'local') return;
    _axiomMissingBannerEmitted = true;
    console.error(
        `🚨🚨🚨 LOGGER_BOOT_BANNER: AXIOM_DATASET / AXIOM_TOKEN missing in env="${envName}". ` +
        `Every log line below this point is console-only. Set the secrets in Cloudflare Pages → Settings → Environment Variables, ` +
        `then redeploy. This banner only fires once per worker boot; individual log lines carry a 🚨 LOGGER_FALLBACK prefix.`,
    );
}

// Send log to Axiom (using waitUntil to keep worker alive on Edge)
async function sendToAxiom(entries: LogEntry[]) {
    const config = getAxiomConfig();
    if (!config.dataset || !config.token) {
        // v2.19.44: emit the boot banner once + tag every fallback entry with a
        // prominent prefix. Prior behaviour was a single console.warn at boot —
        // easy to miss in Cloudflare logs and impossible to correlate against a
        // specific user-reported errorId. The fallback prefix `🚨 LOGGER_FALLBACK`
        // (level uppercase) + the structured payload means an operator searching
        // for an id can find it in Cloudflare's Tail even when Axiom never received it.
        const envName = entries[0]?.env as string | undefined;
        if (envName) emitAxiomMissingBannerOnce(envName);
        const isProd = envName && envName !== 'local';
        for (const entry of entries) {
            const { level, message, _time, error: _err, ...rest } = entry;
            const extras = Object.keys(rest).length > 0 ? rest : undefined;
            if (isProd) {
                _axiomDroppedCount++;
                // Always console.error in non-local fallback so it shows up in
                // Cloudflare's "error" log tier no matter what severity the
                // entry originally was. Operator wants to see EVERYTHING that
                // didn't make it to Axiom, not just the explicit errors.
                console.error(
                    `🚨 LOGGER_FALLBACK [${level.toUpperCase()}] (#${_axiomDroppedCount} dropped) ${message}`,
                    extras ?? '',
                );
            } else {
                // Local dev: keep the friendly multi-level behaviour.
                const tag = `[${level.toUpperCase()}]`;
                if (level === 'error') console.error(tag, message, extras ?? '');
                else if (level === 'warn') console.warn(tag, message, extras ?? '');
                else console.log(tag, message, extras ?? '');
            }
        }
        return;
    }

    const doFetch = async () => {
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(`https://api.axiom.co/v1/datasets/${config.dataset}/ingest`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(entries)
                });
                if (res.ok) return;
                // Server error — retry
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
                    continue;
                }
                console.error(`[Logger] Axiom returned ${res.status} after ${MAX_RETRIES + 1} attempts`);
            } catch (e) {
                if (attempt === MAX_RETRIES) {
                    console.error('[Logger] Failed to send to Axiom after retries:', e);
                    return;
                }
                await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
            }
        }
    };

    // Use waitUntil if available (Edge runtime) to prevent worker from terminating
    try {
        const { ctx } = getRequestContext();
        if (ctx?.waitUntil) {
            ctx.waitUntil(doFetch());
        } else {
            doFetch(); // Fallback: fire and forget
        }
    } catch {
        // Not in request context, just fire and forget
        doFetch();
    }
}

// Main logger
export const logger = {
    debug(message: string, data?: Record<string, unknown>) {
        // Debug: only local console, never sent to Axiom (saves quota)
        if (process.env.NODE_ENV === 'development') {
            const extras = data && Object.keys(data).length > 0 ? data : undefined;
            console.log('[DEBUG]', message, extras ?? '');
        }
    },

    info(message: string, data?: Record<string, unknown>) {
        const envInfo = getEnvironmentInfo();
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'info',
            message,
            ...envInfo,
            ...data
        };
        sendToAxiom([scrubLogValues(entry)]);
    },

    warn(message: string, data?: Record<string, unknown>) {
        const envInfo = getEnvironmentInfo();
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'warn',
            message,
            ...envInfo,
            ...data
        };
        console.warn(`[WARN] ${message}`, scrubLogValues(data));
        sendToAxiom([scrubLogValues(entry)]);
    },

    error(message: string, error?: Error | unknown, data?: Record<string, unknown>): string {
        // Allow callers to supply a pre-generated errorId so the id displayed
        // to the user is the same one stored in Axiom (e.g. client-side error
        // boundaries generate the id locally, then POST it to be logged).
        const suppliedId = typeof data?.errorId === 'string' ? data.errorId : undefined;
        const errorId = suppliedId || generateErrorId();
        const { errorId: _omit, ...restData } = data || {};
        const envInfo = getEnvironmentInfo();
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'error',
            message,
            errorId,
            ...envInfo,
            ...restData
        };

        if (error instanceof Error) {
            entry.error = {
                name: error.name,
                message: scrubDbParams(error.message),
                stack: error.stack ? scrubDbParams(error.stack) : error.stack,
                ...causeChain(error),
            };
        } else if (error) {
            entry.error = {
                name: 'Unknown',
                message: scrubDbParams(String(error))
            };
        }

        // The console gets the scrubbed text too, never the raw error object (it carries the query's values).
        console.error(`[ERROR] ${message} (ID: ${errorId})`, entry.error ?? '', scrubLogValues(data));
        sendToAxiom([scrubLogValues(entry)]);

        return errorId; // Return ID for display to user
    }
};

// Performance tracing
export function startTrace(name: string, metadata?: Record<string, unknown>): TraceContext {
    return {
        name,
        startTime: performance.now(),
        metadata
    };
}

export function endTrace(trace: TraceContext, extra?: Record<string, unknown>) {
    const duration = performance.now() - trace.startTime;
    logger.info(`Trace: ${trace.name}`, {
        duration: Math.round(duration),
        durationMs: duration,
        trace: trace.name,
        ...trace.metadata,
        ...extra
    });
    return duration;
}

// Wrapper for tracing async functions
export async function withTrace<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
): Promise<T> {
    const trace = startTrace(name, metadata);
    try {
        const result = await fn();
        endTrace(trace, { success: true });
        return result;
    } catch (error) {
        endTrace(trace, { success: false, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
