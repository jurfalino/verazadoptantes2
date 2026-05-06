import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/form/{userId}
 * Quick validation check — contract-app calls this to confirm the userId is valid
 * before showing the form.
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { userId } = await params;
    const origin = request.headers.get('origin');

    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('api/form/[userId]: db unavailable', new Error('getDb returned null'), { userId });
            return withCors(NextResponse.json({ valid: false, errorId }, { status: 500 }), origin);
        }

        const { users } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const user = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, userId))
            .get();

        return withCors(NextResponse.json({
            valid: !!user,
            userName: user?.name || null,
        }), origin);
    } catch (e) {
        const errorId = logger.error('api/form/[userId] failed', e, { userId });
        return withCors(NextResponse.json({ valid: false, errorId }, { status: 500 }), origin);
    }
}
