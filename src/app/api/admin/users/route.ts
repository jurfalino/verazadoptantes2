export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export async function GET(_request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        // Get all users joined with their profiles
        const users = await env.DB.prepare(`
            SELECT 
                u.id, u.name, u.email, u.image,
                p.organization, p.role, p.notes, p.comms_opt_in,
                p.last_active_at, p.created_at as first_sign_in,
                p.country
            FROM user u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            ORDER BY COALESCE(p.last_active_at, 0) DESC
        `).all();

        return NextResponse.json({ users: users.results || [] });
    } catch (error) {
        console.error("Get users error:", error);
        return NextResponse.json({ error: "Failed to fetch users", detail: String(error) }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
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

export async function DELETE(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const body = await request.json() as { userId: string };
        if (!body.userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        // Safety: prevent self-deletion
        const targetUser = await env.DB.prepare(
            `SELECT email FROM user WHERE id = ?`
        ).bind(body.userId).first<{ email: string }>();

        if (targetUser?.email === session.user.email) {
            return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
        }

        // Delete user profile first (FK dependency), then user record
        await env.DB.prepare(`DELETE FROM user_profiles WHERE user_id = ?`).bind(body.userId).run();
        await env.DB.prepare(`DELETE FROM account WHERE "userId" = ?`).bind(body.userId).run();
        await env.DB.prepare(`DELETE FROM session WHERE "userId" = ?`).bind(body.userId).run();
        await env.DB.prepare(`DELETE FROM user WHERE id = ?`).bind(body.userId).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json({ error: "Failed to delete user", detail: String(error) }, { status: 500 });
    }
}
