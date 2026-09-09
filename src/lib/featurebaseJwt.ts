/**
 * Featurebase messenger identity — HS256 JWT, signed server-side.
 *
 * Featurebase boots anonymously without a token; the JWT is what ties a
 * conversation to a known rescuer so replies land on the right contact. The
 * secret lives in FEATUREBASE_JWT_SECRET (Settings → Access & Security in the
 * Featurebase dashboard) and must never reach the client.
 *
 * Runs on the edge: Web Crypto + btoa only, no `jsonwebtoken`, no Buffer, no
 * new dependency. `jose` is present in the tree via next-auth but isn't a
 * declared dependency of ours, so we don't import it.
 *
 * The claim set is a deliberate ALLOWLIST. Everything here crosses to a third
 * party, and the callers have whole session objects in scope — see the tests
 * for the leak this prevents.
 *
 * Known behaviour, not a bug: Featurebase refuses SSO tokens for users who are
 * admins of a Featurebase organization. Signed in as the account that owns the
 * org, the token is rejected and the widget falls back to anonymous.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { logger } from '@/lib/logger';

const DEFAULT_TTL_SECONDS = 3600;

/**
 * Read the signing secret from the Cloudflare binding, falling back to
 * process.env for local dev. Same shape as `readEnv` in src/lib/telegram.ts —
 * getRequestContext throws outside a request, which is a normal state here
 * (unit tests, build-time evaluation), so the throw is swallowed deliberately
 * and the caller treats "no secret" as anonymous.
 */
export function getFeaturebaseSecret(): string | undefined {
    try {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (ctx?.env ?? {}) as Record<string, any>;
        if (typeof env.FEATUREBASE_JWT_SECRET === 'string' && env.FEATUREBASE_JWT_SECRET) {
            return env.FEATUREBASE_JWT_SECRET;
        }
    } catch { /* not in a Cloudflare request context */ }
    return process.env.FEATUREBASE_JWT_SECRET || undefined;
}

export interface FeaturebaseUserInput {
    userId: string;
    email: string;
    name?: string | null;
    profilePicture?: string | null;
}

export interface FeaturebaseClaims {
    userId?: string;
    email?: string;
    name?: string;
    profilePicture?: string;
    iat: number;
    exp: number;
}

interface ClaimOptions {
    /** Injected in tests so iat/exp are deterministic. Milliseconds. */
    now?: number;
    ttlSeconds?: number;
}

/**
 * Reduce an arbitrary user-shaped object to the claims Featurebase accepts.
 * Throws when neither identifier is present: a token without one is accepted
 * by the widget and then silently ignored, which is indistinguishable from
 * "not signed in" in the UI.
 */
export function buildFeaturebaseClaims(
    user: FeaturebaseUserInput,
    options: ClaimOptions = {},
): FeaturebaseClaims {
    const userId = (user.userId || '').trim();
    const email = (user.email || '').trim();
    if (!userId && !email) {
        throw new Error('Featurebase claims require email or userId');
    }

    const nowMs = options.now ?? Date.now();
    const iat = Math.floor(nowMs / 1000);
    const claims: FeaturebaseClaims = {
        iat,
        exp: iat + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    };

    if (userId) claims.userId = userId;
    if (email) claims.email = email;

    const name = (user.name || '').trim();
    if (name) claims.name = name;

    const profilePicture = (user.profilePicture || '').trim();
    if (profilePicture) claims.profilePicture = profilePicture;

    return claims;
}

function base64urlFromBytes(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(value: string): string {
    return base64urlFromBytes(new TextEncoder().encode(value));
}

/** Sign prepared claims. Exported separately so the claim shape stays testable. */
export async function signFeaturebaseJwt(claims: FeaturebaseClaims, secret: string): Promise<string> {
    if (!secret) {
        throw new Error('Featurebase JWT secret is empty');
    }
    const header = base64urlFromString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64urlFromString(JSON.stringify(claims));
    const signingInput = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));

    return `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;
}

/**
 * Build + sign in one call, degrading to null instead of throwing.
 *
 * The root layout calls this on every render, and a null token is a supported
 * state: the messenger still boots, just anonymously. A missing secret is the
 * normal state before the Pages secret is set, so it is not logged — an
 * unexpected failure is.
 */
export async function createFeaturebaseJwt(
    user: FeaturebaseUserInput,
    secret: string | undefined,
    options: ClaimOptions = {},
): Promise<string | null> {
    if (!secret) return null;
    try {
        return await signFeaturebaseJwt(buildFeaturebaseClaims(user, options), secret);
    } catch (e) {
        logger.warn('featurebase: token generation failed, falling back to anonymous', {
            hasUserId: !!user.userId,
            hasEmail: !!user.email,
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}
