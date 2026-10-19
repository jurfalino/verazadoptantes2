/**
 * API keys for the third-party API. Server-only: never import from a client
 * component or a 'use server' module (identity helpers must not become
 * browser-callable actions; see the 2026-10-04 server-action audit).
 *
 * Wire format: `Authorization: Bearer ba_<env>_<43 base62 chars>`. Only the
 * SHA-256 of the whole secret is stored; `key_prefix` (first 12 chars) lets a
 * person recognise a key in a list without it being usable.
 */
import { apiKeys } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { API_SCOPES, type ApiScope } from './schemas';
import { logger } from '@/lib/logger';

export type ApiKeyRow = typeof apiKeys.$inferSelect;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SECRET_RE = /^ba_(live|test)_[A-Za-z0-9]{32,64}$/;

export async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A new secret. `test` on any host but production, so a staging key can't be mistaken for a live one. */
export function generateSecret(environment: 'live' | 'test'): string {
    const bytes = crypto.getRandomValues(new Uint8Array(43));
    let body = '';
    for (const b of bytes) body += BASE62[b % 62];
    return `ba_${environment}_${body}`;
}

export function environmentForHost(host: string): 'live' | 'test' {
    return host === 'buenadoptante.org' || host === 'www.buenadoptante.org' ? 'live' : 'test';
}

/**
 * Import mode (2026-10-18): `api_keys.import_mode` holds when it ends (unix
 * seconds; 0 = off), so a bulk import can't be left on by mistake. While on:
 * no notifications, no LIKE scan in the duplicate check, no daily cap on EXACT
 * calls (fuzzy keeps its cap) and a high call ceiling instead of the normal one.
 */
export const IMPORT_MODE_HOURS = 24;
export const IMPORT_CALL_CEILING = 20_000;
export function importModeOn(key: { importMode?: number | null }, now = Date.now()): boolean {
    return (key.importMode ?? 0) > Math.floor(now / 1000);
}

export function keyPrefixOf(secret: string): string {
    return secret.slice(0, 12);
}

/** The bearer secret from an Authorization header, or null when absent / malformed. */
export function bearerSecret(header: string | null): string | null {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    return m && SECRET_RE.test(m[1]) ? m[1] : null;
}

/** The live (not revoked) key for a secret, or null. Same answer for unknown and revoked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findActiveKey(db: any, secret: string): Promise<ApiKeyRow | null> {
    const row = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, await sha256Hex(secret))).get() as ApiKeyRow | undefined;
    if (!row || row.revokedAt) return null;
    return row;
}

export function scopesOf(key: Pick<ApiKeyRow, 'id' | 'scopes'>): ApiScope[] {
    try {
        const parsed = JSON.parse(key.scopes);
        return Array.isArray(parsed) ? parsed.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)) : [];
    } catch (e) {
        logger.warn('api: unreadable key scopes, treating as none', { keyId: key.id, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}
