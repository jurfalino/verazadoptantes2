'use server';

import { getDb, getUser } from './_db';
import { userProfiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export interface UserSettings {
    country: string | null;
    countryConfirmed: boolean;
}

/**
 * Get user settings (country info) for the current user.
 */
export async function getUserSettings(): Promise<UserSettings | null> {
    try {
        const db = await getDb();
        const userEmail = await getUser();
        if (!db || !userEmail || userEmail === 'unknown') return null;

        // Look up user ID by email
        const user = await db.select().from(userProfiles).where(
            eq(userProfiles.userId, userEmail)
        ).get();

        // The userId in user_profiles might be the actual user ID, not email
        // Try looking up by matching through the user table
        if (!user) {
            // Fallback: use raw D1 query to join user + user_profiles by email
            try {
                const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
                if (env?.DB) {
                    const row = await env.DB.prepare(
                        `SELECT up.country, up.country_confirmed FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(userEmail).first<{ country: string | null; country_confirmed: number }>();
                    if (row) {
                        return {
                            country: row.country || null,
                            countryConfirmed: row.country_confirmed === 1,
                        };
                    }
                }
            } catch { /* env not available in local dev */ }
            return null;
        }

        return {
            country: user.country || null,
            countryConfirmed: user.countryConfirmed === 1,
        };
    } catch (error) {
        logger.error('getUserSettings failed', error);
        return null;
    }
}

/**
 * Update the current user's country and mark it as confirmed.
 */
export async function updateUserCountry(country: string): Promise<{ success: boolean }> {
    try {
        const db = await getDb();
        const userEmail = await getUser();
        if (!db || !userEmail || userEmail === 'unknown') {
            throw new Error('Not authenticated');
        }

        // Resolve user ID from email
        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (!env?.DB) throw new Error('Database not available');

        const user = await env.DB.prepare(
            `SELECT id FROM user WHERE email = ? LIMIT 1`
        ).bind(userEmail).first<{ id: string }>();

        if (!user) throw new Error('User not found');

        await env.DB.prepare(
            `UPDATE user_profiles SET country = ?, country_confirmed = 1 WHERE user_id = ?`
        ).bind(country, user.id).run();

        logger.info('User country updated', { userEmail, country });

        return { success: true };
    } catch (error) {
        logger.error('updateUserCountry failed', error);
        return { success: false };
    }
}
