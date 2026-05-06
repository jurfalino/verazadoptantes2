/**
 * Axiom Logger for Cloudflare Workers/Pages
 * 
 * Features:
 * - Unique error IDs for log correlation
 * - Performance timing traces
 * - Edge Runtime compatible (HTTP API, no SDK)
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

// Generate short unique error ID (8 chars)
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
function getEnvironmentInfo(): { env: string; domain?: string; branch?: string; requestId?: string } {
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

        return { env: envName, domain, branch, requestId: getRequestId() };
    } catch {
        return { env: 'local' };
    }
}

// Send log to Axiom (using waitUntil to keep worker alive on Edge)
async function sendToAxiom(entries: LogEntry[]) {
    const config = getAxiomConfig();
    if (!config.dataset || !config.token) {
        // Local dev fallback: compact one-liner per entry
        for (const entry of entries) {
            const { level, message, _time, error: _err, ...rest } = entry;
            const tag = `[${level.toUpperCase()}]`;
            // Only show non-empty extra data
            const extras = Object.keys(rest).length > 0 ? rest : undefined;
            if (level === 'error') {
                console.error(tag, message, extras ?? '');
            } else if (level === 'warn') {
                console.warn(tag, message, extras ?? '');
            } else {
                console.log(tag, message, extras ?? '');
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
        sendToAxiom([entry]);
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
        console.warn(`[WARN] ${message}`, data);
        sendToAxiom([entry]);
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
                message: error.message,
                stack: error.stack
            };
        } else if (error) {
            entry.error = {
                name: 'Unknown',
                message: String(error)
            };
        }

        console.error(`[ERROR] ${message} (ID: ${errorId})`, error, data);
        sendToAxiom([entry]);

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
