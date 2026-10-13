/**
 * Where "Ver contrato firmado" points for a record. New contracts live in
 * private storage and open through the access-checked route; older records
 * carry the URL they were saved with. Client-safe (no server imports).
 */
export function contractHref(animalId: string, comments: string | null | undefined, placementId?: string | null): string | null {
    if (!comments) return null;
    let parsed: { contractKey?: unknown; contractScreenshot?: unknown };
    try { parsed = JSON.parse(comments); } catch { return null; } // a plain note, not contract metadata
    if (typeof parsed?.contractKey === 'string') {
        // A past placement (a re-adopted animal) names itself; otherwise the current one.
        return `/api/files/contract/${encodeURIComponent(animalId)}${placementId ? `?placement=${encodeURIComponent(placementId)}` : ''}`;
    }
    if (typeof parsed?.contractScreenshot === 'string') return parsed.contractScreenshot;
    return null;
}
