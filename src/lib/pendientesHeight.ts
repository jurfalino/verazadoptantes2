/**
 * «Pendientes de revisar» opens by itself above the adopters list once its reads settle (~1–2 s on a big
 * account), which pushed the search box and the list down under a finger (UX review S5). While it loads it now
 * holds the height it had on this viewer's last visit. Per-viewer convenience in localStorage: a missing or
 * blocked store just falls back to the small default placeholder.
 */
const KEY = 'pendientes:height:v1';
const MAX = 1600;

/** The height to reserve, from what was stored; null = nothing usable (the default placeholder). */
export function reservedHeight(raw: string | null): number | null {
    if (raw == null || !/^\d+$/.test(raw)) return null;
    return Math.min(MAX, Number(raw));
}

export function readReservedHeight(): number | null {
    try { return reservedHeight(window.localStorage.getItem(KEY)); } catch { return null; } // storage blocked: SSR-safe read
}

export function saveReservedHeight(px: number): void {
    try { window.localStorage.setItem(KEY, String(Math.max(0, Math.round(px)))); } catch { /* storage blocked: the default placeholder next time */ }
}
