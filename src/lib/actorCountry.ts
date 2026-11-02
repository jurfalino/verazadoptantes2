/**
 * The rescuer's country, remembered for ten minutes per isolate. A sheet import
 * calls matchImportRow once per row, a few rows at a time; the country is the
 * same for every row, so it is read once. The in-flight lookup is shared (the
 * first wave of concurrent rows makes one read) and a failed lookup is
 * forgotten, so the next row tries again.
 */
import { ownerCountry } from '@/lib/api/profiles';

type Db = Parameters<typeof ownerCountry>[0];

const TTL_MS = 10 * 60 * 1000;
const MAX_ACTORS = 500;
const cache = new Map<string, { at: number; value: Promise<string | null> }>();

export function cachedOwnerCountry(db: Db, actor: string, requestId: string): Promise<string | null> {
    const now = Date.now();
    const hit = cache.get(actor);
    if (hit && now - hit.at <= TTL_MS) return hit.value;
    if (hit) cache.delete(actor);
    if (cache.size >= MAX_ACTORS) cache.delete(cache.keys().next().value as string); // oldest first
    const value = ownerCountry(db, actor, requestId);
    const entry = { at: now, value };
    cache.set(actor, entry);
    // Not cached when it fails; the caller still sees (and handles) the rejection.
    value.catch(() => { if (cache.get(actor) === entry) cache.delete(actor); });
    return value;
}

/** Tests only: start from an empty cache. */
export function clearActorCountryCache(): void {
    cache.clear();
}
