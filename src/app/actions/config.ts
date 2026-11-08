'use server';

import { appConfig } from '@/db/schema';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { DEFAULT_ADOPTION_CONFIG } from '@/domain/periodAlerts';

/**
 * The "too many" thresholds (Admin). On a failed read the app falls back to the
 * defaults; `strict` (the public API, which fails closed) throws instead, so a
 * DB hiccup is a 503 — never alerts judged against looser thresholds than the
 * Admin set (production is 2 in 10 days; the default is 5 in 90).
 */
export async function getAdoptionConfig(opts: { strict?: boolean } = {}) {
    // A server action: a browser call can send anything, so only a literal `true` is strict.
    const strict = opts?.strict === true;
    try {
        const db = await getDb();
        if (!db) {
            if (strict) throw new Error('getAdoptionConfig: no database');
            return { ...DEFAULT_ADOPTION_CONFIG };
        }

        const configRows = await db.select().from(appConfig).all();
        const config: Record<string, string> = {};
        for (const row of configRows) {
            config[row.key] = row.value;
        }

        return {
            threshold: parseInt(config['too_many_adoptions_threshold'] || String(DEFAULT_ADOPTION_CONFIG.threshold), 10),
            periodDays: parseInt(config['too_many_adoptions_period_days'] || String(DEFAULT_ADOPTION_CONFIG.periodDays), 10),
            requestsThreshold: parseInt(config['too_many_requests_threshold'] || String(DEFAULT_ADOPTION_CONFIG.requestsThreshold), 10),
            requestsPeriodDays: parseInt(config['too_many_requests_period_days'] || String(DEFAULT_ADOPTION_CONFIG.requestsPeriodDays), 10)
        };
    } catch (error) {
        if (strict) {
            logger.warn('getAdoptionConfig failed (strict) — the caller fails closed', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
        // Falls back to hardcoded defaults — log so a flaky DB doesn't silently
        // serve stale thresholds across the whole app.
        logger.error('getAdoptionConfig failed — falling back to hardcoded defaults', error, {
            fallbackUsed: true,
        });
        return { ...DEFAULT_ADOPTION_CONFIG };
    }
}
