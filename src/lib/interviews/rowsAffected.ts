/**
 * Rows changed by a write, read portably: better-sqlite3 (local/tests)
 * returns `{ changes }`, D1 returns `{ meta: { changes } }`. Null when the
 * driver reports neither — callers then re-read the row to confirm the write.
 */
export function rowsAffected(res: unknown): number | null {
    const r = res as { changes?: unknown; meta?: { changes?: unknown } } | null | undefined;
    if (typeof r?.changes === 'number') return r.changes;
    if (typeof r?.meta?.changes === 'number') return r.meta.changes;
    return null;
}
