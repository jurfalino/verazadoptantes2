import { eq } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { appConfig } from '@/db/schema';
import { logger } from '@/lib/logger';
import { getRequestContext } from '@/lib/requestContext';

type Db = Awaited<ReturnType<typeof getDb>>;

// "Name <address>" so inboxes show the brand rather than a bare address, which
// reads as automated spam. Mirrored in wrangler.toml [vars] and the
// followup-cron worker's own default — all three must agree.
const DEFAULT_EMAIL_FROM = 'BuenAdoptante <noreply@buenadoptante.org>';

function readEnv(name: string): string {
    try {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (ctx?.env ?? {}) as Record<string, any>;
        if (typeof env[name] === 'string' && env[name]) return env[name] as string;
    } catch { /* not in Cloudflare context */ }
    return process.env[name] || '';
}

/**
 * Resend config: appConfig row first (admin-settable without a deploy),
 * Cloudflare secret / process.env fallback — telegram.ts pattern.
 */
export async function resolveEmailConfig(db: Db): Promise<{ apiKey: string | null; from: string }> {
    let apiKey = readEnv('RESEND_API_KEY');
    let from = readEnv('EMAIL_FROM') || DEFAULT_EMAIL_FROM;
    try {
        const rows = await Promise.all(['RESEND_API_KEY', 'EMAIL_FROM'].map(k =>
            db.select().from(appConfig).where(eq(appConfig.key, k)).get()
        ));
        apiKey = rows[0]?.value || apiKey;
        from = rows[1]?.value || from;
    } catch (e) {
        // Best-effort: the env fallback stands, but a broken read must be visible.
        logger.warn('resolveEmailConfig: appConfig read failed', { error: e instanceof Error ? e.message : String(e) });
    }
    return { apiKey: apiKey || null, from };
}

/** Anything that is not production (staging, preview, local) labels its emails. */
export function isStagingEnvironment(): boolean {
    return process.env.APP_ENVIRONMENT !== 'production';
}

/** Public base URL for links that go out in emails. */
export function appBaseUrl(): string {
    return !isStagingEnvironment()
        ? 'https://buenadoptante.org'
        : 'https://staging.buenadoptante.org';
}
