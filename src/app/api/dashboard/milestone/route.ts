import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { adoptions } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

export const runtime = 'edge';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return Response.json({ count: 0 });
        }

        const db = await getDb();
        if (!db) return Response.json({ count: 0 });

        const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(adoptions)
            .where(eq(adoptions.addedBy, session.user.email))
            .get();

        return Response.json({ count: result?.count ?? 0 });
    } catch {
        return Response.json({ count: 0 });
    }
}
