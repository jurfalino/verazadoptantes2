'use server';

import { getDb } from '@/lib/db';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { isAdmin as checkIsAdmin, isAdminAsync as checkIsAdminAsync } from '@/config/admins';

// Re-export canonical getDb for use via actions barrel
export { getDb };

// Re-export for use in other action modules
export { checkIsAdmin, checkIsAdminAsync };

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
