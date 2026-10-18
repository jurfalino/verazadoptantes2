/**
 * /developers (Jon, 2026-10-17): any signed-in user creates and manages their
 * OWN API keys — after accepting the API terms — with self-service limits. An
 * admin still sees every key in Admin → API (marked as self-created) and can
 * revoke it or raise its limits. Server-only.
 */
import { and, eq, isNull, count } from 'drizzle-orm';
import { apiKeys, apiTermsAcceptances } from '@/db/schema';
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

export async function termsAccepted(db: Db, email: string): Promise<boolean> {
    const row = await db.select({ v: apiTermsAcceptances.version }).from(apiTermsAcceptances)
        .where(and(eq(apiTermsAcceptances.userEmail, email), eq(apiTermsAcceptances.version, API_TERMS_VERSION))).get();
    return !!row;
}

export async function acceptTerms(db: Db, email: string): Promise<void> {
    await db.insert(apiTermsAcceptances).values({ userEmail: email, version: API_TERMS_VERSION, acceptedAt: new Date() }).onConflictDoNothing();
}

export async function myDeveloperState(db: Db, email: string, host: string) {
    const [accepted, keys] = await Promise.all([termsAccepted(db, email), listKeys(db, email)]);
    return {
        termsAccepted: accepted, termsVersion: API_TERMS_VERSION,
        environment: environmentForHost(host), caps: SELF_SERVICE_CAPS, maxActiveKeys: MAX_ACTIVE_KEYS,
        keys,
    };
}

export type SelfServiceError = 'terms_required' | 'too_many_keys' | 'name_required' | 'not_found' | 'revoked';

export async function createMyKey(db: Db, email: string, name: string, host: string) {
    if (!name.trim()) return { error: 'name_required' as const };
    if (!(await termsAccepted(db, email))) return { error: 'terms_required' as const };
    // Only the keys they created themselves count: a key an admin issued them doesn't use up the limit.
    const active = await db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.ownerEmail, email), eq(apiKeys.createdBy, email), isNull(apiKeys.revokedAt))).get();
    if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) return { error: 'too_many_keys' as const };
    // createdBy = the owner: that is what marks a key as self-created.
    return issueKey(db, { ownerEmail: email, name, dailyCapExact: SELF_SERVICE_CAPS.exact, dailyCapFuzzy: SELF_SERVICE_CAPS.fuzzy }, host, email);
}

async function ownKey(db: Db, email: string, id: string) {
    return await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.ownerEmail, email))).get() as typeof apiKeys.$inferSelect | undefined;
}

export async function regenerateMyKey(db: Db, email: string, id: string, host: string) {
    const key = await ownKey(db, email, id);
    if (!key) return { error: 'not_found' as const };
    return regenerateKey(db, id, host);
}

export async function revokeMyKey(db: Db, email: string, id: string) {
    const key = await ownKey(db, email, id);
    if (!key) return { error: 'not_found' as const };
    if (key.revokedAt) return { ok: true as const, alreadyRevoked: true };
    await db.update(apiKeys).set({ revokedAt: new Date(), revokedBy: email }).where(eq(apiKeys.id, id));
    return { ok: true as const };
}
