export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdmin } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        // Derive users from audit_log (guaranteed to exist) and join with user_profiles
        // The NextAuth 'user' table does not exist in production D1 (Cloudflare uses KV)
        const users = await env.DB.prepare(`
            SELECT 
                a.user_id as id, 
                a.user_email as email,
                a.user_email as name,
                NULL as image,
                p.organization, p.role, p.notes, p.comms_opt_in,
                p.last_active_at, p.created_at as first_sign_in
            FROM (
                SELECT user_id, user_email, MAX(created_at) as last_seen
                FROM audit_log 
                WHERE user_id IS NOT NULL
                GROUP BY user_id
            ) a
            LEFT JOIN user_profiles p ON a.user_id = p.user_id
            ORDER BY COALESCE(p.last_active_at, a.last_seen, 0) DESC
        `).all();

        return NextResponse.json({ users: users.results || [] });
    } catch (error) {
        console.error("Get users error:", error);
        return NextResponse.json({ error: "Failed to fetch users", detail: String(error) }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const body = await request.json() as {
            userId: string;
            organization?: string;
            role?: string;
            notes?: string;
            commsOptIn?: boolean;
        };

        // Ensure profile exists
        await env.DB.prepare(
            `INSERT OR IGNORE INTO user_profiles (user_id, created_at) VALUES (?, strftime('%s','now'))`
        ).bind(body.userId).run();

        // Update fields
        await env.DB.prepare(`
            UPDATE user_profiles 
            SET organization = ?, role = ?, notes = ?, comms_opt_in = ?
            WHERE user_id = ?
        `).bind(
            body.organization || null,
            body.role || 'viewer',
            body.notes || null,
            body.commsOptIn ? 1 : 0,
            body.userId
        ).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Update user profile error:", error);
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }
}
