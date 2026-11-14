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

/**
 * Inline script placed right after the placeholder in the server HTML: applies the stored height before the
 * first paint, so the route skeleton and the server-rendered page already hold it (the effect that reads it runs
 * only after hydration, and the list skeleton below would jump down then). 0 = hide, as the component does.
 */
export const APPLY_RESERVED_HEIGHT_SCRIPT =
    `try{var e=document.currentScript.previousElementSibling,v=localStorage.getItem(${JSON.stringify(KEY)});` +
    `if(e&&v!=null&&/^\\d+$/.test(v)){v=Math.min(${MAX},+v);if(v===0)e.style.display='none';else e.style.height=v+'px'}}catch(_){}`;
