/**
 * /developers (Jon, 2026-10-17; 2026-10-22): any signed-in user creates and
 * manages their OWN API keys right after accepting the API terms. Until an admin
 * approves their access (filed with their first key), the keys run at
 * PENDING_APPROVAL_CAPS; approved, at SELF_SERVICE_CAPS. An admin still sees
 * every key in Admin → API (marked as self-created) and can revoke it or raise
 * its limits. Server-only.
 */
import { and, eq, gte, isNull, count } from 'drizzle-orm';
import { apiKeys, apiTermsAcceptances } from '@/db/schema';
import { canCreateKeys, getAccess, hasFullLimits, PENDING_APPROVAL_CAPS, requestAccess } from './access';
import { issueKey, listKeys, regenerateKey } from './review';
import { environmentForHost } from './keys';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** Bump when the terms text changes: everyone accepts again before their next key. */
export const API_TERMS_VERSION = 1;
/** Daily limits of a self-created key (Jon, 2026-10-17); an admin can raise them per key. */
export const SELF_SERVICE_CAPS = { exact: 100, fuzzy: 50 } as const;
/** Active keys one person may hold (one per tool is plenty). */
export const MAX_ACTIVE_KEYS = 3;
/** Keys one person may create per day: revoke-and-recreate must not be a way around the limits. */
export const MAX_KEYS_CREATED_PER_DAY = 3;

export async function termsAccepted(db: Db, email: string): Promise<boolean> {
    const row = await db.select({ v: apiTermsAcceptances.version }).from(apiTermsAcceptances)
        .where(and(eq(apiTermsAcceptances.userEmail, email), eq(apiTermsAcceptances.version, API_TERMS_VERSION))).get();
    return !!row;
}

export async function acceptTerms(db: Db, email: string): Promise<void> {
    await db.insert(apiTermsAcceptances).values({ userEmail: email, version: API_TERMS_VERSION, acceptedAt: new Date() }).onConflictDoNothing();
}

export async function myDeveloperState(db: Db, email: string, host: string) {
    const [accepted, keys, access, allowed, full] = await Promise.all([termsAccepted(db, email), listKeys(db, email), getAccess(db, email), canCreateKeys(db, email), hasFullLimits(db, email)]);
    const limited = !full;
    return {
        termsAccepted: accepted, termsVersion: API_TERMS_VERSION,
        // The person's API access (admin approval), whether they may create keys now,
        // and whether their own keys still run at the pending limits.
        access, canCreateKeys: allowed, limited,
        environment: environmentForHost(host),
        caps: limited ? PENDING_APPROVAL_CAPS : SELF_SERVICE_CAPS, approvedCaps: SELF_SERVICE_CAPS, pendingCaps: PENDING_APPROVAL_CAPS,
        maxActiveKeys: MAX_ACTIVE_KEYS,
        // Each own key shown with the limits it really has today.
        keys: keys.map(k => (limited && k.selfService
            ? { ...k, dailyCapExact: Math.min(k.dailyCapExact, PENDING_APPROVAL_CAPS.exact), dailyCapFuzzy: Math.min(k.dailyCapFuzzy, PENDING_APPROVAL_CAPS.fuzzy) }
            : k)),
    };
}

export type SelfServiceError = 'terms_required' | 'blocked' | 'too_many_keys' | 'too_many_today' | 'name_required' | 'not_found' | 'revoked';

/**
 * A new own key — working at once (at the pending limits until approved). The
 * first key files the access request for the person: its name is the tool,
 * `purpose` what it is for (an admin approves it to raise the limits).
 */
export async function createMyKey(db: Db, email: string, name: string, host: string, purpose = '') {
    if (!name.trim()) return { error: 'name_required' as const };
    if (!(await termsAccepted(db, email))) return { error: 'terms_required' as const };
    if (!(await canCreateKeys(db, email))) return { error: 'blocked' as const };
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const today = await db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.ownerEmail, email), eq(apiKeys.createdBy, email), gte(apiKeys.createdAt, startOfDay))).get();
    if ((today?.n ?? 0) >= MAX_KEYS_CREATED_PER_DAY) return { error: 'too_many_today' as const };
    // Only the keys they created themselves count: a key an admin issued them doesn't use up the limit.
    const active = await db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.ownerEmail, email), eq(apiKeys.createdBy, email), isNull(apiKeys.revokedAt))).get();
    if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) return { error: 'too_many_keys' as const };
    // createdBy = the owner: that is what marks a key as self-created.
    const issued = await issueKey(db, { ownerEmail: email, name, dailyCapExact: SELF_SERVICE_CAPS.exact, dailyCapFuzzy: SELF_SERVICE_CAPS.fuzzy }, host, email);
    if ('error' in issued) return issued;
    // Nobody asked yet: this key's creation is the request (a denied person asks again on purpose).
    const access = await getAccess(db, email);
    const requested = access.status === 'none' && 'ok' in (await requestAccess(db, email, name, purpose));
    return { ...issued, requested, limited: !(await hasFullLimits(db, email)) };
}

async function ownKey(db: Db, email: string, id: string) {
    return await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.ownerEmail, email))).get() as typeof apiKeys.$inferSelect | undefined;
}

export async function regenerateMyKey(db: Db, email: string, id: string, host: string) {
    const key = await ownKey(db, email, id);
    if (!key) return { error: 'not_found' as const };
    // Regenerating is making a key: a blocked person can't.
    if (!(await canCreateKeys(db, email))) return { error: 'blocked' as const };
    return regenerateKey(db, id, host);
}

export async function revokeMyKey(db: Db, email: string, id: string) {
    const key = await ownKey(db, email, id);
    if (!key) return { error: 'not_found' as const };
    if (key.revokedAt) return { ok: true as const, alreadyRevoked: true };
    await db.update(apiKeys).set({ revokedAt: new Date(), revokedBy: email }).where(eq(apiKeys.id, id));
    return { ok: true as const };
}
