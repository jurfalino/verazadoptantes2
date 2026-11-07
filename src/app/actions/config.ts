'use server';

import { appConfig } from '@/db/schema';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { DEFAULT_ADOPTION_CONFIG } from '@/domain/periodAlerts';

export async function getAdoptionConfig() {
    try {
        const db = await getDb();
        if (!db) return { ...DEFAULT_ADOPTION_CONFIG };

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
        // Falls back to hardcoded defaults — log so a flaky DB doesn't silently
        // serve stale thresholds across the whole app.
        logger.error('getAdoptionConfig failed — falling back to hardcoded defaults', error, {
            fallbackUsed: true,
        });
        return { ...DEFAULT_ADOPTION_CONFIG };
    }
}
