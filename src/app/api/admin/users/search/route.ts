export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/users/search?q=<prefix>
 *
 * Admin-only autosuggest for the "transfer adopter ownership" modal. Returns
 * up to 20 users matching the substring against email or display name.
 * Bound through D1 parameterized queries; the `q` string is NOT interpolated.
 *
 * Empty `q` returns the 20 most-recently-active users so the modal isn't
 * blank on open.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawQ = (request.nextUrl.searchParams.get('q') ?? '').trim();
    const q = rawQ.slice(0, 100);

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        let rows: { email: string; name: string | null }[];
        if (!q) {
            const result = await env.DB.prepare(
                `SELECT email, name FROM user
                 WHERE email IS NOT NULL AND email != ''
                 ORDER BY rowid DESC
                 LIMIT 20`
            ).all<{ email: string; name: string | null }>();
            rows = result.results ?? [];
        } else {
            const like = `%${q.toLowerCase()}%`;
            const result = await env.DB.prepare(
                `SELECT email, name FROM user
                 WHERE email IS NOT NULL AND email != ''
                   AND (LOWER(email) LIKE ? OR LOWER(COALESCE(name, '')) LIKE ?)
                 ORDER BY rowid DESC
                 LIMIT 20`
            ).bind(like, like).all<{ email: string; name: string | null }>();
            rows = result.results ?? [];
        }

        return NextResponse.json({ users: rows });
    } catch (e) {
        logger.warn('admin users search failed', {
            actor: session.user.email,
            q,
            error: e instanceof Error ? e.message : String(e),
        });
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
