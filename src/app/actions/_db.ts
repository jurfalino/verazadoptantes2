// NOT 'use server' (since the reel-11 fixes): these are server helpers —
// getDb, getUser and the admin checks — imported by actions and routes. As a
// 'use server' module every export here was a browser-callable endpoint
// (including checkIsAdmin(email), which answered "is this email an admin?").
// Never import this file from a client component.

import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { perRequest } from '@/lib/requestMemo';
import { isAdmin as checkIsAdmin, isAdminAsync as checkIsAdminAsync, isModeratorOrAdminAsync as checkIsModeratorOrAdminAsync } from '@/config/admins';

// Re-export canonical getDb for use via actions barrel
export { getDb };

// Re-export for use in other action modules
export { checkIsAdmin, checkIsAdminAsync, checkIsModeratorOrAdminAsync };

// auth is imported lazily so NextAuth is not parsed/initialized at module load
// (cold-start optimization — anonymous requests never touch auth)

export async function getUser() {
    // Once per request (src/lib/requestMemo.ts): every action and loader asks, and each auth()
    // is a D1 read in the jwt callback — ~180 ms from Argentina.
    const email = await perRequest('getUser', async () => {
        try {
            const { auth } = await import('@/auth');
            const session = await auth();
            return session?.user?.email ?? null;
        } catch (e) {
            logger.warn('getUser auth failed', { error: e instanceof Error ? e.message : String(e) });
            return null;
        }
    });
    if (email) return email;
    throw new Error('Authentication required');
}

export async function getIsAdmin(): Promise<boolean> {
    try {
        const { auth } = await import('@/auth');
        const session = await auth();
        return await checkIsAdminAsync(session?.user?.email);
    } catch (e) {
        logger.warn('getIsAdmin check failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}

/**
 * Returns true if the current session user is a bootstrap admin, a DB-grant
 * admin, OR a DB-grant moderator (v2.18.8). Used to gate audit-log
 * visibility on the adopter profile page.
 */
export async function getIsModeratorOrAdmin(): Promise<boolean> {
    try {
        const { auth } = await import('@/auth');
        const session = await auth();
        return await checkIsModeratorOrAdminAsync(session?.user?.email);
    } catch (e) {
        logger.warn('getIsModeratorOrAdmin check failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}
