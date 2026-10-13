/**
 * Where "Ver contrato firmado" points for a record. A contract in private
 * storage (the server says so: `hasContract`, from placements.contract_key)
 * opens through the access-checked route; an older record carries the URL it
 * was saved with in its comments. Client-safe (no server imports).
 */
import { R2_PUBLIC_URL } from './r2PublicUrl';

export function contractHref(animalId: string, hasContract: number | boolean | null | undefined, comments: string | null | undefined, placementId?: string | null): string | null {
    if (hasContract === 1 || hasContract === true) {
        // A past placement (a re-adopted animal) names itself; otherwise the current one.
        return `/api/files/contract/${encodeURIComponent(animalId)}${placementId ? `?placement=${encodeURIComponent(placementId)}` : ''}`;
    }
    if (!comments) return null;
    let parsed: { contractScreenshot?: unknown };
    try { parsed = JSON.parse(comments); } catch { return null; } // a plain note, not contract metadata
    // Comments are rescuer-writable: only a genuine old contract file of THIS
    // animal on our photos bucket counts, never an arbitrary link typed in.
    const url = parsed?.contractScreenshot;
    if (typeof url !== 'string') return null;
    const legacy = new RegExp(`^${R2_PUBLIC_URL.replace(/[.]/g, '\\.')}/contracts/${animalId.replace(/[^A-Za-z0-9_-]/g, '')}/signed-contract\\.(pdf|png|jpg)$`);
    return animalId && legacy.test(url) ? url : null;
}
