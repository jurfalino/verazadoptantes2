/**
 * Durable logging for the follow-up cron.
 *
 * Everything this Worker emitted used to be a bare `console.log`, which reaches
 * only Cloudflare's live runtime stream: no retention without Logpush, nothing
 * in the `buenadoptante` Axiom dataset the rest of the app writes to, and no
 * severity or errorId. For a job that runs once a day at 09:00 ART, writes
 * user-facing notifications and sends mail through Resend, that meant a silent
 * failure would have scrolled away before anyone looked.
 *
 * Shape matches `src/lib/logger.ts` on purpose — same dataset, same `_time` /
 * `level` / `message` / `env` fields — so cron runs sit alongside app events
 * and the existing `level == "error"` queries and dashboards pick them up with
 * no extra wiring. `op: 'followup-cron'` distinguishes them.
 */

export interface AxiomEnv {
    AXIOM_DATASET?: string;
    AXIOM_TOKEN?: string;
    /** 'production' | 'staging' — mirrors the app's env tagging. */
    APP_ENV?: string;
}

type Level = 'info' | 'warn' | 'error';

const AXIOM_INGEST = 'https://api.axiom.co/v1/datasets';

/** 8-char id, same alphabet and length as the app's `generateErrorId`, so an id
 *  quoted from a cron alert can be looked up exactly like an app one. */
export function generateErrorId(): string {
    return crypto.randomUUID().slice(0, 8);
}

/**
 * Log one entry. Always writes to the runtime stream; additionally ships to
 * Axiom when the secrets are bound.
 *
 * Returns the errorId for `level: 'error'` so callers can surface it.
 *
 * Never throws and never blocks the cron: Axiom failures degrade to the console
 * line that was already there. Pass `ctx` so the POST is kept alive with
 * `waitUntil` — without it a scheduled Worker can be torn down mid-flight and
 * the entry is lost, which is exactly the failure this module exists to fix.
 */
export function log(
    env: AxiomEnv,
    level: Level,
    fields: Record<string, unknown>,
    ctx?: { waitUntil(p: Promise<unknown>): void },
): string | undefined {
    const errorId = level === 'error' ? generateErrorId() : undefined;

    const entry = {
        _time: new Date().toISOString(),
        level,
        message: `followup-cron: ${String(fields.message ?? fields.warn ?? fields.error ?? 'run')}`,
        op: 'followup-cron',
        env: env.APP_ENV || 'unknown',
        ...(errorId ? { errorId } : {}),
        ...fields,
    };

    // Keep the runtime line unconditionally — it is the fallback when Axiom is
    // unconfigured or rejecting, and `wrangler tail` is still the fastest way
    // to watch a run live.
    console.log(JSON.stringify(entry));

    if (!env.AXIOM_DATASET || !env.AXIOM_TOKEN) return errorId;

    const send = fetch(`${AXIOM_INGEST}/${env.AXIOM_DATASET}/ingest`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.AXIOM_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([entry]),
    })
        .then(res => {
            if (!res.ok) console.log(JSON.stringify({ op: 'followup-cron', warn: 'axiom ingest rejected', status: res.status }));
        })
        .catch(e => {
            console.log(JSON.stringify({ op: 'followup-cron', warn: 'axiom ingest threw', error: String(e) }));
        });

    if (ctx?.waitUntil) ctx.waitUntil(send);
    return errorId;
}
