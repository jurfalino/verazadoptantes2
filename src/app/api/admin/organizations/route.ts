export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/requestContext";
import { logger } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { keepDocsSourceBeforeChange, keepDocsSourceAfterChange, type ChangeContext, type DocsBefore } from '@/lib/docsSourceKeep';

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

        // «Al cambiar de grupos»: every member is removed and none is here to be
        // asked, so each one's shared links keep what they used — one per member
        // (no array binds on D1), each logged and never failing the delete.
        const keeps = await membersToKeep(env.DB, orgId, session.user.email);

        await env.DB.prepare(`DELETE FROM org_invites WHERE org_id = ?`).bind(orgId).run();
        await env.DB.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(orgId).run();
        await env.DB.prepare(`DELETE FROM organizations WHERE id = ?`).bind(orgId).run();

        if (keeps) await Promise.all(keeps.list.map(({ keep, before }) => keepDocsSourceAfterChange(keeps.db, before, keep)));

        logger.info('Organization deleted by admin', { orgId, actorEmail: session.user.email });
        return NextResponse.json({ success: true });
    } catch (error) {
        const errorId = logger.error('Delete organization failed', error, { orgId, actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to delete organization", errorId }, { status: 500 });
    }
}

/**
 * Before an admin group delete: each member's «Al compartir, usar:» kept
 * across losing the group (src/lib/docsSourceKeep.ts), and what the after-step
 * needs. A failed member read is logged and the delete goes on without it.
 */
async function membersToKeep(
    d1: { prepare: (sql: string) => { bind: (...v: unknown[]) => { all: <T>() => Promise<{ results?: T[] }> } } },
    orgId: string, actorEmail: string,
): Promise<{ db: NonNullable<Awaited<ReturnType<typeof getDb>>>; list: Array<{ keep: ChangeContext; before: DocsBefore | null }> } | null> {
    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const rows = await d1.prepare(`SELECT id, user_email FROM org_members WHERE org_id = ?`).bind(orgId).all<{ id: string; user_email: string }>();
        const list = await Promise.all((rows.results ?? []).map(async (m) => {
            const keep: ChangeContext = {
                email: m.user_email, orgId, change: 'removal', op: 'adminDeleteOrganization',
                ctx: { memberId: m.id, actorEmail }, actorEmail,
            };
            return { keep, before: await keepDocsSourceBeforeChange(db, keep) };
        }));
        return { db, list };
    } catch (e) {
        logger.warn('adminDeleteOrganization: members\' docs sources not kept, deleting anyway', {
            orgId, actorEmail, error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}
