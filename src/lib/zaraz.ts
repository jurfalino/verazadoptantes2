/**
 * Typed wrappers for Cloudflare Zaraz client-side API.
 *
 * Zaraz is injected by Cloudflare at the edge — `window.zaraz` is only
 * available in the browser after the Zaraz script loads.
 *
 * These helpers are safe to call at any time:
 *  - Server-side (SSR): no-ops (window is undefined)
 *  - Before Zaraz loads: no-ops (window.zaraz is undefined)
 *  - Ad-blocker active: no-ops (Zaraz proxied through CF so unlikely, but safe)
 */

declare global {
    interface Window {
        zaraz?: {
            set: (key: string, value: string | number | boolean, options?: { scope?: 'page' | 'session' | 'persist' }) => void;
            track: (eventName: string, properties?: Record<string, string | number | boolean>) => Promise<void>;
        };
    }
}

function getZaraz() {
    if (typeof window !== 'undefined' && window.zaraz) return window.zaraz;
    return null;
}

/**
 * Set a key-value pair that will be included with all subsequent zaraz.track() calls.
 * Use for user identity and persistent properties (userId, role, etc.).
 *
 * @param scope - 'page' (default, resets on navigation), 'session' (tab lifetime), 'persist' (cross-session via cookie)
 */
export function zarazSet(key: string, value: string | number | boolean, scope: 'page' | 'session' | 'persist' = 'session') {
    getZaraz()?.set(key, value, { scope });
}

/**
 * Track a custom event. Properties are sent alongside any values set via zarazSet().
 *
 * @param eventName - e.g. 'search_performed', 'adoption_created'
 * @param properties - optional event-specific properties
 */
export function zarazTrack(eventName: string, properties?: Record<string, string | number | boolean>) {
    getZaraz()?.track(eventName, properties);
}
