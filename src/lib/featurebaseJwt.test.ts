import { describe, it, expect } from 'vitest';
import { buildFeaturebaseClaims, signFeaturebaseJwt, createFeaturebaseJwt } from './featurebaseJwt';

/**
 * Featurebase authenticates a messenger conversation with an HS256 JWT we sign
 * server-side. Two things are load-bearing and easy to get wrong:
 *
 *  1. The claim set is an ALLOWLIST. Everything in it crosses to a third party,
 *     so a future caller handing this a whole session/adopter object must not be
 *     able to leak fields by accident.
 *  2. The signature has to verify against the raw `signing input` with the same
 *     secret, base64url-encoded without padding. Featurebase rejects the token
 *     silently and the widget just falls back to anonymous, so a broken
 *     signature looks exactly like "not signed in" in the UI.
 */

const SECRET = 'test-secret-do-not-use-in-production';
const FIXED_NOW = 1_757_000_000_000; // 2025-09-04T15:33:20Z — stable iat/exp

const USER = {
    userId: 'user_123',
    email: 'rescuer@example.org',
    name: 'Ana Rescatista',
};

function decodeSegment(segment: string): Record<string, unknown> {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function verifySignature(token: string, secret: string): Promise<boolean> {
    const [header, payload, signature] = token.split('.');
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
    );
    const bytes = Uint8Array.from(
        Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
    return crypto.subtle.verify(
        'HMAC',
        key,
        bytes,
        new TextEncoder().encode(`${header}.${payload}`),
    );
}

describe('buildFeaturebaseClaims', () => {
    it('carries only the allowlisted identity fields', () => {
        const claims = buildFeaturebaseClaims(USER, { now: FIXED_NOW });
        expect(Object.keys(claims).sort()).toEqual(
            ['email', 'exp', 'iat', 'name', 'userId'].sort(),
        );
    });

    it('drops any extra field a caller passes in', () => {
        const claims = buildFeaturebaseClaims(
            { ...USER, adopterPhone: '+54 9 11 5555 5555', role: 'admin' } as never,
            { now: FIXED_NOW },
        );
        expect(claims).not.toHaveProperty('adopterPhone');
        expect(claims).not.toHaveProperty('role');
    });

    it('omits name and profilePicture when absent rather than sending empty strings', () => {
        const claims = buildFeaturebaseClaims(
            { userId: 'u1', email: 'a@b.org', name: null, profilePicture: '' },
            { now: FIXED_NOW },
        );
        expect(claims).not.toHaveProperty('name');
        expect(claims).not.toHaveProperty('profilePicture');
    });

    it('includes profilePicture when provided', () => {
        const claims = buildFeaturebaseClaims(
            { ...USER, profilePicture: 'https://example.org/a.png' },
            { now: FIXED_NOW },
        );
        expect(claims.profilePicture).toBe('https://example.org/a.png');
    });

    it('sets iat now and exp one hour ahead by default', () => {
        const claims = buildFeaturebaseClaims(USER, { now: FIXED_NOW });
        expect(claims.iat).toBe(Math.floor(FIXED_NOW / 1000));
        expect(claims.exp).toBe(Math.floor(FIXED_NOW / 1000) + 3600);
    });

    it('honours a custom ttl', () => {
        const claims = buildFeaturebaseClaims(USER, { now: FIXED_NOW, ttlSeconds: 120 });
        expect(claims.exp - claims.iat).toBe(120);
    });

    // Featurebase requires at least one of email / userId. Sending neither
    // produces a token it rejects, which surfaces as a silent anonymous
    // session — so fail loudly here instead.
    it('throws when both email and userId are missing', () => {
        expect(() => buildFeaturebaseClaims({ userId: '', email: '' }, { now: FIXED_NOW }))
            .toThrow(/email or userId/i);
    });

    it('accepts userId alone', () => {
        const claims = buildFeaturebaseClaims({ userId: 'u1', email: '' }, { now: FIXED_NOW });
        expect(claims.userId).toBe('u1');
        expect(claims).not.toHaveProperty('email');
    });

    it('accepts email alone', () => {
        const claims = buildFeaturebaseClaims({ userId: '', email: 'a@b.org' }, { now: FIXED_NOW });
        expect(claims.email).toBe('a@b.org');
        expect(claims).not.toHaveProperty('userId');
    });
});

describe('signFeaturebaseJwt', () => {
    it('produces a three-segment token with an HS256 header', async () => {
        const token = await signFeaturebaseJwt(
            buildFeaturebaseClaims(USER, { now: FIXED_NOW }),
            SECRET,
        );
        const parts = token.split('.');
        expect(parts).toHaveLength(3);
        expect(decodeSegment(parts[0])).toEqual({ alg: 'HS256', typ: 'JWT' });
    });

    it('round-trips the claims in the payload segment', async () => {
        const claims = buildFeaturebaseClaims(USER, { now: FIXED_NOW });
        const token = await signFeaturebaseJwt(claims, SECRET);
        expect(decodeSegment(token.split('.')[1])).toEqual(claims);
    });

    it('signs so the signature verifies with the same secret', async () => {
        const token = await signFeaturebaseJwt(
            buildFeaturebaseClaims(USER, { now: FIXED_NOW }),
            SECRET,
        );
        await expect(verifySignature(token, SECRET)).resolves.toBe(true);
    });

    it('does not verify under a different secret', async () => {
        const token = await signFeaturebaseJwt(
            buildFeaturebaseClaims(USER, { now: FIXED_NOW }),
            SECRET,
        );
        await expect(verifySignature(token, 'wrong-secret')).resolves.toBe(false);
    });

    it('emits base64url segments with no padding or non-url characters', async () => {
        const token = await signFeaturebaseJwt(
            buildFeaturebaseClaims(
                { ...USER, name: 'Ángeles Ñandú +/= éé' },
                { now: FIXED_NOW },
            ),
            SECRET,
        );
        expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('rejects an empty secret rather than signing with one', async () => {
        await expect(
            signFeaturebaseJwt(buildFeaturebaseClaims(USER, { now: FIXED_NOW }), ''),
        ).rejects.toThrow(/secret/i);
    });
});

describe('createFeaturebaseJwt', () => {
    it('returns a verifiable token for a valid user', async () => {
        const token = await createFeaturebaseJwt(USER, SECRET, { now: FIXED_NOW });
        expect(token).not.toBeNull();
        await expect(verifySignature(token as string, SECRET)).resolves.toBe(true);
    });

    // The layout calls this on every render. A missing secret is the normal
    // state before the Pages secret is set, and it must degrade to an
    // anonymous messenger rather than throwing through the root layout.
    it('returns null when the secret is missing', async () => {
        await expect(createFeaturebaseJwt(USER, undefined, { now: FIXED_NOW })).resolves.toBeNull();
        await expect(createFeaturebaseJwt(USER, '', { now: FIXED_NOW })).resolves.toBeNull();
    });

    it('returns null when the user has neither email nor userId', async () => {
        await expect(
            createFeaturebaseJwt({ userId: '', email: '' }, SECRET, { now: FIXED_NOW }),
        ).resolves.toBeNull();
    });
});
