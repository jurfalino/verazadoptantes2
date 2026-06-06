/**
 * PII access gating — server-side visibility orchestration.
 *
 * Loads the DB facts (admin role, editor set, grants) the pure resolver in
 * piiAccess.ts needs. A plain server module (not `'use server'`) imported by
 * the enforcement points: getAdopter, getHistory, findAdopters, /api/adopters.
 */

import { adopterHistory, adopters as adoptersTable, piiAccessGrants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { isAdminAsync, isModeratorOrAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { deserializeContactEntries } from '@/lib/contactEntries';
import {
    resolveVisibility,
    isRealActorEmail,
    NO_ACCESS_VISIBILITY,
    matchSearchEntries,
    matchSearchNameTokens,
    hashNameToken,
    type Visibility,
    type PiiGrantRow,
    type MaskContactOptions,
} from '@/lib/piiAccess';

interface AdopterRef {
    id: string;
    addedBy: string | null;
}

/** A viewer is "real" when their email is a genuine user (see isRealActorEmail). */
const isRealViewer = isRealActorEmail;

/** Whether the PII access-gating feature flag is on. */
export function isPiiGatingEnabled(): Promise<boolean> {
    return getFeatureFlag('ENABLE_PII_ACCESS_GATING');
}

/** Whether the public-profiles feature flag is on (v2.16.0-12+). */
export function isPublicProfilesEnabled(): Promise<boolean> {
    return getFeatureFlag('ENABLE_PUBLIC_PROFILES');
}

/**
 * Build the `MaskContactOptions` for a single adopter once per request.
 * Callers that already have the flag value should use `maskOptionsFor`
 * below to avoid re-fetching.
 */
export async function buildMaskOptions(
    adopter: { isPublic?: number | boolean | null } | null | undefined,
): Promise<MaskContactOptions> {
    const flag = await isPublicProfilesEnabled();
    return { adopterIsPublic: !!flag && !!adopter?.isPublic };
}

/**
 * Cheap per-adopter derivation when the flag has already been fetched
 * (e.g. inside a list-rendering path that resolves many adopters at once).
 * Returns the same shape `buildMaskOptions` does.
 */
export function maskOptionsFor(
    publicProfilesFlag: boolean,
    adopter: { isPublic?: number | boolean | null } | null | undefined,
): MaskContactOptions {
    return { adopterIsPublic: !!publicProfilesFlag && !!adopter?.isPublic };
}

/** Resolve visibility for a single (viewer, adopter) pair. Fails closed on error. */
export async function resolveAdopterVisibility(
    viewerEmail: string | null | undefined,
    adopter: AdopterRef,
): Promise<Visibility> {
    if (!isRealViewer(viewerEmail)) return NO_ACCESS_VISIBILITY;
    try {
        const db = await getDb();
        if (!db) return NO_ACCESS_VISIBILITY;
        const [isAdmin, isModeratorOrAdmin, editorRows, grantRows] = await Promise.all([
            isAdminAsync(viewerEmail),
            // v2.18.10: moderators get full privileged PII visibility too.
            // The helper returns true for admins as well — we derive isModerator
            // from (isModeratorOrAdmin && !isAdmin) below, but functionally
            // either flag is sufficient for the resolver's privileged check.
            isModeratorOrAdminAsync(viewerEmail),
            // Editor status: only kind='edit' rows count. kind='contribution'
            // rows (additive writes via addContactEntry) must NOT promote the
            // writer to editor — that would silently grant full PII visibility.
            db.select({ id: adopterHistory.adopterId }).from(adopterHistory)
                .where(and(
                    eq(adopterHistory.adopterId, adopter.id),
                    eq(adopterHistory.changedBy, viewerEmail),
                    eq(adopterHistory.kind, 'edit'),
                ))
                .limit(1),
            db.select({
                scope: piiAccessGrants.scope,
                entryRef: piiAccessGrants.entryRef,
                revokedAt: piiAccessGrants.revokedAt,
            }).from(piiAccessGrants)
                .where(and(eq(piiAccessGrants.adopterId, adopter.id), eq(piiAccessGrants.granteeEmail, viewerEmail))),
        ]);
        return resolveVisibility({
            viewerEmail,
            ownerEmail: adopter.addedBy,
            isAdmin,
            isModerator: isModeratorOrAdmin && !isAdmin,
            isEditor: editorRows.length > 0,
            grants: grantRows,
        });
    } catch (e) {
        // Fail closed — a resolution error masks everything rather than leaking PII.
        logger.warn('resolveAdopterVisibility failed — failing closed (masked)', {
            adopterId: adopter.id, viewer: viewerEmail,
            error: e instanceof Error ? e.message : String(e),
        });
        return NO_ACCESS_VISIBILITY;
    }
}

/**
 * Batch-resolve visibility for many adopters in one viewer's context — used by
 * findAdopters discovery. One DISTINCT query for the editor set + one query for
 * the viewer's grants, instead of N round-trips. Fails closed on error.
 */
export async function resolveAdoptersVisibility(
    viewerEmail: string | null | undefined,
    adopters: AdopterRef[],
): Promise<Map<string, Visibility>> {
    const out = new Map<string, Visibility>();
    if (adopters.length === 0) return out;
    if (!isRealViewer(viewerEmail)) {
        for (const a of adopters) out.set(a.id, NO_ACCESS_VISIBILITY);
        return out;
    }
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const [isAdmin, isModeratorOrAdmin, editorRows, grantRows] = await Promise.all([
            isAdminAsync(viewerEmail),
            isModeratorOrAdminAsync(viewerEmail),
            // Same kind='edit' filter as the per-adopter resolver above.
            db.selectDistinct({ id: adopterHistory.adopterId }).from(adopterHistory)
                .where(and(
                    eq(adopterHistory.changedBy, viewerEmail),
                    eq(adopterHistory.kind, 'edit'),
                )),
            db.select({
                adopterId: piiAccessGrants.adopterId,
                scope: piiAccessGrants.scope,
                entryRef: piiAccessGrants.entryRef,
                revokedAt: piiAccessGrants.revokedAt,
            }).from(piiAccessGrants).where(eq(piiAccessGrants.granteeEmail, viewerEmail)),
        ]);
        const editorSet = new Set<string>(editorRows.map((r: { id: string }) => r.id));
        const grantsByAdopter = new Map<string, PiiGrantRow[]>();
        for (const g of grantRows) {
            const list = grantsByAdopter.get(g.adopterId);
            if (list) list.push(g);
            else grantsByAdopter.set(g.adopterId, [g]);
        }
        for (const a of adopters) {
            out.set(a.id, resolveVisibility({
                viewerEmail,
                ownerEmail: a.addedBy,
                isAdmin,
                isModerator: isModeratorOrAdmin && !isAdmin,
                isEditor: editorSet.has(a.id),
                grants: grantsByAdopter.get(a.id) ?? [],
            }));
        }
        return out;
    } catch (e) {
        logger.warn('resolveAdoptersVisibility failed — failing closed (masked)', {
            count: adopters.length, viewer: viewerEmail,
            error: e instanceof Error ? e.message : String(e),
        });
        for (const a of adopters) out.set(a.id, NO_ACCESS_VISIBILITY);
        return out;
    }
}

/** Cap on the inbound `?q=` to keep one path from logging unbounded user input. */
const REPLAY_QUERY_MAX_LEN = 500;

/**
 * Replay a search-match against an adopter after the auth boundary. The
 * profile page calls this when it lands with `?q=...` after a post-signin
 * redirect — the original unauthenticated search couldn't write grants
 * (no email to attribute them to), so without replay the user would land
 * on a fully-masked profile despite having just seen the matched fields
 * unmasked in the search result.
 *
 * Runs the same matchers `findAdopters` uses in discovery mode and writes
 * any new grants for the now-authenticated viewer. Idempotent — existing
 * grants for the same (viewer, adopter, scope, entryRef) are skipped via
 * a pre-fetched hash set, so a re-visit (or a URL share) doesn't pile up
 * duplicate rows.
 *
 * Quiet failure: any write hiccup is logged but never thrown — the page
 * render must not be blocked by a grant-write blip. The viewer can
 * always retry via the on-profile verify-known-info input.
 */
export async function replaySearchMatchGrants(opts: {
    adopterId: string;
    query: string | null | undefined;
    viewerEmail: string | null | undefined;
    /**
     * Where the grant request came from. Default 'signin_replay' (post-auth
     * page-load replay of a search done before signin). 'duplicate_hint' is
     * used when a user clicks "view match" in DuplicateHint after typing an
     * identifier that matched another adopter. Affects only the audit/log
     * metadata; the grant-write logic is identical.
     */
    source?: 'signin_replay' | 'duplicate_hint';
}): Promise<{ written: number }> {
    const { adopterId, query, viewerEmail, source = 'signin_replay' } = opts;
    if (!query || !isRealActorEmail(viewerEmail)) return { written: 0 };
    const q = query.trim().slice(0, REPLAY_QUERY_MAX_LEN);
    if (!q) return { written: 0 };
    if (!(await isPiiGatingEnabled())) return { written: 0 };

    try {
        const db = await getDb();
        if (!db) return { written: 0 };

        const [adopter] = await db.select({
            id: adoptersTable.id,
            name: adoptersTable.name,
            contactEntries: adoptersTable.contactEntries,
            addedBy: adoptersTable.addedBy,
        }).from(adoptersTable).where(eq(adoptersTable.id, adopterId)).limit(1);
        if (!adopter) return { written: 0 };

        // Owner-as-viewer short-circuit (admin/editor we'd also like to skip,
        // but those need extra queries; the resolveVisibility downstream will
        // give them full visibility regardless — extra grant rows are harmless
        // but redundant, so skip the cheap-to-detect owner case here).
        if (adopter.addedBy && adopter.addedBy === viewerEmail) return { written: 0 };

        // Pre-fetch existing grant hashes so re-visits / URL shares don't
        // double-insert. One query, indexed on (granteeEmail, adopterId).
        const existing = await db.select({
            scope: piiAccessGrants.scope,
            entryRef: piiAccessGrants.entryRef,
            revokedAt: piiAccessGrants.revokedAt,
        }).from(piiAccessGrants)
            .where(and(eq(piiAccessGrants.adopterId, adopterId), eq(piiAccessGrants.granteeEmail, viewerEmail)));
        const existingEntry = new Set<string>();
        const existingName = new Set<string>();
        for (const g of existing) {
            if (g.revokedAt || !g.entryRef) continue;
            if (g.scope === 'entry') existingEntry.add(g.entryRef);
            else if (g.scope === 'name_token') existingName.add(g.entryRef);
        }

        const toInsert: Array<{ scope: 'entry' | 'name_token'; entryRef: string }> = [];

        const entryMatches = matchSearchEntries(deserializeContactEntries(adopter.contactEntries), q);
        for (const m of entryMatches) {
            if (!existingEntry.has(m.hash)) {
                existingEntry.add(m.hash);
                toInsert.push({ scope: 'entry', entryRef: m.hash });
            }
        }
        const nameMatches = matchSearchNameTokens(adopter.name, q);
        for (const token of nameMatches) {
            const h = hashNameToken(token);
            if (!existingName.has(h)) {
                existingName.add(h);
                toInsert.push({ scope: 'name_token', entryRef: h });
            }
        }

        if (toInsert.length === 0) return { written: 0 };

        await Promise.all(toInsert.map(g => db.insert(piiAccessGrants).values({
            id: crypto.randomUUID(),
            adopterId,
            granteeEmail: viewerEmail,
            scope: g.scope,
            entryRef: g.entryRef,
            origin: 'search_match',
            grantedByEmail: viewerEmail,
            createdAt: new Date(),
        })));

        logger.info('replaySearchMatchGrants: wrote grants', {
            adopterId, viewerEmail, written: toInsert.length, source,
        });
        logAudit({
            userEmail: viewerEmail,
            action: source === 'duplicate_hint' ? 'pii_search_match_grant_dup_hint' : 'pii_search_match_grant_replay',
            target: adopterId,
            details: { count: toInsert.length, source },
        });

        return { written: toInsert.length };
    } catch (e) {
        logger.warn('replaySearchMatchGrants failed', {
            adopterId, viewerEmail,
            error: e instanceof Error ? e.message : String(e),
        });
        return { written: 0 };
    }
}
