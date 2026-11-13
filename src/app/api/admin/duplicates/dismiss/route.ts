export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { duplicateCandidates, adopterFlags } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/duplicates/dismiss
 * Dismiss a duplicate candidate or user flag
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { candidateId, flagId } = await request.json() as { candidateId?: string; flagId?: string };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        if (candidateId) {
            // Dismiss system-detected candidate. Whoever answered «No sé» on it hears the answer (best-effort).
            const pair = await db.select({ a: duplicateCandidates.adopter1Id, b: duplicateCandidates.adopter2Id })
                .from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).get();
            const { unsureAskersOf, tellUnsureAskers } = await import('@/lib/pairUnsure');
            const askers = pair ? await unsureAskersOf(db, pair.a, pair.b, { op: 'adminDismiss', candidateId }) : [];
            await db.update(duplicateCandidates).set({
                status: 'dismissed',
                resolvedAt: new Date(),
                resolvedBy: session.user.email,
            }).where(eq(duplicateCandidates.id, candidateId));

            logger.info('Duplicate candidate dismissed', { candidateId, user: session.user.email });
            if (pair) {
                const { clearPairNotices, PAIR_NOTICE_TYPES } = await import('@/lib/pairNotices');
                await clearPairNotices(db, pair.a, pair.b, { types: PAIR_NOTICE_TYPES, ctx: { op: 'adminDismiss', candidateId } });
                await tellUnsureAskers(db, askers, { a: pair.a, b: pair.b, actor: session.user.email, answer: 'different', ctx: { op: 'adminDismiss', candidateId } });
            }
        } else if (flagId) {
            // Dismiss user-flagged duplicate
            await db.delete(adopterFlags).where(eq(adopterFlags.id, flagId));

            logger.info('Duplicate flag dismissed', { flagId, user: session.user.email });
        } else {
            return NextResponse.json({ error: 'Missing candidateId or flagId' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Dismiss duplicate failed', error);
        return NextResponse.json({ error: 'Dismiss failed' }, { status: 500 });
    }
}
