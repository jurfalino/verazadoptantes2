/**
 * Where "Ver contrato firmado" points for a record. A contract in private
 * storage (the server says so: `hasContract`, from placements.contract_key)
 * opens through the access-checked route; an older record carries the URL it
 * was saved with in its comments. Client-safe (no server imports).
 */
export function contractHref(animalId: string, hasContract: number | boolean | null | undefined, comments: string | null | undefined, placementId?: string | null): string | null {
    if (hasContract === 1 || hasContract === true) {
        // A past placement (a re-adopted animal) names itself; otherwise the current one.
        return `/api/files/contract/${encodeURIComponent(animalId)}${placementId ? `?placement=${encodeURIComponent(placementId)}` : ''}`;
    }
    if (!comments) return null;
    let parsed: { contractScreenshot?: unknown };
    try { parsed = JSON.parse(comments); } catch { return null; } // a plain note, not contract metadata
    return typeof parsed?.contractScreenshot === 'string' ? parsed.contractScreenshot : null;
}
