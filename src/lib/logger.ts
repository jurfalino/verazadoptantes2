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

// Send log to Axiom (fire and forget)
async function sendToAxiom(entries: LogEntry[]) {
    const config = getAxiomConfig();
    if (!config.dataset || !config.token) {
        console.log('[Logger] Axiom not configured, logging locally:', entries);
        return;
    }

    try {
        await fetch(`https://api.axiom.co/v1/datasets/${config.dataset}/ingest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(entries)
        });
    } catch (e) {
        console.error('[Logger] Failed to send to Axiom:', e);
    }
}

// Main logger
export const logger = {
    debug(message: string, data?: Record<string, unknown>) {
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'debug',
            message,
            ...data
        };
        console.log(`[DEBUG] ${message}`, data);
        // Don't send debug to Axiom to save quota
    },

    info(message: string, data?: Record<string, unknown>) {
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'info',
            message,
            ...data
        };
        console.log(`[INFO] ${message}`, data);
        sendToAxiom([entry]);
    },

    warn(message: string, data?: Record<string, unknown>) {
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'warn',
            message,
            ...data
        };
        console.warn(`[WARN] ${message}`, data);
        sendToAxiom([entry]);
    },

    error(message: string, error?: Error | unknown, data?: Record<string, unknown>): string {
        const errorId = generateErrorId();
        const entry: LogEntry = {
            _time: new Date().toISOString(),
            level: 'error',
            message,
            errorId,
            ...data
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
