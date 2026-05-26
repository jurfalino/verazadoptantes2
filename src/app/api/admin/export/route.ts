export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { getDb } from "@/app/actions";
import { TABLE_REGISTRY, TABLE_BY_KEY, defaultSelection } from "@/lib/dataMigration";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

interface ExportPayload {
    tables?: string[];
}

async function runExport(selectedKeys: string[], actorEmail: string) {
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

    const selected = selectedKeys
        .map(k => TABLE_BY_KEY[k])
        .filter((e): e is NonNullable<typeof e> => !!e);

    if (selected.length === 0) {
        return NextResponse.json({ error: "No valid tables selected" }, { status: 400 });
    }

    // Parallel fetch; per-table fallback to [] on individual failure so a
    // single broken table doesn't abort the whole export. Always logged.
    const rowsPerTable = await Promise.all(
        selected.map(async (entry) => {
            try {
                const rows = await db.select().from(entry.table).all();
                return [entry.key, rows] as const;
            } catch (e) {
                logger.warn("export: table read fallback", {
                    table: entry.key,
                    actorEmail,
                    error: e instanceof Error ? e.message : String(e),
                });
                return [entry.key, []] as const;
            }
        })
    );

    const tables: Record<string, unknown[]> = {};
    for (const [key, rows] of rowsPerTable) tables[key] = rows;

    const exportData = {
        version: "2.0",
        exportedAt: new Date().toISOString(),
        exportedBy: actorEmail,
        tables,
    };

    const json = JSON.stringify(exportData, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    return new NextResponse(json, {
        headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="buenadoptante-export-${timestamp}.json"`,
        },
    });
}

// POST: caller chooses which tables. GET: backward compat — exports the
// full set (every table in the registry).
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: ExportPayload;
    try {
        body = await request.json() as ExportPayload;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const requested = Array.isArray(body.tables) && body.tables.length > 0
        ? body.tables
        : defaultSelection();

    return runExport(requested, session.user.email);
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return runExport(TABLE_REGISTRY.map(e => e.key), session.user.email);
}
