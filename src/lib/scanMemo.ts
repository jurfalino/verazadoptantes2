/**
 * One read per «Scan Now» instead of one per batch (audit A5).
 *
 * A scan is many short POSTs (one batch each, src/domain/scanResilience.ts),
 * and the gift forms every batch needs (giftPhoneEntriesByGiver: all of them,
 * answers included) were read again by every one. The page sends the same scan
 * id with each batch of one click; this keeps the value for that id in the
 * Worker isolate's memory.
 *
 * Best effort, never relied on for correctness: Cloudflare may serve the next
 * batch from another isolate (a fresh read there), a missing or unknown id
 * reads fresh, the value expires after `ttlMs`, and a failed read is not kept
 * (the retry reads again). Only the latest scan's value is held.
 */
export const SCAN_MEMO_TTL_MS = 10 * 60 * 1000;

export function scanScopedMemo<T>(ttlMs: number = SCAN_MEMO_TTL_MS) {
    let held: { scanId: string; at: number; value: Promise<T> } | null = null;
    return function read(scanId: string | null, load: () => Promise<T>, now: number = Date.now()): Promise<T> {
        if (!scanId) return load();
        if (held && held.scanId === scanId && now - held.at < ttlMs) return held.value;
        const value = load();
        const entry = { scanId, at: now, value };
        held = entry;
        value.catch(() => { if (held === entry) held = null; });
        return value;
    };
}
