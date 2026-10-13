/**
 * Signed contracts live in their OWN private bucket (CONTRACTS_BUCKET, no
 * public address — unlike photos in IMAGES_BUCKET; staging has its own). Every
 * signing gets a random key, so signing an animal again never overwrites an
 * earlier contract. The key is kept in `placements.contract_key`, a column only
 * the server writes (never in `comments`, which rescuers can write), and each
 * file carries the animal it belongs to: /api/files/contract/[animalId] serves
 * it only when both agree, and only to the animal's rescue and admins.
 * Server-only.
 */
import { getRequestContext } from '@/lib/requestContext';
import { logger } from '@/lib/logger';

export const CONTRACT_CONTENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
export const CONTRACT_MAX_BYTES = 5 * 1024 * 1024;

/** Thrown when the contract can't be stored; its message is safe to show the public. */
export class ContractStorageError extends Error {}

type R2Object = { body: ReadableStream; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; size: number };
type R2Like = {
    put: (key: string, data: ArrayBuffer, opts?: Record<string, unknown>) => Promise<unknown>;
    get: (key: string) => Promise<R2Object | null>;
    head: (key: string) => Promise<{ customMetadata?: Record<string, string> } | null>;
    delete: (key: string) => Promise<void>;
};

function bucket(): R2Like {
    const { env } = getRequestContext();
    const b = (env as unknown as Record<string, unknown>).CONTRACTS_BUCKET as R2Like | undefined;
    if (!b) {
        logger.error('contract storage: CONTRACTS_BUCKET binding not configured', null, {});
        throw new ContractStorageError('No se pudo guardar el contrato. Probá de nuevo más tarde.');
    }
    return b;
}

/** Does the file start like what it claims to be? A mislabelled upload is refused, never stored. */
export function looksLike(contentType: string, data: ArrayBuffer): boolean {
    const b = new Uint8Array(data.slice(0, 12));
    const at = (i: number, bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
    switch (contentType) {
        case 'application/pdf': return at(0, [0x25, 0x50, 0x44, 0x46]); // %PDF
        case 'image/png': return at(0, [0x89, 0x50, 0x4e, 0x47]);
        case 'image/jpeg': return at(0, [0xff, 0xd8, 0xff]);
        case 'image/webp': return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
        default: return false;
    }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Store one signed contract for `animalId`. Throws on an unsupported type, an oversize file, or a failed write (after retries). */
export async function storeContract(data: ArrayBuffer, contentType: string, meta: { animalId: string } & Record<string, unknown>): Promise<{ key: string; sha256: string; size: number }> {
    const ext = CONTRACT_CONTENT_TYPES[contentType];
    if (!ext) throw new ContractStorageError(`unsupported contract type ${contentType}`);
    if (data.byteLength > CONTRACT_MAX_BYTES) throw new ContractStorageError(`contract larger than ${CONTRACT_MAX_BYTES} bytes`);
    if (!looksLike(contentType, data)) throw new ContractStorageError(`the file is not a valid ${ext.toUpperCase()}`);
    const key = `contracts/${crypto.randomUUID()}.${ext}`;
    // Re-read through Response: the platform's own buffer type, which both the
    // digest and the bucket accept wherever the body was read (the API handler
    // reads it in another realm under `next dev`).
    const buf = await new Response(new Uint8Array(data)).arrayBuffer();
    const sha256 = await sha256Hex(buf);
    const b = bucket();
    for (let attempt = 0; ; attempt++) {
        try {
            await b.put(key, buf, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { sha256, animalId: meta.animalId } });
            logger.info('contract stored', { ...meta, key, size: data.byteLength });
            return { key, sha256, size: data.byteLength };
        } catch (e) {
            if (attempt >= 2) throw e;
            logger.warn('contract store attempt failed, retrying', { ...meta, attempt: attempt + 1, error: e instanceof Error ? e.message : String(e) });
            await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
    }
}

export const SELFIE_CONTENT_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * An applicant's selfie from the adoption form, in the same private storage
 * (prefix selfies/), tagged with its form submission. Same rules as contracts:
 * random key, server-written column (form_submissions.selfie_key), served only
 * by /api/files/selfie/[submissionId] for whoever may see that form's results.
 */
export async function storeSelfie(data: ArrayBuffer, rawContentType: string, submissionId: string): Promise<{ key: string; size: number }> {
    const contentType = rawContentType === 'image/jpg' ? 'image/jpeg' : rawContentType; // a common mislabel
    const ext = SELFIE_CONTENT_TYPES[contentType];
    if (!ext) throw new ContractStorageError(`unsupported selfie type ${contentType}`);
    if (data.byteLength > CONTRACT_MAX_BYTES) throw new ContractStorageError(`selfie larger than ${CONTRACT_MAX_BYTES} bytes`);
    if (!looksLike(contentType, data)) throw new ContractStorageError(`the file is not a valid ${ext.toUpperCase()}`);
    const key = `selfies/${crypto.randomUUID()}.${ext}`;
    const buf = await new Response(new Uint8Array(data)).arrayBuffer();
    await bucket().put(key, buf, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { submissionId } });
    logger.info('selfie stored', { submissionId, key, size: data.byteLength });
    return { key, size: data.byteLength };
}

/** The selfie, only if it was stored for this submission. */
export async function readSelfie(key: string, submissionId: string): Promise<R2Object | null> {
    const file = await bucket().get(key);
    if (!file) return null;
    if (file.customMetadata?.submissionId !== submissionId) {
        logger.warn('selfie file: stored for another submission, refused', { key, submissionId });
        return null;
    }
    return file;
}

/** The file, only if it was stored for this animal (a key copied onto another record serves nothing). */
export async function readContract(key: string, animalId: string): Promise<R2Object | null> {
    const file = await bucket().get(key);
    if (!file) return null;
    if (file.customMetadata?.animalId !== animalId) {
        logger.warn('contract file: stored for another animal, refused', { key, animalId });
        return null;
    }
    return file;
}

export async function contractExists(key: string, animalId: string): Promise<boolean> {
    const head = await bucket().head(key);
    return !!head && head.customMetadata?.animalId === animalId;
}

export async function deleteContract(key: string): Promise<void> {
    await bucket().delete(key);
}
