export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/organizations/[id]
 * Returns the full member list + pending invites for one organization.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orgId } = await params;
    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const org = await env.DB.prepare(
            `SELECT id, name, created_by, created_at FROM organizations WHERE id = ?`
        ).bind(orgId).first();

        if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const members = await env.DB.prepare(
            `SELECT id, user_email, role, joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at ASC`
        ).bind(orgId).all();

        const invites = await env.DB.prepare(
            `SELECT id, created_by, expires_at, created_at FROM org_invites WHERE org_id = ? ORDER BY created_at DESC`
        ).bind(orgId).all();

        return NextResponse.json({
            organization: org,
            members: members.results || [],
            invites: invites.results || [],
        });
    } catch (error) {
        const errorId = logger.error('Get organization detail failed', error, { orgId, actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to fetch organization", errorId }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/organizations/[id]
 * Admin can rename the organization or transfer ownership (changes created_by).
 * Body: { name?: string, createdBy?: string }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orgId } = await params;
    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const body = await request.json() as { name?: string; createdBy?: string };
        if (!body.name && !body.createdBy) {
            return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
        }

        const sets: string[] = [];
        const binds: (string)[] = [];
        if (body.name) { sets.push('name = ?'); binds.push(body.name); }
        if (body.createdBy) { sets.push('created_by = ?'); binds.push(body.createdBy); }
        binds.push(orgId);

        await env.DB.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

        logger.info('Organization updated by admin', { orgId, fields: sets, actorEmail: session.user.email });
        return NextResponse.json({ success: true });
    } catch (error) {
        const errorId = logger.error('Update organization failed', error, { orgId, actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to update organization", errorId }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/organizations/[id]/members?email=...
 * Wait — that's the wrong path. Member removal is below as a DELETE on this route
 * with a `memberId` query param. Removes a single member from the org.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: orgId } = await params;
    let memberId: string | null = null;
    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const url = new URL(request.url);
        memberId = url.searchParams.get('memberId');
        if (!memberId) return NextResponse.json({ error: "Missing memberId" }, { status: 400 });

        await env.DB.prepare(`DELETE FROM org_members WHERE id = ? AND org_id = ?`).bind(memberId, orgId).run();

        logger.info('Org member removed by admin', { orgId, memberId, actorEmail: session.user.email });
        return NextResponse.json({ success: true });
    } catch (error) {
        const errorId = logger.error('Remove org member failed', error, { orgId, memberId, actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to remove member", errorId }, { status: 500 });
    }
}
