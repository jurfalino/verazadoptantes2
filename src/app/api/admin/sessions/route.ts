export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdmin } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logAudit } from "@/lib/audit";

// GET: Read current session version
export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const row = await env.DB.prepare(
            `SELECT value, updated_at, updated_by FROM app_config WHERE key = 'session_version'`
        ).first<{ value: string; updated_at: number | null; updated_by: string | null }>();

        return NextResponse.json({
            version: row ? parseInt(row.value, 10) : 1,
            updatedAt: row?.updated_at || null,
            updatedBy: row?.updated_by || null,
        });
    } catch (error) {
        console.error("Get session version error:", error);
        return NextResponse.json({ error: "Failed to read session version" }, { status: 500 });
    }
}

// POST: Bump session version (invalidate all sessions)
export async function POST() {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        // Read current version
        const row = await env.DB.prepare(
            `SELECT value FROM app_config WHERE key = 'session_version'`
        ).first<{ value: string }>();

        const currentVersion = row ? parseInt(row.value, 10) : 1;
        const newVersion = currentVersion + 1;

        // Upsert the new version
        await env.DB.prepare(
            `INSERT INTO app_config (key, value, updated_at, updated_by) 
             VALUES ('session_version', ?, strftime('%s','now'), ?)
             ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime('%s','now'), updated_by = ?`
        ).bind(
            String(newVersion),
            session.user.email,
            String(newVersion),
            session.user.email
        ).run();

        // Audit log
        logAudit({
            userEmail: session.user.email,
            action: 'session_invalidation',
            details: { previousVersion: currentVersion, newVersion },
        });

        return NextResponse.json({
            success: true,
            previousVersion: currentVersion,
            newVersion,
        });
    } catch (error) {
        console.error("Bump session version error:", error);
        return NextResponse.json({ error: "Failed to bump session version" }, { status: 500 });
    }
}
