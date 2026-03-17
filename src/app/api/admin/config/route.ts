export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { getDb } from "@/app/actions";
import { appConfig, adopterStats } from "@/db/schema";
import { sql, asc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    // Fetch current config
    const configRows = await db.select().from(appConfig).all();
    const config: Record<string, string> = {};
    for (const row of configRows) {
        config[row.key] = row.value;
    }

    // Fetch stats info
    const statsCountResult = await db.select({ count: sql<number>`count(*)` }).from(adopterStats);
    const statsCount = statsCountResult[0]?.count ?? 0;

    // Oldest stat
    const oldestResult = await db.select({ createdAt: adopterStats.createdAt })
        .from(adopterStats)
        .orderBy(asc(adopterStats.createdAt))
        .limit(1);
    const oldestStat = oldestResult[0]?.createdAt?.toISOString() ?? null;

    return NextResponse.json({
        config: {
            // Threshold defaults
            too_many_adoptions_threshold: config['too_many_adoptions_threshold'] || '5',
            too_many_adoptions_period_days: config['too_many_adoptions_period_days'] || '90',
            too_many_requests_threshold: config['too_many_requests_threshold'] || '3',
            too_many_requests_period_days: config['too_many_requests_period_days'] || '30',
            // Feature flags (from DB)
            ENABLE_CONTENT_IMPORT: config['ENABLE_CONTENT_IMPORT'] || 'false',
            ENABLE_ANIMALS_FOR_ADOPTION: config['ENABLE_ANIMALS_FOR_ADOPTION'] || 'false',
            // Social proof banner
            SOCIAL_PROOF_ENABLED: config['SOCIAL_PROOF_ENABLED'] || 'false',
            SOCIAL_PROOF_MESSAGES: config['SOCIAL_PROOF_MESSAGES'] || '[]',
        },
        statsCount,
        oldestStat
    });
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    const body = await request.json() as Record<string, unknown>;

    // Upsert config values
    for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') {
            await db.insert(appConfig)
                .values({
                    key,
                    value,
                    updatedAt: new Date(),
                    updatedBy: session.user.email
                })
                .onConflictDoUpdate({
                    target: appConfig.key,
                    set: {
                        value,
                        updatedAt: new Date(),
                        updatedBy: session.user.email
                    }
                });
        }
    }

    return NextResponse.json({ success: true });
}
