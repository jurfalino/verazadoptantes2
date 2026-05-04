export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/organizations
 * Lists every organization with its owner email, member count, pending invite count.
 * Sorted by member count desc.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const rows = await env.DB.prepare(`
            SELECT
                o.id, o.name, o.created_by, o.created_at,
                (SELECT COUNT(*) FROM org_members  m WHERE m.org_id = o.id) AS member_count,
                (SELECT COUNT(*) FROM org_invites  i WHERE i.org_id = o.id) AS invite_count
            FROM organizations o
            ORDER BY member_count DESC, o.created_at DESC
        `).all();

        return NextResponse.json({ organizations: rows.results || [] });
    } catch (error) {
        const errorId = logger.error('Get organizations failed', error, { actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to fetch organizations", errorId }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/organizations?id=...
 * Hard-deletes an organization and ALL of its membership + invite rows.
 * Adopter records owned by members are unaffected (org membership is metadata).
 */
export async function DELETE(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let orgId: string | null = null;
    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const url = new URL(request.url);
        orgId = url.searchParams.get('id');
        if (!orgId) return NextResponse.json({ error: "Missing org id" }, { status: 400 });

        await env.DB.prepare(`DELETE FROM org_invites WHERE org_id = ?`).bind(orgId).run();
        await env.DB.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(orgId).run();
        await env.DB.prepare(`DELETE FROM organizations WHERE id = ?`).bind(orgId).run();

        logger.info('Organization deleted by admin', { orgId, actorEmail: session.user.email });
        return NextResponse.json({ success: true });
    } catch (error) {
        const errorId = logger.error('Delete organization failed', error, { orgId, actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to delete organization", errorId }, { status: 500 });
    }
}
