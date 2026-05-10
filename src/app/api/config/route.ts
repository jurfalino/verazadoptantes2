export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { appConfig } from "@/db/schema";
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * Public endpoint: returns only whitelisted UI feature flags.
 * No authentication required — these flags control client-side UI visibility
 * for ALL users (not just admins). Sensitive admin config stays in /api/admin/config.
 */

const PUBLIC_FLAG_KEYS = [
    'ENABLE_CONTENT_IMPORT',
    'ENABLE_ANIMALS_FOR_ADOPTION',
    'ENABLE_SEARCH_CARD_METADATA',
    'ENABLE_MILESTONE_BADGE',
    'SOCIAL_PROOF_ENABLED',
    'SOCIAL_PROOF_MESSAGES',
] as const;

const PUBLIC_FLAG_DEFAULTS: Record<string, string> = {
    ENABLE_CONTENT_IMPORT: 'false',
    ENABLE_ANIMALS_FOR_ADOPTION: 'false',
    ENABLE_SEARCH_CARD_METADATA: 'true',
    ENABLE_MILESTONE_BADGE: 'true',
    SOCIAL_PROOF_ENABLED: 'false',
    SOCIAL_PROOF_MESSAGES: '[]',
};

export async function GET() {
    try {
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ config: { ...PUBLIC_FLAG_DEFAULTS } });
        }

        const rows = await db.select().from(appConfig)
            .where(inArray(appConfig.key, [...PUBLIC_FLAG_KEYS]));

        const config: Record<string, string> = { ...PUBLIC_FLAG_DEFAULTS };
        for (const row of rows) {
            config[row.key] = row.value;
        }

        return NextResponse.json({ config });
    } catch (e) {
        // Falls back to PUBLIC_FLAG_DEFAULTS — log so a flaky DB doesn't silently
        // serve default config to every public page load.
        logger.warn('GET /api/config failed — serving PUBLIC_FLAG_DEFAULTS', {
            error: e instanceof Error ? e.message : String(e),
        });
        return NextResponse.json({ config: { ...PUBLIC_FLAG_DEFAULTS } });
    }
}
