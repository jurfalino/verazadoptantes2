'use server';

/**
 * Start and stop "view as" (src/domain/viewAs.ts). Thin: the authorization
 * that counts happens in the jwt callback (src/lib/viewAsSession.ts), because
 * a session update can also reach it straight from the browser.
 */

import { logger } from '@/lib/logger';

export type ViewAsResult = { ok: true } | { ok: false; errorId?: string };

export async function startViewAs(userId: string): Promise<ViewAsResult> {
    const targetUserId = typeof userId === 'string' ? userId : '';
    try {
        const { unstable_update } = await import('@/auth');
        const session = await unstable_update({ viewAs: { userId: targetUserId } } as never);
        const started = !!(session as { viewingAs?: unknown } | null)?.viewingAs
            && (session?.user as { id?: string } | undefined)?.id === targetUserId;
        if (!started) logger.warn('startViewAs: refused', { targetUserId });
        return started ? { ok: true } : { ok: false };
    } catch (e) {
        const errorId = logger.error('startViewAs failed', e, { targetUserId });
        return { ok: false, errorId };
    }
}

export async function stopViewAs(): Promise<ViewAsResult> {
    try {
        const { unstable_update } = await import('@/auth');
        await unstable_update({ viewAs: null } as never);
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('stopViewAs failed', e);
        return { ok: false, errorId };
    }
}
