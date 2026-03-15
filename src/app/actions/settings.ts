'use server';

import { getDb, getUser } from './_db';
import { userProfiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { updateCountrySchema } from './validation';

export interface UserSettings {
    country: string | null;
    countryConfirmed: boolean;
    province: string | null;
    provinceCode: string | null;
    city: string | null;
    timezone: string | null;
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
                        `SELECT up.country, up.country_confirmed, up.province, up.province_code, up.city, up.timezone FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(userEmail).first<{ country: string | null; country_confirmed: number; province: string | null; province_code: string | null; city: string | null; timezone: string | null }>();
                    if (row) {
                        return {
                            country: row.country || null,
                            countryConfirmed: row.country_confirmed === 1,
                            province: row.province || null,
                            provinceCode: row.province_code || null,
                            city: row.city || null,
                            timezone: row.timezone || null,
                        };
                    }
                }
            } catch { /* env not available in local dev */ }
            return null;
        }

        return {
            country: user.country || null,
            countryConfirmed: user.countryConfirmed === 1,
            province: user.province || null,
            provinceCode: user.provinceCode || null,
            city: user.city || null,
            timezone: user.timezone || null,
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
    const parsed = updateCountrySchema.safeParse({ country });
    if (!parsed.success) {
        throw new Error(`Invalid country: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

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
            `INSERT INTO user_profiles (user_id, country, country_confirmed)
             VALUES (?, ?, 1)
             ON CONFLICT(user_id) DO UPDATE SET country = excluded.country, country_confirmed = 1`
        ).bind(user.id, country).run();

        logger.info('User country updated', { userEmail, country });

        return { success: true };
    } catch (error) {
        logger.error('updateUserCountry failed', error);
        return { success: false };
    }
}

/**
 * Get the current user's display name from the `user` table.
 */
export async function getUserName(): Promise<string | null> {
    try {
        const userEmail = await getUser();
        if (!userEmail || userEmail === 'unknown') return null;

        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (!env?.DB) return null;

        const row = await env.DB.prepare(
            `SELECT name FROM user WHERE email = ? LIMIT 1`
        ).bind(userEmail).first<{ name: string | null }>();

        return row?.name || null;
    } catch (error) {
        logger.error('getUserName failed', error);
        return null;
    }
}

/**
 * Update the current user's display name in the `user` table.
 */
export async function updateUserName(name: string): Promise<{ success: boolean }> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
        throw new Error('Name must be between 1 and 100 characters');
    }

    try {
        const userEmail = await getUser();
        if (!userEmail || userEmail === 'unknown') {
            throw new Error('Not authenticated');
        }

        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (!env?.DB) throw new Error('Database not available');

        await env.DB.prepare(
            `UPDATE user SET name = ? WHERE email = ?`
        ).bind(trimmed, userEmail).run();

        logger.info('User name updated', { userEmail, name: trimmed });

        return { success: true };
    } catch (error) {
        logger.error('updateUserName failed', error);
        return { success: false };
    }
}
