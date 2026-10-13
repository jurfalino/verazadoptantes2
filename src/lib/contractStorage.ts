/**
 * Signed contracts live in their OWN private bucket (CONTRACTS_BUCKET, no
 * public address — unlike photos in IMAGES_BUCKET). Every signing gets a random
 * key, so signing an animal again never overwrites an earlier contract, and a
 * file is only reachable through /api/files/contract/[animalId], which checks
 * who is asking. Server-only.
 */
import { getRequestContext } from '@/lib/requestContext';
import { logger } from '@/lib/logger';

export const CONTRACT_CONTENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
export const CONTRACT_MAX_BYTES = 5 * 1024 * 1024;

type R2Like = {
    put: (key: string, data: ArrayBuffer | Uint8Array, opts?: Record<string, unknown>) => Promise<unknown>;
    get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; size: number } | null>;
};

function bucket(): R2Like {
    const { env } = getRequestContext();
    const b = (env as unknown as Record<string, unknown>).CONTRACTS_BUCKET as R2Like | undefined;
    if (!b) throw new Error('CONTRACTS_BUCKET binding not configured');
    return b;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Store one signed contract. Throws on an unsupported type, an oversize file, or a failed write (after retries). */
export async function storeContract(data: ArrayBuffer, contentType: string, ctx: Record<string, unknown>): Promise<{ key: string; sha256: string; size: number }> {
    const ext = CONTRACT_CONTENT_TYPES[contentType];
    if (!ext) throw new Error(`unsupported contract type ${contentType}`);
    if (data.byteLength > CONTRACT_MAX_BYTES) throw new Error(`contract larger than ${CONTRACT_MAX_BYTES} bytes`);
    const key = `contracts/${crypto.randomUUID()}.${ext}`;
    const sha256 = await sha256Hex(data);
    const b = bucket();
    for (let attempt = 0; ; attempt++) {
        try {
            await b.put(key, data, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { sha256 } });
            logger.info('contract stored', { ...ctx, key, size: data.byteLength });
            return { key, sha256, size: data.byteLength };
        } catch (e) {
            if (attempt >= 2) throw e;
            logger.warn('contract store attempt failed, retrying', { ...ctx, attempt: attempt + 1, error: e instanceof Error ? e.message : String(e) });
            await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
    }
}

export async function readContract(key: string) {
    return bucket().get(key);
}

/** The contract key a record's `comments` JSON carries (new private storage), if any. */
export function contractKeyOf(comments: string | null | undefined): string | null {
    if (!comments) return null;
    try {
        const k = (JSON.parse(comments) as { contractKey?: unknown }).contractKey;
        return typeof k === 'string' && k.startsWith('contracts/') ? k : null;
    } catch { return null; } // not JSON: a plain note, no contract
}
