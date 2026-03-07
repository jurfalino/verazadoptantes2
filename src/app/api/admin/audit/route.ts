export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const action = url.searchParams.get('action') || '';
        const userId = url.searchParams.get('userId') || '';
        const limit = 50;
        const offset = (page - 1) * limit;

        // Build WHERE clause
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (action) {
            conditions.push('action = ?');
            params.push(action);
        }
        if (userId) {
            conditions.push('(user_id = ? OR user_email = ?)');
            params.push(userId, userId);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get total count
        const countResult = await env.DB.prepare(
            `SELECT COUNT(*) as total FROM audit_log ${where}`
        ).bind(...params).first<{ total: number }>();

        // Get paginated results
        const results = await env.DB.prepare(
            `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(...params, limit, offset).all();

        // Get distinct action types for filter dropdown
        const actions = await env.DB.prepare(
            `SELECT DISTINCT action FROM audit_log ORDER BY action`
        ).all();

        // Get data size info
        const sizeResult = await env.DB.prepare(
            `SELECT COUNT(*) as totalRecords, 
                    MIN(created_at) as oldest,
                    MAX(created_at) as newest
             FROM audit_log`
        ).first<{ totalRecords: number; oldest: number; newest: number }>();

        return NextResponse.json({
            entries: results.results || [],
            total: countResult?.total || 0,
            page,
            totalPages: Math.ceil((countResult?.total || 0) / limit),
            actions: (actions.results || []).map((a: any) => a.action),
            stats: sizeResult
        });
    } catch (error) {
        const errorId = logger.error('Get audit log failed', error);
        return NextResponse.json({ error: "Failed to fetch audit log", errorId }, { status: 500 });
    }
}

// DELETE — purge old records based on retention
export async function DELETE(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });

        const body = await request.json() as { retentionDays: number };
        const retentionDays = body.retentionDays || 1095; // Default 3 years

        const result = await env.DB.prepare(
            `DELETE FROM audit_log WHERE created_at < strftime('%s','now') - ?`
        ).bind(retentionDays * 86400).run();

        return NextResponse.json({
            success: true,
            purged: result.meta?.changes || 0
        });
    } catch (error) {
        const errorId = logger.error('Purge audit log failed', error);
        return NextResponse.json({ error: "Failed to purge audit log", errorId }, { status: 500 });
    }
}
