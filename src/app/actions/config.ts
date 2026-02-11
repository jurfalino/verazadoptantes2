'use server';

import { appConfig } from '@/db/schema';
import { logger } from '@/lib/logger';
import { getDb } from './_db';

export async function getAdoptionConfig() {
    try {
        const db = await getDb();
        if (!db) return {
            threshold: 5,
            periodDays: 90,
            requestsThreshold: 3,
            requestsPeriodDays: 30
        };

        const configRows = await db.select().from(appConfig).all();
        const config: Record<string, string> = {};
        for (const row of configRows) {
            config[row.key] = row.value;
        }

        return {
            threshold: parseInt(config['too_many_adoptions_threshold'] || '5', 10),
            periodDays: parseInt(config['too_many_adoptions_period_days'] || '90', 10),
            requestsThreshold: parseInt(config['too_many_requests_threshold'] || '3', 10),
            requestsPeriodDays: parseInt(config['too_many_requests_period_days'] || '30', 10)
        };
    } catch (error) {
        console.error("Get adoption config error:", error);
        logger.error('Get adoption config failed', error);
        return {
            threshold: 5,
            periodDays: 90,
            requestsThreshold: 3,
            requestsPeriodDays: 30
        };
    }
}
