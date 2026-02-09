export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdmin } from "@/config/admins";
import { getDb } from "@/app/actions";
import { adopters, adoptions, adopterImages, adoptionImages, adopterFlags, adopterHistory, appConfig } from "@/db/schema";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

// Table config: drizzle table ref + raw table name for DELETE
const TABLE_MAP = {
    adopters: { ref: adopters, name: 'adopters' },
    adoptions: { ref: adoptions, name: 'adoptions' },
    adopter_images: { ref: adopterImages, name: 'adopter_images' },
    adoption_images: { ref: adoptionImages, name: 'adoption_images' },
    adopter_flags: { ref: adopterFlags, name: 'adopter_flags' },
    adopter_history: { ref: adopterHistory, name: 'adopter_history' },
    app_config: { ref: appConfig, name: 'app_config' },
} as const;

type TableKey = keyof typeof TABLE_MAP;

// Ordered for FK safety: children first, parents last (for replace mode deletion)
const DELETE_ORDER: TableKey[] = [
    'adoption_images',
    'adopter_images',
    'adopter_flags',
    'adopter_history',
    'adoptions',
    'app_config',
    'adopters',
];

// Ordered for FK safety: parents first, children last (for insertion)
const INSERT_ORDER: TableKey[] = [
    'adopters',
    'app_config',
    'adoptions',
    'adopter_flags',
    'adopter_history',
    'adopter_images',
    'adoption_images',
];

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    try {
        const body = await request.json() as {
            version?: string;
            tables?: Record<string, Record<string, unknown>[]>;
            mode?: 'merge' | 'replace';
        };

        // Validate structure
        if (!body.version || !body.tables) {
            return NextResponse.json({ error: "Invalid export file format: missing version or tables" }, { status: 400 });
        }

        const mode: 'merge' | 'replace' = body.mode || 'merge';
        const summary: Record<string, number> = {};

        // Replace mode: delete all existing data first (in FK-safe order)
        if (mode === 'replace') {
            for (const key of DELETE_ORDER) {
                if (body.tables[key]) {
                    await db.run(sql.raw(`DELETE FROM ${TABLE_MAP[key].name}`));
                }
            }
        }

        // Insert data in FK-safe order
        for (const key of INSERT_ORDER) {
            const rows = body.tables[key];
            if (!rows || !Array.isArray(rows) || rows.length === 0) {
                summary[key] = 0;
                continue;
            }

            const tableName = TABLE_MAP[key].name;

            // Build column list from first row
            const columns = Object.keys(rows[0]);
            const columnList = columns.map(c => `"${c}"`).join(', ');

            // Insert rows in batches to avoid hitting query size limits
            const BATCH_SIZE = 50;
            let inserted = 0;

            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);

                for (const row of batch) {
                    const values = columns.map(c => {
                        const v = row[c];
                        if (v === null || v === undefined) return 'NULL';
                        if (typeof v === 'number') return String(v);
                        // Escape single quotes in strings
                        return `'${String(v).replace(/'/g, "''")}'`;
                    }).join(', ');

                    const verb = mode === 'merge' ? 'INSERT OR REPLACE' : 'INSERT';
                    await db.run(sql.raw(`${verb} INTO ${tableName} (${columnList}) VALUES (${values})`));
                    inserted++;
                }
            }

            summary[key] = inserted;
        }

        return NextResponse.json({
            success: true,
            mode,
            summary,
            importedAt: new Date().toISOString(),
            importedBy: session.user.email,
        });

    } catch (error: unknown) {
        console.error("Import error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: `Import failed: ${message}` }, { status: 500 });
    }
}
