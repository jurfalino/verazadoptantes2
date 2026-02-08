export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

/**
 * Schema definition: expected columns for each table.
 * This MUST stay in sync with src/db/schema.ts.
 * If you add a column to the schema, add it here too.
 */
const EXPECTED_SCHEMA: Record<string, string[]> = {
    adopters: [
        'id', 'name', 'contact_info', 'address_info', 'family_members', 'notes',
        'created_at', 'updated_at', 'status', 'added_by', 'source_url',
    ],
    adoptions: [
        'id', 'adopter_id', 'animal_name', 'species', 'details', 'status', 'rating',
        'comments', 'date', 'added_by', 'on_behalf_of', 'record_type',
        'delivered_to_home', 'verified_address', 'identity_verified', 'source_url',
    ],
    adopter_images: [
        'id', 'adopter_id', 'adoption_id', 'url', 'caption', 'uploaded_at', 'added_by', 'is_profile_picture',
    ],
    adopter_flags: [
        'id', 'adopter_id', 'flagged_by', 'reason', 'target_adopter_id', 'details', 'created_at',
    ],
    adopter_history: [
        'id', 'adopter_id', 'changed_by', 'changes', 'changed_at',
    ],
    adopter_stats: [
        'id', 'adopter_id', 'event_type', 'created_at',
    ],
    adoption_images: [
        'id', 'adoption_id', 'url', 'caption', 'uploaded_at', 'added_by',
    ],
    searches: [
        'id', 'query', 'type', 'count', 'last_searched_at',
    ],
    app_config: [
        'key', 'value', 'updated_at', 'updated_by',
    ],
};

export async function GET() {
    const mismatches: Array<{
        table: string;
        missing: string[];
        extra: string[];
    }> = [];

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json(
                { status: 'error', message: 'No database binding found' },
                { status: 500 }
            );
        }

        for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
            const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            const actualColumns = (result.results || []).map((row: any) => row.name as string);

            const missing = expectedColumns.filter(col => !actualColumns.includes(col));
            const extra = actualColumns.filter(col => !expectedColumns.includes(col));

            if (missing.length > 0 || extra.length > 0) {
                mismatches.push({ table, missing, extra });
            }
        }

        if (mismatches.length > 0) {
            return NextResponse.json(
                {
                    status: 'schema_mismatch',
                    message: `${mismatches.length} table(s) have schema mismatches`,
                    mismatches,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            status: 'ok',
            tables: Object.keys(EXPECTED_SCHEMA).length,
            message: 'All tables match expected schema',
        });

    } catch (error) {
        return NextResponse.json(
            { status: 'error', message: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
