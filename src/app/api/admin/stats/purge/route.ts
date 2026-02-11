export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { getDb } from "@/app/actions";
import { adopterStats } from "@/db/schema";
import { sql, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    const body: { days?: number } = await request.json();
    const { days } = body;
    if (!days || typeof days !== 'number' || days < 1) {
        return NextResponse.json({ error: "Invalid days parameter" }, { status: 400 });
    }

    // Calculate cutoff date
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Count stats to delete
    const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(adopterStats)
        .where(lt(adopterStats.createdAt, cutoffDate));
    const deleteCount = countResult[0]?.count ?? 0;

    // Delete old stats
    await db.delete(adopterStats).where(lt(adopterStats.createdAt, cutoffDate));

    // Count remaining
    const remainingResult = await db.select({ count: sql<number>`count(*)` }).from(adopterStats);
    const remaining = remainingResult[0]?.count ?? 0;

    return NextResponse.json({
        deleted: deleteCount,
        remaining
    });
}
