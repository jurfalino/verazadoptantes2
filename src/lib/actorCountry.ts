/**
 * The rescuer's country, remembered for ten minutes per isolate. A sheet import
 * calls matchImportRow once per row, a few rows at a time; the country is the
 * same for every row, so once it has been read it is reused.
 *
 * Only RESOLVED values are cached. A lookup in flight is never shared: on
 * Cloudflare Workers, I/O is bound to the request that started it, so awaiting
 * a pending D1 promise from another request can throw ("Cannot perform I/O on
 * behalf of a different request") or be cancelled when that request ends.
 * Concurrent callers without a resolved hit each make their own lookup, and a
 * failed lookup is never cached (the rejection reaches the caller).
 */
import { ownerCountry } from '@/lib/api/profiles';

type Db = Parameters<typeof ownerCountry>[0];

const TTL_MS = 10 * 60 * 1000;
const MAX_ACTORS = 500;
const cache = new Map<string, { at: number; value: string | null }>();

export async function cachedOwnerCountry(db: Db, actor: string, requestId: string): Promise<string | null> {
    const hit = cache.get(actor);
    if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
    if (hit) cache.delete(actor);
    const value = await ownerCountry(db, actor, requestId);
    if (!cache.has(actor) && cache.size >= MAX_ACTORS) cache.delete(cache.keys().next().value as string); // oldest first
    cache.set(actor, { at: Date.now(), value });
    return value;
}

/** Tests only: start from an empty cache. */
export function clearActorCountryCache(): void {
    cache.clear();
}
