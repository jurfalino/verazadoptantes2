'use server';

import { getUser } from './_db';
import { logger } from '@/lib/logger';

export type ActivitySeverity = 'rose' | 'amber' | 'emerald' | 'stone';

export interface ActivityFieldSummary {
    /** First 1–2 changed field names (camelCase keys, rendered via i18n). */
    primary: string[];
    /** Number of additional changed fields beyond the primary list. */
    extraCount: number;
}

/**
 * v2.18.14 — enriched entry. The audit-log row is the source of truth;
 * everything else is resolved at fetch time so the renderer stays dumb.
 *
 *  - `actorName` / `actorOrgName` come from `user.name` + `pickAttributionOrg`.
 *  - `adopterName` / `adopterDeleted` come from a batched lookup against
 *    the `adopters` table on the row's `target` (which is the adopter id
 *    for every action in ACTIVITY_ACTIONS — `target` is the audit_log
 *    convention for "the thing this action affected").
 *  - `severity` is derived from `(action, details)` in `deriveSeverity` —
 *    rose for flag / delete / status-downgrade-to-1-2; amber for
 *    deletion-request / status-3; emerald for status-up / verification.
 *  - `fieldSummary` is parsed from `details.changes` (canonical v2.18.8
 *    `{ field: { from, to } }` shape). Drives the inline diff line for
 *    `adopter_updated`.
 *  - `extra` carries action-specific extras (animal name, flag reason)
 *    that the renderer needs without re-parsing details client-side.
 */
export interface OrgActivityEntry {
    id: string;
    userEmail: string;
    action: string;
    target: string | null;
    /** Raw details JSON string from the audit_log row. */
    details: string | null;
    createdAt: number;
    actorName: string;
    actorOrgName: string | null;
    adopterName: string | null;
    adopterDeleted: boolean;
    severity: ActivitySeverity;
    fieldSummary: ActivityFieldSummary | null;
    extra: {
        animalName?: string;
        species?: string;
        flagReason?: string;
    };
}

// Actions that are meaningful for org activity feed
const ACTIVITY_ACTIONS = [
    'adopter_created',
    'adopter_updated',
    'adoption_added',
    'adoption_updated',
    'image_uploaded',
    'flag_created',
    'adopter_deleted',
    'adopter_deletion_requested',
    'verification_added',
];

/** Field keys whose value is a 1–5 rating; status delta drives severity. */
const STATUS_FIELDS = new Set(['status', 'rating', 'avgRating']);

function parseDetails(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function deriveSeverity(action: string, details: Record<string, unknown>): ActivitySeverity {
    if (action === 'flag_created' || action === 'adopter_deleted') return 'rose';
    if (action === 'adopter_deletion_requested') return 'amber';
    if (action === 'verification_added') return 'emerald';

    if (action === 'adopter_updated') {
        // details payload may be the changes blob directly OR nested under
        // a `changes` key — handle both since logAudit shapes have drifted.
        const changes = (details.changes as Record<string, unknown>) ?? details;
        for (const field of STATUS_FIELDS) {
            const delta = changes?.[field] as { from?: unknown; to?: unknown } | undefined;
            if (delta && typeof delta === 'object' && 'to' in delta) {
                const to = Number(delta.to);
                if (!Number.isFinite(to)) continue;
                if (to <= 2) return 'rose';
                if (to === 3) return 'amber';
                if (to >= 4) return 'emerald';
            }
        }
    }
    return 'stone';
}

function deriveFieldSummary(action: string, details: Record<string, unknown>): ActivityFieldSummary | null {
    if (action !== 'adopter_updated') return null;
    const changes = (details.changes as Record<string, unknown>) ?? details;
    if (!changes || typeof changes !== 'object') return null;
    const keys = Object.keys(changes).filter(k => {
        // Filter to plain "{from, to}" shape; ignore array/string entries
        // that happen to land in the details blob for one-off audit rows.
        const v = (changes as Record<string, unknown>)[k];
        return v && typeof v === 'object' && ('from' in (v as object) || 'to' in (v as object));
    });
    if (keys.length === 0) return null;
    return {
        primary: keys.slice(0, 2),
        extraCount: Math.max(0, keys.length - 2),
    };
}

function deriveExtra(action: string, details: Record<string, unknown>): OrgActivityEntry['extra'] {
    const out: OrgActivityEntry['extra'] = {};
    if (action === 'adoption_added' || action === 'adoption_created') {
        if (typeof details.animalName === 'string') out.animalName = details.animalName;
        if (typeof details.species === 'string') out.species = details.species;
    }
    if (action === 'flag_created') {
        if (typeof details.reason === 'string') out.flagReason = details.reason;
    }
    return out;
}

/**
 * Get recent activity from org members by querying the audit_log table.
 * Filters by org member emails and relevant action types.
 *
 * Enriches each row with display name (resolveDisplayName), adopter name
 * (joined from adopters.id = audit_log.target), shared-org context, severity
 * tint, and a field-summary for adopter_updated. Three D1 batches per call —
 * actor names, adopter rows, viewer orgs — all loop-based to stay D1-safe.
 */
export async function getOrgActivity(limit: number = 30): Promise<OrgActivityEntry[]> {
    try {
        const viewer = await getUser();
        const { getOrgMemberEmails } = await import('@/app/actions/organizations');
        const emails = await getOrgMemberEmails();

        // If user has no org or is the only member, no team activity to show
        if (emails.length <= 1) return [];

        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (!env?.DB) return [];

        // Build parameterized query — D1 doesn't support array binding, so we build placeholders
        const placeholders = emails.map(() => '?').join(',');
        const actionPlaceholders = ACTIVITY_ACTIONS.map(() => '?').join(',');

        const result = await env.DB.prepare(
            `SELECT id, user_email, action, target, details, created_at
             FROM audit_log
             WHERE user_email IN (${placeholders})
             AND action IN (${actionPlaceholders})
             ORDER BY created_at DESC
             LIMIT ?`
        ).bind(...emails, ...ACTIVITY_ACTIONS, limit).all<{
            id: string;
            user_email: string;
            action: string;
            target: string | null;
            details: string | null;
            created_at: number;
        }>();

        const rows = result.results || [];
        if (rows.length === 0) return [];

        // ── Enrichment: three independent batches in parallel ──
        const distinctActors = Array.from(new Set(rows.map(r => r.user_email).filter(Boolean)));
        const distinctTargets = Array.from(new Set(rows.map(r => r.target).filter((t): t is string => !!t)));

        const [actorNames, adopterMap, attributionMap] = await Promise.all([
            resolveActorNames(distinctActors, env.DB),
            resolveAdopters(distinctTargets, env.DB),
            resolveAttribution(distinctActors, viewer),
        ]);

        return rows.map(row => {
            const details = parseDetails(row.details);
            const adopter = row.target ? adopterMap.get(row.target) : null;
            const orgInfo = attributionMap.get(row.user_email) ?? null;
            return {
                id: row.id,
                userEmail: row.user_email,
                action: row.action,
                target: row.target,
                details: row.details,
                createdAt: row.created_at,
                actorName: actorNames.get(row.user_email) || (row.user_email.split('@')[0] || row.user_email),
                actorOrgName: orgInfo?.name ?? null,
                adopterName: adopter?.name ?? null,
                adopterDeleted: !!adopter?.deletedAt,
                severity: deriveSeverity(row.action, details),
                fieldSummary: deriveFieldSummary(row.action, details),
                extra: deriveExtra(row.action, details),
            };
        });
    } catch (error) {
        logger.warn('getOrgActivity failed', { error: error instanceof Error ? error.message : String(error) });
        return [];
    }
}

// ── Enrichment helpers ───────────────────────────────────────────

interface D1Env { prepare(s: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } } }

async function resolveActorNames(emails: string[], db: D1Env): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (emails.length === 0) return out;
    // Loop, not inArray — same convention as orgMembership.ts and the
    // D1_COMPATIBILITY memo. ~15 actors × 1ms each is cheap.
    await Promise.all(emails.map(async email => {
        try {
            const row = await db.prepare(`SELECT name FROM user WHERE email = ? LIMIT 1`)
                .bind(email).first<{ name: string | null }>();
            if (row?.name) out.set(email, row.name);
        } catch {
            // Silent — caller falls back to email prefix.
        }
    }));
    return out;
}

interface AdopterMini { name: string | null; deletedAt: number | null }

async function resolveAdopters(ids: string[], db: D1Env): Promise<Map<string, AdopterMini>> {
    const out = new Map<string, AdopterMini>();
    if (ids.length === 0) return out;
    await Promise.all(ids.map(async id => {
        try {
            const row = await db.prepare(`SELECT name, deleted_at FROM adopters WHERE id = ? LIMIT 1`)
                .bind(id).first<{ name: string | null; deleted_at: number | null }>();
            if (row) out.set(id, { name: row.name, deletedAt: row.deleted_at });
        } catch {
            // Missing row → leave unset; renderer falls back to generic "perfil".
        }
    }));
    return out;
}

async function resolveAttribution(emails: string[], viewerEmail: string): Promise<Map<string, { name: string } | null>> {
    const out = new Map<string, { name: string } | null>();
    if (emails.length === 0) return out;
    try {
        const { pickAttributionOrg } = await import('@/lib/orgMembership');
        await Promise.all(emails.map(async email => {
            // Skip the viewer themselves — no point attributing them.
            if (email === viewerEmail) { out.set(email, null); return; }
            try {
                const org = await pickAttributionOrg(email, viewerEmail);
                out.set(email, org ? { name: org.name } : null);
            } catch {
                out.set(email, null);
            }
        }));
    } catch {
        // pickAttributionOrg unreachable — every actor goes unattributed.
        for (const e of emails) out.set(e, null);
    }
    return out;
}
