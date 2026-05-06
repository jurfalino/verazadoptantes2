/**
 * Feature Flags System
 * 
 * Flags can be:
 * 1. DB-backed (stored in appConfig table, toggleable via Admin UI)
 * 2. Env-backed (set in environment variables)
 * 
 * DB flags take precedence over env flags.
 * Uses dynamic import for getDb to avoid Edge runtime issues in local dev.
 */

import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Define all feature flags with their defaults
export const FEATURE_FLAGS = {
    ENABLE_CONTENT_IMPORT: false,
    ENABLE_ANIMALS_FOR_ADOPTION: false,
    ENABLE_SEARCH_CARD_METADATA: true,
    ENABLE_VISIT_INTENT_PROMPT: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// Cache for feature flag values (refreshed on each request in Edge)
const _flagCache: Map<FeatureFlag, boolean> | null = null;

/**
 * Get a feature flag value
 * Priority: DB > ENV > Default
 * 
 * Note: On local dev, DB may not be available, so we gracefully fall back to env/default
 */
export async function getFeatureFlag(flag: FeatureFlag): Promise<boolean> {
    // Try environment variable first (fastest, works everywhere)
    const envValue = process.env[flag];
    if (envValue !== undefined) {
        return envValue === 'true' || envValue === '1';
    }

    // Try DB (only works in production/Cloudflare environment)
    try {
        // Dynamic import to avoid Edge runtime issues in local dev
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (db) {
            const row = await db.select()
                .from(appConfig)
                .where(eq(appConfig.key, flag))
                .get();

            if (row) {
                return row.value === 'true' || row.value === '1';
            }
        }
    } catch {
        // DB unavailable (local dev or error), use default
    }

    // Return default
    return FEATURE_FLAGS[flag];
}

/**
 * Set a feature flag in the database
 */
export async function setFeatureFlag(flag: FeatureFlag, value: boolean, updatedBy?: string): Promise<boolean> {
    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return false;

        await db.insert(appConfig)
            .values({
                key: flag,
                value: value ? 'true' : 'false',
                updatedBy: updatedBy || 'system',
            })
            .onConflictDoUpdate({
                target: appConfig.key,
                set: {
                    value: value ? 'true' : 'false',
                    updatedBy: updatedBy || 'system',
                },
            });

        return true;
    } catch {
        return false;
    }
}

/**
 * Get all feature flags with their current values
 */
export async function getAllFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
    const result: Record<FeatureFlag, boolean> = {
        ENABLE_CONTENT_IMPORT: false,
        ENABLE_ANIMALS_FOR_ADOPTION: false,
        ENABLE_SEARCH_CARD_METADATA: true,
        ENABLE_VISIT_INTENT_PROMPT: false,
    };

    for (const flag of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
        result[flag] = await getFeatureFlag(flag);
    }

    return result;
}
