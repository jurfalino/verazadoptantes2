/**
 * The «Perfiles unidos» rows of a profile's history (H2): which merges the
 * profile absorbed, newest first, so the newest live one can offer «Son dos
 * personas distintas» — the way the newest rename offers «Deshacer»
 * (undoableRenameId). Pure: whether a merge is still live, and who may dispute
 * it, is decided on the server (src/lib/mergeDisputes.ts).
 */

export interface MergeHistoryRow {
    historyId: string;
    /** The profile that was absorbed. */
    fromId: string;
    /** The merge's audit_log id; null on rows written before it was stored. */
    auditId: string | null;
}

export function mergeRowsNewestFirst(
    history: ReadonlyArray<{ id: string; changes?: unknown; changedAt?: unknown }>,
): MergeHistoryRow[] {
    const rows: Array<MergeHistoryRow & { at: number }> = [];
    for (const h of history) {
        const m = profilesMerged(h.changes);
        if (!m) continue;
        rows.push({ historyId: h.id, fromId: m.fromId, auditId: m.auditId, at: toMillis(h.changedAt) });
    }
    rows.sort((a, b) => b.at - a.at);
    return rows.map(({ historyId, fromId, auditId }) => ({ historyId, fromId, auditId }));
}

function profilesMerged(changes: unknown): { fromId: string; auditId: string | null } | null {
    let c: unknown = changes;
    if (typeof c === 'string') {
        try { c = JSON.parse(c); } catch { return null; }
    }
    if (!c || typeof c !== 'object') return null;
    const m = (c as { profiles_merged?: unknown }).profiles_merged;
    if (!m || typeof m !== 'object') return null;
    const { fromId, auditId } = m as Record<string, unknown>;
    if (typeof fromId !== 'string' || !fromId) return null;
    return { fromId, auditId: typeof auditId === 'string' && auditId ? auditId : null };
}

function toMillis(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
    if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n > 1e11 ? n : n * 1000;
        const t = Date.parse(v);
        return Number.isNaN(t) ? 0 : t;
    }
    return 0;
}
