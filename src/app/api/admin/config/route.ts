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
            // Feature flags (from DB). Adding a new flag here requires also
            // updating src/config/features.ts (FEATURE_FLAGS const + default in
            // getAllFeatureFlags) and src/app/admin/config/page.tsx (useState
            // initializer + fetch hydration + admin toggle list). The four-place
            // duplication is a known wart — see CHANGELOG v2.14.3.
            ENABLE_CONTENT_IMPORT: config['ENABLE_CONTENT_IMPORT'] || 'false',
            ENABLE_ANIMALS_FOR_ADOPTION: config['ENABLE_ANIMALS_FOR_ADOPTION'] || 'false',
            ENABLE_SEARCH_CARD_METADATA: config['ENABLE_SEARCH_CARD_METADATA'] || 'true',
            ENABLE_CHAT_WIDGET: config['ENABLE_CHAT_WIDGET'] || 'false',
            ENABLE_MILESTONE_BADGE: config['ENABLE_MILESTONE_BADGE'] || 'true',
            WIZARD_ALERTS_AS_CARD: config['WIZARD_ALERTS_AS_CARD'] || 'true',
            // Telegram support chat — chat_id is non-sensitive and returned
            // verbatim. The bot token and webhook secret are sensitive: never
            // returned to the client. Instead we expose a *_SET indicator so
            // the UI can show "(configured)" without leaking the value.
            TELEGRAM_ADMIN_CHAT_ID: config['TELEGRAM_ADMIN_CHAT_ID'] || '',
            TELEGRAM_BOT_TOKEN_SET: config['TELEGRAM_BOT_TOKEN'] ? 'true' : 'false',
            TELEGRAM_WEBHOOK_SECRET_SET: config['TELEGRAM_WEBHOOK_SECRET'] ? 'true' : 'false',
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
