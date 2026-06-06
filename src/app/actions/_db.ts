'use server';

import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isAdmin as checkIsAdmin, isAdminAsync as checkIsAdminAsync, isModeratorOrAdminAsync as checkIsModeratorOrAdminAsync } from '@/config/admins';

// Re-export canonical getDb for use via actions barrel
export { getDb };

// Re-export for use in other action modules
export { checkIsAdmin, checkIsAdminAsync, checkIsModeratorOrAdminAsync };

// auth is imported lazily so NextAuth is not parsed/initialized at module load
// (cold-start optimization — anonymous requests never touch auth)

export async function getUser() {
    try {
        const { auth } = await import('@/auth');
        const session = await auth();
        if (session?.user?.email) return session.user.email;
    } catch (e) {
        logger.warn('getUser auth failed', { error: e instanceof Error ? e.message : String(e) });
    }

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
