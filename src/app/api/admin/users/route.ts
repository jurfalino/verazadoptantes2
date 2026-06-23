export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';
import { USER_ROLES } from '@/domain/constants';

export async function GET(_request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        // Get all users joined with their profiles + real org memberships.
        // The legacy user_profiles.organization free-text column was deprecated
        // in v2.12.1-34 (migration 0037). org membership now comes from the
        // org_members → organizations join.
        // Per-user activity counts use correlated subqueries — fine at current
        // user-table size (low hundreds). If the user table grows past a few
        // thousand rows, switch to LEFT JOIN + GROUP BY or precompute the counts.
        const users = await env.DB.prepare(`
            SELECT
                u.id, u.name, u.email, u.image, u.google_name AS google_name,
                p.role, p.notes, p.comms_opt_in,
                p.last_active_at, p.created_at as first_sign_in,
                p.country, p.province, p.city, p.timezone,
                p.terms_accepted_at, p.terms_version,
                (SELECT COUNT(*) FROM adopters WHERE added_by = u.email AND deleted_at IS NULL) AS adopters_count,
                (SELECT COUNT(*) FROM adoptions WHERE added_by = u.email) AS records_count,
                (SELECT COUNT(*) FROM adopter_history WHERE changed_by = u.email) AS edits_count,
                (SELECT COUNT(*) FROM adopter_flags WHERE flagged_by = u.email) AS flags_count,
                (
                    SELECT json_group_array(json_object('id', o.id, 'name', o.name, 'role', om.role))
                    FROM org_members om
                    JOIN organizations o ON o.id = om.org_id
                    WHERE om.user_email = u.email
                ) AS org_memberships_json
            FROM user u
            LEFT JOIN user_profiles p ON u.id = p.user_id
            ORDER BY COALESCE(p.last_active_at, 0) DESC
        `).all();

        // Parse the JSON aggregate into an array per user.
        const rows = (users.results || []) as Array<Record<string, unknown>>;
        const out = rows.map((r) => {
            let orgMemberships: Array<{ id: string; name: string; role: string | null }> = [];
            try {
                const raw = r.org_memberships_json;
                if (typeof raw === 'string' && raw !== '[]') {
                    orgMemberships = JSON.parse(raw);
                }
            } catch (e) {
                logger.warn('Admin users: org_memberships JSON parse failed', {
                    userId: r.id,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            const { org_memberships_json: _, ...rest } = r;
            return { ...rest, orgMemberships };
        });

        return NextResponse.json({ users: out });
    } catch (error) {
        const errorId = logger.error('Get users failed', error);
        return NextResponse.json({ error: "Failed to fetch users", errorId }, { status: 500 });
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
            // organization?: string  — DEPRECATED in v2.12.1-34. Real org membership is
            // managed via the /admin/organizations page (org_members table).
            role?: string;
            notes?: string;
            commsOptIn?: boolean;
        };

        // Validate role against the allow-list — the column previously accepted
        // ANY string (body.role || 'viewer'), so a malformed/forged body could
        // write an arbitrary role that the UI then mis-renders.
        const role = body.role || 'viewer';
        if (!USER_ROLES.includes(role as typeof USER_ROLES[number])) {
            return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
        }

        // Ensure profile exists
        await env.DB.prepare(
            `INSERT OR IGNORE INTO user_profiles (user_id, created_at) VALUES (?, strftime('%s','now'))`
        ).bind(body.userId).run();

        // Update fields
        await env.DB.prepare(`
            UPDATE user_profiles
            SET role = ?, notes = ?, comms_opt_in = ?
            WHERE user_id = ?
        `).bind(
            role,
            body.notes || null,
            body.commsOptIn ? 1 : 0,
            body.userId
        ).run();

        return NextResponse.json({ success: true });
    } catch (error) {
        const errorId = logger.error('Update user profile failed', error);
        return NextResponse.json({ error: "Failed to update profile", errorId }, { status: 500 });
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
        const errorId = logger.error('Delete user failed', error);
        return NextResponse.json({ error: "Failed to delete user", errorId }, { status: 500 });
    }
}
