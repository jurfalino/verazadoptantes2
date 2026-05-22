/**
 * PII access gating — server-side visibility orchestration.
 *
 * Loads the DB facts (admin role, editor set, grants) the pure resolver in
 * piiAccess.ts needs. A plain server module (not `'use server'`) imported by
 * the enforcement points: getAdopter, getHistory, findAdopters, /api/adopters.
 */

import { adopterHistory, piiAccessGrants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getFeatureFlag } from '@/config/features';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';
import {
    resolveVisibility,
    isRealActorEmail,
    NO_ACCESS_VISIBILITY,
    type Visibility,
    type PiiGrantRow,
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

/** Resolve visibility for a single (viewer, adopter) pair. Fails closed on error. */
export async function resolveAdopterVisibility(
    viewerEmail: string | null | undefined,
    adopter: AdopterRef,
): Promise<Visibility> {
    if (!isRealViewer(viewerEmail)) return NO_ACCESS_VISIBILITY;
    try {
        const db = await getDb();
        if (!db) return NO_ACCESS_VISIBILITY;
        const [isAdmin, editorRows, grantRows] = await Promise.all([
            isAdminAsync(viewerEmail),
            db.select({ id: adopterHistory.adopterId }).from(adopterHistory)
                .where(and(eq(adopterHistory.adopterId, adopter.id), eq(adopterHistory.changedBy, viewerEmail)))
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
        const [isAdmin, editorRows, grantRows] = await Promise.all([
            isAdminAsync(viewerEmail),
            db.selectDistinct({ id: adopterHistory.adopterId }).from(adopterHistory)
                .where(eq(adopterHistory.changedBy, viewerEmail)),
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
