export const runtime = 'edge';
import { auth } from "@/auth";
import { isAdminAsync } from "@/config/admins";
import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { logger } from '@/lib/logger';
import {
    parseDetails,
    deriveSeverity,
    deriveSummary,
    targetIsAdopter,
    type AuditSeverity,
    type AuditSummary,
    CATEGORY_ACTIONS,
    type AuditCategory,
} from '@/lib/auditRow';

/**
 * v2.19.5: every row is enriched server-side with actor name (joined from
 * `user.name`), adopter name when target points at an adopter (joined from
 * `adopters.name + deleted_at`), severity tint, and a pre-derived
 * AuditSummary that the client renders as a sentence. The page was
 * previously raw SELECT * with rich `details` JSON dumped behind an expand
 * button — admins couldn't see what people searched or which records they
 * opened without one click per row. Now they can scan a page.
 *
 * Filters added: category (action set), from/to (epoch range). `profile_viewed`
 * is hidden from the default feed unless the admin opts in via the Vistas
 * chip or the action dropdown — high volume otherwise.
 */

interface RawAuditRow {
    id: string;
    user_id: string | null;
    user_email: string | null;
    action: string;
    target: string | null;
    details: string | null;
    device: string | null;
    is_pwa: number;
    ip_address: string | null;
    created_at: number;
}

interface EnrichedAuditEntry extends RawAuditRow {
    actorName: string;
    targetAdopterName: string | null;
    targetAdopterDeleted: boolean;
    severity: AuditSeverity;
    summaryEs: AuditSummary;
    summaryEn: AuditSummary;
}

interface D1Like {
    prepare(sql: string): {
        bind(...args: unknown[]): {
            first<T>(): Promise<T | null>;
            all<T>(): Promise<{ results: T[] }>;
        };
    };
}

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) return NextResponse.json({ error: "No database" }, { status: 500 });
        const db = env.DB as unknown as D1Like;

        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const action = url.searchParams.get('action') || '';
        const userId = url.searchParams.get('userId') || '';
        const category = (url.searchParams.get('category') || 'all') as AuditCategory;
        const fromParam = parseInt(url.searchParams.get('from') || '0');
        const toParam = parseInt(url.searchParams.get('to') || '0');
        const limit = PAGE_SIZE;
        const offset = (page - 1) * limit;

        // Build WHERE clause. Action filter wins over category if both set —
        // admin made an explicit action choice from the dropdown.
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (action) {
            conditions.push('action = ?');
            params.push(action);
        } else if (category && category !== 'all') {
            const actionSet = CATEGORY_ACTIONS[category];
            if (actionSet && actionSet.length > 0) {
                const placeholders = actionSet.map(() => '?').join(',');
                conditions.push(`action IN (${placeholders})`);
                params.push(...actionSet);
            }
        } else {
            // 'all' category: hide the high-volume profile_viewed rows by
            // default. Admin opts in via the dropdown or the Vistas chip.
            conditions.push(`action != 'profile_viewed'`);
        }

        if (userId) {
            conditions.push('(user_id = ? OR user_email = ?)');
            params.push(userId, userId);
        }

        if (Number.isFinite(fromParam) && fromParam > 0) {
            conditions.push('created_at >= ?');
            params.push(fromParam);
        }
        if (Number.isFinite(toParam) && toParam > 0) {
            conditions.push('created_at <= ?');
            params.push(toParam);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Total count under the same filter
        const countResult = await db.prepare(
            `SELECT COUNT(*) as total FROM audit_log ${where}`
        ).bind(...params).first<{ total: number }>();

        // Paginated results
        const result = await db.prepare(
            `SELECT id, user_id, user_email, action, target, details, device, is_pwa, ip_address, created_at
             FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(...params, limit, offset).all<RawAuditRow>();

        const rows: RawAuditRow[] = result.results || [];

        // ── Enrichment: three parallel batches (D1-safe per-id loops) ──
        const distinctActors = Array.from(new Set(rows.map(r => r.user_email).filter((e): e is string => !!e)));
        const distinctAdopterTargets = Array.from(new Set(
            rows
                .filter(r => targetIsAdopter(r.action) && r.target && UUID_RE.test(r.target))
                .map(r => r.target as string)
        ));

        const [actorNames, adopterMap] = await Promise.all([
            resolveActorNames(distinctActors, db),
            resolveAdopters(distinctAdopterTargets, db),
        ]);

        const entries: EnrichedAuditEntry[] = rows.map(r => {
            const details = parseDetails(r.details);
            const adopter = r.target ? adopterMap.get(r.target) : null;
            const actorName = (r.user_email && actorNames.get(r.user_email))
                || (r.user_email ? r.user_email.split('@')[0] : (r.user_id || 'anónimo'));
            return {
                ...r,
                actorName,
                targetAdopterName: adopter?.name ?? null,
                targetAdopterDeleted: !!adopter?.deletedAt,
                severity: deriveSeverity(r.action, details),
                summaryEs: deriveSummary(r.action, details, r.target, true),
                summaryEn: deriveSummary(r.action, details, r.target, false),
            };
        });

        // Distinct action types for filter dropdown (over the unfiltered log).
        const actions = await db.prepare(
            `SELECT DISTINCT action FROM audit_log ORDER BY action`
        ).bind().all<{ action: string }>();

        // Data size info for the retention panel header.
        const sizeResult = await db.prepare(
            `SELECT COUNT(*) as totalRecords,
                    MIN(created_at) as oldest,
                    MAX(created_at) as newest
             FROM audit_log`
        ).bind().first<{ totalRecords: number; oldest: number; newest: number }>();

        return NextResponse.json({
            entries,
            total: countResult?.total || 0,
            page,
            totalPages: Math.ceil((countResult?.total || 0) / limit),
            actions: (actions.results || []).map(a => a.action),
            stats: sizeResult,
        });
    } catch (error) {
        const errorId = logger.error('Get audit log failed', error, { actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to fetch audit log", errorId }, { status: 500 });
    }
}

async function resolveActorNames(emails: string[], db: D1Like): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (emails.length === 0) return out;
    await Promise.all(emails.map(async email => {
        try {
            const row = await db.prepare(`SELECT name FROM user WHERE email = ? LIMIT 1`)
                .bind(email).first<{ name: string | null }>();
            if (row?.name) out.set(email, row.name);
        } catch { /* fall through to email-prefix fallback at the caller */ }
    }));
    return out;
}

interface AdopterMini { name: string | null; deletedAt: number | null }

async function resolveAdopters(ids: string[], db: D1Like): Promise<Map<string, AdopterMini>> {
    const out = new Map<string, AdopterMini>();
    if (ids.length === 0) return out;
    await Promise.all(ids.map(async id => {
        try {
            const row = await db.prepare(`SELECT name, deleted_at FROM adopters WHERE id = ? LIMIT 1`)
                .bind(id).first<{ name: string | null; deleted_at: number | null }>();
            if (row) out.set(id, { name: row.name, deletedAt: row.deleted_at });
        } catch { /* missing row → caller renders the raw target */ }
    }));
    return out;
}

// DELETE — purge old records based on retention. Unchanged from v2.19.4.
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
        const errorId = logger.error('Purge audit log failed', error, { actorEmail: session.user.email });
        return NextResponse.json({ error: "Failed to purge audit log", errorId }, { status: 500 });
    }
}
