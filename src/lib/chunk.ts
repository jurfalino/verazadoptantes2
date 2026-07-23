/**
 * Split an array into fixed-size chunks. Order-preserving; the final chunk may
 * be shorter. Used to keep D1 `IN (?, ?, …)` queries under Cloudflare's
 * hard limit of 100 bound parameters per query (see D1_IN_CHUNK below).
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
    if (size <= 0) throw new Error(`chunk: size must be > 0, got ${size}`);
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

/**
 * Chunk size for adopter-id `IN (…)` lists in getMyAdopters' enrichment queries.
 *
 * D1 rejects any query with more than 100 bound parameters. The dup-candidates
 * query binds the id list TWICE (`adopter1_id IN (…) OR adopter2_id IN (…)`)
 * plus one status param, so the worst case is `D1_IN_CHUNK * 2 + 1`. At 40 that
 * is 81 — comfortably under 100. This mirrors the CHUNK=40 already used by
 * enrichAdopters.ts for the same reason. If you raise this, the invariant
 * `D1_IN_CHUNK * 2 + 1 <= 100` must hold (guarded by chunk.test.ts).
 */
export const D1_IN_CHUNK = 40;
