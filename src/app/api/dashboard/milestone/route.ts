import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { adoptions } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function GET() {
    let userEmail: string | undefined;
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ count: 0 });
        }
        userEmail = session.user.email;

        const db = await getDb();
        if (!db) {
            const errorId = logger.error('dashboard/milestone: db unavailable', new Error('getDb returned null'), { userEmail });
            return Response.json({ count: 0, errorId }, { status: 500 });
        }

        const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(adoptions)
            .where(eq(adoptions.addedBy, userEmail))
            .get();

        return Response.json({ count: result?.count ?? 0 });
    } catch (e) {
        const errorId = logger.error('dashboard/milestone failed', e, { userEmail });
        return Response.json({ count: 0, errorId }, { status: 500 });
    }
}
