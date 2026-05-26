export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { getDb } from "@/app/actions";
import { TABLE_BY_KEY, coerceRow, pickInsertOrder, pickDeleteOrder } from "@/lib/dataMigration";
import { NextResponse } from "next/server";
import { sql, getTableName } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { logger } from "@/lib/logger";

interface ImportPayload {
    version?: string;
    tables?: Record<string, Record<string, unknown>[]>;
    mode?: "merge" | "replace";
    selectedTables?: string[]; // Subset of tables in the payload to actually import
}

// Resolve a JS column name to its drizzle column reference on the table.
// We trust the table object since it's constructed from our schema.
function jsColumn(table: SQLiteTable, jsName: string): AnySQLiteColumn {
    return (table as unknown as Record<string, AnySQLiteColumn>)[jsName];
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actorEmail = session.user.email;

    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    let body: ImportPayload;
    try {
        body = await request.json() as ImportPayload;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.version || !body.tables) {
        return NextResponse.json({ error: "Invalid export file: missing version or tables" }, { status: 400 });
    }

    const mode: "merge" | "replace" = body.mode === "replace" ? "replace" : "merge";

    // Decide which keys to import: caller-selected ∩ keys actually present
    // in the upload ∩ keys we recognise. Unknown keys (e.g. from a future
    // export) are silently ignored.
    const presentInPayload = Object.keys(body.tables).filter(k => !!TABLE_BY_KEY[k]);
    const selectedKeys = body.selectedTables && body.selectedTables.length > 0
        ? presentInPayload.filter(k => body.selectedTables!.includes(k))
        : presentInPayload;

    if (selectedKeys.length === 0) {
        return NextResponse.json({ error: "No matching tables to import" }, { status: 400 });
    }

    const summary: Record<string, { inserted: number; failed: number; skipped: number }> = {};
    const errors: Array<{ table: string; error: string }> = [];

    try {
        // Replace mode: delete first, in reverse FK order
        if (mode === "replace") {
            for (const entry of pickDeleteOrder(selectedKeys)) {
                const tableName = getTableName(entry.table);
                try {
                    await db.run(sql.raw(`DELETE FROM ${tableName}`));
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logger.warn("import: DELETE failed", { table: entry.key, actorEmail, error: msg });
                    errors.push({ table: entry.key, error: `delete: ${msg}` });
                }
            }
        }

        // Insert in FK order
        for (const entry of pickInsertOrder(selectedKeys)) {
            const rows = body.tables[entry.key];
            const stat = { inserted: 0, failed: 0, skipped: 0 };
            summary[entry.key] = stat;

            if (!Array.isArray(rows) || rows.length === 0) continue;

            const pkCols = entry.pk.map(name => jsColumn(entry.table, name));

            for (const raw of rows) {
                // Skip rows missing a PK component — they can't conflict-resolve.
                const missingPk = entry.pk.find(name => raw[name] === undefined || raw[name] === null);
                if (missingPk) {
                    stat.skipped++;
                    continue;
                }

                const coerced = coerceRow(entry.table, raw);

                // Build the SET clause = every present column except the PK,
                // so the upsert overwrites everything else from the import.
                const setClause: Record<string, unknown> = { ...coerced };
                for (const pkName of entry.pk) delete setClause[pkName];

                try {
                    if (Object.keys(setClause).length === 0) {
                        // PK-only table (unlikely, but possible): nothing to update on conflict
                        await db.insert(entry.table).values(coerced).onConflictDoNothing();
                    } else {
                        await db.insert(entry.table).values(coerced).onConflictDoUpdate({
                            target: pkCols,
                            set: setClause,
                        });
                    }
                    stat.inserted++;
                } catch (e) {
                    stat.failed++;
                    const msg = e instanceof Error ? e.message : String(e);
                    // Log first 3 row-level errors per table; after that, keep counting silently.
                    if (stat.failed <= 3) {
                        logger.warn("import: row insert failed", {
                            table: entry.key,
                            actorEmail,
                            error: msg,
                        });
                    }
                }
            }

            if (stat.failed > 0) {
                errors.push({ table: entry.key, error: `${stat.failed} row(s) failed to insert` });
            }
        }

        return NextResponse.json({
            success: errors.length === 0,
            mode,
            summary,
            errors,
            importedAt: new Date().toISOString(),
            importedBy: actorEmail,
        });
    } catch (error: unknown) {
        const errorId = logger.error("Import failed", error, { actorEmail });
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: `Import failed: ${message}`, errorId, summary, errors }, { status: 500 });
    }
}
