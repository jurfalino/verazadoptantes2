/**
 * Which requests the service worker intercepts at all (its 'fetch' listener).
 * Regression (2026-10-12): it intercepted cross-origin GETs, and its own fetch()
 * is bound by sw.js's CSP, so a jsDelivr script and the Cloudflare beacon came
 * back «Offline» 503 — /api/v1/docs rendered blank for returning visitors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';

const SW_PATH = path.resolve(__dirname, '../../public/sw.js');
const ORIGIN = 'https://staging.buenadoptante.org';

function loadFetchListener(): (event: unknown) => void {
    let listener: ((event: unknown) => void) | null = null;
    const sandbox: Record<string, unknown> = {
        self: {
            location: new URL(`${ORIGIN}/sw.js`),
            addEventListener: (type: string, fn: (event: unknown) => void) => { if (type === 'fetch') listener = fn; },
            skipWaiting: () => { }, clients: { claim: () => { } },
        },
        caches: { open: async () => ({}), match: async () => undefined, keys: async () => [], delete: async () => true },
        fetch: async () => new Response('net'),
        Response, Request, Headers, URL, URLSearchParams, console, Date, setTimeout, clearTimeout, Promise,
    };
    sandbox.globalThis = sandbox;
    runInContext(readFileSync(SW_PATH, 'utf8'), createContext(sandbox));
    if (!listener) throw new Error('sw.js registered no fetch listener');
    return listener;
}

/** True when the worker takes over the request (calls respondWith). */
function intercepts(url: string, init: { method?: string; mode?: string } = {}): boolean {
    const listener = loadFetchListener();
    let took = false;
    listener({
        request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' },
        respondWith: () => { took = true; },
    });
    return took;
}

describe('service worker: what it intercepts', () => {
    it('leaves every other origin to the browser (scripts, beacons, storage)', () => {
        expect(intercepts('https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1/dist/browser/standalone.js')).toBe(false);
        expect(intercepts('https://static.cloudflareinsights.com/beacon.min.js/v4')).toBe(false);
        expect(intercepts('https://pub-123.r2.dev/photo.jpg')).toBe(false);
    });

    it('never caches the third-party API or its docs', () => {
        expect(intercepts(`${ORIGIN}/api/v1/docs`, { mode: 'navigate' })).toBe(false);
        expect(intercepts(`${ORIGIN}/api/v1/openapi.json`)).toBe(false);
    });

    it("still handles the app's own pages, assets and API", () => {
        expect(intercepts(`${ORIGIN}/my-animals`, { mode: 'navigate' })).toBe(true);
        expect(intercepts(`${ORIGIN}/_next/static/chunks/main.js`)).toBe(true);
        expect(intercepts(`${ORIGIN}/api/adopters`)).toBe(true);
    });
});
