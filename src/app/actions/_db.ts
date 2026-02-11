'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { isAdmin as checkIsAdmin, isAdminAsync as checkIsAdminAsync } from '@/config/admins';

// Re-export for use in other action modules
export { checkIsAdmin, checkIsAdminAsync };

export async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return await createDb(env.DB);
        }
    } catch (e) {
        // Ignore - not in Cloudflare context
    }

    // Fallback for local development
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        try {
            const { createLocalDb } = await import('@/db/local');
            return await createLocalDb('local.db');
        } catch (e) {
            console.error("[getDb] Local DB Init Error:", e);
        }
    }
    return undefined;
}

export async function getUser() {
    try {
        const session = await auth();
        if (session?.user?.email) return session.user.email;
    } catch (e) {
        console.error("getUser Auth Error:", e);
        // Auth failed
    }

    return 'anonymous';
}

export async function getIsAdmin(): Promise<boolean> {
    try {
        const session = await auth();
        return await checkIsAdminAsync(session?.user?.email);
    } catch (e) {
        logger.warn('getIsAdmin check failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}
