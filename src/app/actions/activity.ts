'use server';

import { getUser } from './_db';
import { logger } from '@/lib/logger';
// v2.19.5: derivations moved to src/lib/auditRow.ts as the shared source of
// truth between this feed and /admin/audit. ActivitySeverity / FieldSummary
// kept as re-exports so existing consumers don't break.
import {
    parseDetails as parseDetailsShared,
    deriveSeverity as deriveSeverityShared,
    deriveFieldSummary as deriveFieldSummaryShared,
    type AuditSeverity,
    type AuditFieldSummary,
} from '@/lib/auditRow';
import { ADOPTION_DOCS_ACTIVITY_ACTIONS, isDocsActivityVisible } from '@/domain/adoptionDocsActivity';

export type ActivitySeverity = AuditSeverity;

export interface ActivityFieldSummary extends AuditFieldSummary {
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
        /** adoption_docs_* only — the org the edit is attributed to. */
        orgName?: string;
    };
}

// Actions that are meaningful for org activity feed. adoption_docs_form_saved
// / adoption_docs_contract_saved (Task 5) don't fit any existing category —
// they land in `all` only via ADOPTION_DOCS_ACTIVITY_ACTIONS below, and are
// further gated per-row by isDocsActivityVisible (org-scoped, never shown
// for a self edit — see that function's docstring).
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
    ...ADOPTION_DOCS_ACTIVITY_ACTIONS,
];

// getNewActivityCount's "N nuevas" banner has no per-row visibility check
// (it's a plain COUNT(*), no details to inspect) — so the adoption_docs_*
// actions are excluded from it entirely rather than risk a phantom count
// for a self edit or another org's edit that the main feed would then hide.
const COUNTABLE_ACTIVITY_ACTIONS = ACTIVITY_ACTIONS.filter(
    a => !(ADOPTION_DOCS_ACTIVITY_ACTIONS as readonly string[]).includes(a),
);

/**
 * v1.1 filter categories surfaced as chips above the feed. Each maps to a
 * subset of ACTIVITY_ACTIONS; 'all' means no action filter at all. Kept in
 * sync with the chip set in OrgActivityFeed.tsx.
 */
export type ActivityCategory = 'all' | 'profiles' | 'adoptions' | 'flags' | 'photos' | 'deletions';

const CATEGORY_ACTIONS: Record<ActivityCategory, string[]> = {
    all: ACTIVITY_ACTIONS,
    profiles: ['adopter_created', 'adopter_updated', 'verification_added'],
    adoptions: ['adoption_added', 'adoption_updated'],
    flags: ['flag_created'],
    photos: ['image_uploaded'],
    deletions: ['adopter_deleted', 'adopter_deletion_requested'],
};

export interface ActivityCursor {
    createdAt: number;
    id: string;
}

export interface ActivityFilters {
    category?: ActivityCategory;
    actorEmail?: string;
    cursor?: ActivityCursor | null;
    limit?: number;
}

export interface ActivityPage {
    entries: OrgActivityEntry[];
    nextCursor: ActivityCursor | null;
    /** Distinct actor emails in the unfiltered org population — drives the
     *  actor-picker dropdown. Returned only on the first page (no cursor). */
    actors: Array<{ email: string; name: string }> | null;
}

// parseDetails / deriveSeverity / deriveFieldSummary now live in
// src/lib/auditRow.ts (v2.19.5). Local wrappers preserve the existing call
// sites without forcing every consumer to chase the new import path.
const parseDetails = parseDetailsShared;
const deriveSeverity = deriveSeverityShared;
const deriveFieldSummary = (action: string, details: Record<string, unknown>): ActivityFieldSummary | null =>
    deriveFieldSummaryShared(action, details);

function deriveExtra(action: string, details: Record<string, unknown>, orgNames: Map<string, string>): OrgActivityEntry['extra'] {
    const out: OrgActivityEntry['extra'] = {};
    if (action === 'adoption_added' || action === 'adoption_created') {
        if (typeof details.animalName === 'string') out.animalName = details.animalName;
        if (typeof details.species === 'string') out.species = details.species;
    }
    if (action === 'flag_created') {
        if (typeof details.reason === 'string') out.flagReason = details.reason;
    }
    if ((ADOPTION_DOCS_ACTIVITY_ACTIONS as readonly string[]).includes(action) && typeof details.orgId === 'string') {
        const name = orgNames.get(details.orgId);
        if (name) out.orgName = name;
    }
    return out;
}

/**
 * Get recent activity from org members by querying the audit_log table.
 * Filters by org member emails and relevant action types.
 *
 * v1.1: accepts category + actor filters and a cursor for "Cargar más"
 * pagination. Cursor is `(createdAt, id)` so concurrent inserts don't drift
 * the page boundary. First page (no cursor) also returns the distinct actor
 * list for the picker dropdown.
 *
 * Enriches each row with display name (resolveDisplayName), adopter name
 * (joined from adopters.id = audit_log.target), shared-org context, severity
 * tint, and a field-summary for adopter_updated. Three D1 batches per call —
 * actor names, adopter rows, viewer orgs — all loop-based to stay D1-safe.
 */
export async function getOrgActivity(filters: ActivityFilters = {}): Promise<ActivityPage> {
    const empty: ActivityPage = { entries: [], nextCursor: null, actors: null };
    try {
        const viewer = await getUser();
        const { getOrgMemberEmails } = await import('@/app/actions/organizations');
        const emails = await getOrgMemberEmails();

        // If user has no org or is the only member, no team activity to show
        if (emails.length <= 1) return empty;

        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (!env?.DB) return empty;

        const limit = Math.max(1, Math.min(filters.limit ?? 30, 100));
        const category = filters.category ?? 'all';
        const allowedActions = CATEGORY_ACTIONS[category] ?? ACTIVITY_ACTIONS;

        // Build parameterized query — D1 doesn't support array binding, so
        // we build placeholders. Actor filter narrows `IN (emails)` to one
        // email if it's a member of the viewer's orgs (silently drops it
        // otherwise so a forged filter can't leak data).
        const actorFilter = filters.actorEmail && emails.includes(filters.actorEmail) ? filters.actorEmail : null;
        const emailList = actorFilter ? [actorFilter] : emails;

        const emailPh = emailList.map(() => '?').join(',');
        const actionPh = allowedActions.map(() => '?').join(',');

        // Fetch limit+1 to determine hasMore without a second query.
        const fetchLimit = limit + 1;
        const cursor = filters.cursor ?? null;

        // Cursor predicate: (created_at, id) is a composite key descending.
        // The "OR (created_at = ? AND id < ?)" branch handles ties on the
        // same second — without it, multiple rows inserted in the same
        // second would skip or repeat at the page boundary.
        const cursorSql = cursor
            ? 'AND (created_at < ? OR (created_at = ? AND id < ?)) '
            : '';
        const cursorBinds: unknown[] = cursor
            ? [cursor.createdAt, cursor.createdAt, cursor.id]
            : [];

        // A self docs-edit (adoption_docs_* with no orgId → target NULL) is
        // never visible to anyone — isDocsActivityVisible always drops it —
        // so it's excluded here at the SQL level rather than only in memory.
        // Without this, a user who saves their own form/contract repeatedly
        // could fill an entire page with rows nobody will ever see, making
        // the feed (and "Cargar más") look emptier than it is. An edit of an
        // org the viewer isn't in still has a non-NULL target and can only
        // be filtered in memory (needs the viewer's own org ids), same as
        // before — that risk remains and is documented in the report.
        const sql =
            `SELECT id, user_email, action, target, details, created_at
             FROM audit_log
             WHERE user_email IN (${emailPh})
             AND action IN (${actionPh})
             AND NOT (action IN (?, ?) AND target IS NULL)
             ${cursorSql}ORDER BY created_at DESC, id DESC
             LIMIT ?`;

        const result = await env.DB.prepare(sql)
            .bind(...emailList, ...allowedActions, ...ADOPTION_DOCS_ACTIVITY_ACTIONS, ...cursorBinds, fetchLimit)
            .all<{
                id: string;
                user_email: string;
                action: string;
                target: string | null;
                details: string | null;
                created_at: number;
            }>();

        const raw = result.results || [];
        const hasMore = raw.length > limit;
        // hasMore / nextCursor are derived from this UNFILTERED `rows` below —
        // the isDocsActivityVisible drop happens only when building `entries`,
        // so a page that's mostly hidden adoption_docs_* rows still cursors
        // forward correctly instead of stalling.
        const rows = hasMore ? raw.slice(0, limit) : raw;

        // Parsed once, reused for both the org-name batch below and the
        // per-row map (parsing details twice per row was wasteful and risked
        // the two parses drifting on a malformed JSON edge case).
        const detailsByRowId = new Map<string, Record<string, unknown>>(
            rows.map(r => [r.id, parseDetails(r.details)]),
        );

        // ── Enrichment: independent batches in parallel ──
        const distinctActors = Array.from(new Set(rows.map(r => r.user_email).filter(Boolean)));
        // adoption_docs_* rows point `target` at an org id, not an adopter —
        // excluded here so resolveAdopters never queries `adopters` with one.
        const distinctTargets = Array.from(new Set(
            rows
                .filter(r => !(ADOPTION_DOCS_ACTIVITY_ACTIONS as readonly string[]).includes(r.action))
                .map(r => r.target)
                .filter((t): t is string => !!t),
        ));
        // Only pages that actually contain adoption_docs_* rows pay for the
        // viewer-org and org-name lookups below.
        const docsRows = rows.filter(r => (ADOPTION_DOCS_ACTIVITY_ACTIONS as readonly string[]).includes(r.action));
        const hasDocsRows = docsRows.length > 0;
        const distinctDocsOrgIds = Array.from(new Set(
            docsRows
                .map(r => detailsByRowId.get(r.id)?.orgId)
                .filter((v): v is string => typeof v === 'string' && !!v),
        ));

        // On the first page, also resolve the full actor list across the org
        // (not just this page's actors) so the picker dropdown is complete.
        const wantActors = !cursor;
        const fullActorEmails = wantActors ? emails : [];

        const [actorNames, adopterMap, attributionMap, allActorNames, viewerOrgIds, docsOrgNames] = await Promise.all([
            resolveActorNames(distinctActors, env.DB),
            resolveAdopters(distinctTargets, env.DB),
            resolveAttribution(distinctActors, viewer),
            wantActors ? resolveActorNames(fullActorEmails, env.DB) : Promise.resolve(new Map<string, string>()),
            hasDocsRows ? getViewerOrgIds(viewer) : Promise.resolve([] as string[]),
            hasDocsRows ? resolveOrgNames(distinctDocsOrgIds, env.DB) : Promise.resolve(new Map<string, string>()),
        ]);

        const entries: OrgActivityEntry[] = rows
            .map(row => {
                const details = detailsByRowId.get(row.id) ?? {};
                if (!isDocsActivityVisible(row.action, details, viewerOrgIds)) return null;
                const adopter = row.target ? adopterMap.get(row.target) : null;
                const orgInfo = attributionMap.get(row.user_email) ?? null;
                const entry: OrgActivityEntry = {
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
                    extra: deriveExtra(row.action, details, docsOrgNames),
                };
                return entry;
            })
            .filter((e): e is OrgActivityEntry => e !== null);

        const last = rows[rows.length - 1];
        const nextCursor = hasMore && last ? { createdAt: last.created_at, id: last.id } : null;

        const actors = wantActors
            ? emails
                .filter(e => e !== viewer)
                .map(email => ({ email, name: allActorNames.get(email) || (email.split('@')[0] || email) }))
                .sort((a, b) => a.name.localeCompare(b.name))
            : null;

        return { entries, nextCursor, actors };
    } catch (error) {
        logger.warn('getOrgActivity failed', { error: error instanceof Error ? error.message : String(error) });
        return empty;
    }
}

/**
 * Lightweight count of activity rows newer than `sinceTimestamp`. Polled by
 * the client every 60s to drive the "N nuevas — actualizar" banner above
 * the feed. Same email + action filter as the main feed but no enrichment —
 * and no per-row `details.orgId` check is possible from a COUNT(*), so
 * adoption_docs_* rows are excluded via COUNTABLE_ACTIVITY_ACTIONS rather
 * than risk a phantom "N nuevas" for a row the refreshed feed then hides.
 */
export async function getNewActivityCount(sinceTimestamp: number): Promise<number> {
    if (!Number.isFinite(sinceTimestamp) || sinceTimestamp <= 0) return 0;
    try {
        const { getOrgMemberEmails } = await import('@/app/actions/organizations');
        const emails = await getOrgMemberEmails();
        if (emails.length <= 1) return 0;

        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (!env?.DB) return 0;

        const emailPh = emails.map(() => '?').join(',');
        const actionPh = COUNTABLE_ACTIVITY_ACTIONS.map(() => '?').join(',');
        const result = await env.DB.prepare(
            `SELECT COUNT(*) AS n
             FROM audit_log
             WHERE user_email IN (${emailPh})
             AND action IN (${actionPh})
             AND created_at > ?`
        ).bind(...emails, ...COUNTABLE_ACTIVITY_ACTIONS, sinceTimestamp).first<{ n: number }>();
        return result?.n ?? 0;
    } catch (error) {
        logger.warn('getNewActivityCount failed', { error: error instanceof Error ? error.message : String(error) });
        return 0;
    }
}

// ── Enrichment helpers ───────────────────────────────────────────

interface D1Env { prepare(s: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } } }

/**
 * The viewer's own org ids, used to gate adoption_docs_* rows (see
 * isDocsActivityVisible). Fails CLOSED to `[]` on a DB hiccup — unlike most
 * org-membership helpers in this codebase, which fail open, a lookup
 * failure here should hide these two rows, not risk showing an edit outside
 * the viewer's orgs.
 */
async function getViewerOrgIds(email: string): Promise<string[]> {
    try {
        const { getDb } = await import('@/lib/db');
        const { getMemberOrgIds } = await import('@/lib/adoptionDocsRepo');
        const db = await getDb();
        if (!db) return [];
        return await getMemberOrgIds(db, email);
    } catch (e) {
        logger.warn('getOrgActivity: viewer org lookup failed — hiding adoption_docs_* rows', {
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    }
}

/** organizations.name for the distinct org ids referenced by adoption_docs_* rows on this page. */
async function resolveOrgNames(orgIds: string[], db: D1Env): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (orgIds.length === 0) return out;
    await Promise.all(orgIds.map(async id => {
        try {
            const row = await db.prepare(`SELECT name FROM organizations WHERE id = ? LIMIT 1`)
                .bind(id).first<{ name: string | null }>();
            if (row?.name) out.set(id, row.name);
        } catch (e) {
            logger.warn('getOrgActivity: org name lookup failed', {
                orgId: id, error: e instanceof Error ? e.message : String(e),
            });
        }
    }));
    return out;
}

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
