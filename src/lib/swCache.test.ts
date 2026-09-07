/**
 * Tests the service worker's caching strategies.
 *
 * `public/sw.js` is a classic (non-module) worker script, so it can't be
 * imported — it's evaluated in a `vm` context with stubbed `self`/`caches`/
 * `fetch`, after which its top-level function declarations are reachable as
 * properties of that context's global. Lives under src/ because vitest.config
 * only collects `src/**./*.test.ts`.
 *
 * Regression covered: networkFirst accepted a `ttlSeconds` argument (the fetch
 * handler passes 1 hour for /api/ requests) and never used it, so an offline
 * client could be served an unboundedly stale API response.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';

const SW_PATH = path.resolve(__dirname, '../../public/sw.js');
const CACHED_AT = 'x-sw-cached-at';

type CacheStores = Map<string, Map<string, Response>>;

function keyOf(req: string | Request): string {
    return typeof req === 'string' ? req : req.url;
}

function makeCaches(stores: CacheStores) {
    const openStore = (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name)!;
    };
    return {
        open: async (name: string) => {
            const store = openStore(name);
            return {
                put: async (req: string | Request, res: Response) => { store.set(keyOf(req), res); },
                match: async (req: string | Request) => store.get(keyOf(req)),
                delete: async (req: string | Request) => store.delete(keyOf(req)),
                keys: async () => [...store.keys()],
            };
        },
        match: async (req: string | Request) => {
            for (const store of stores.values()) {
                const hit = store.get(keyOf(req));
                if (hit) return hit;
            }
            return undefined;
        },
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
    };
}

interface SwContext {
    networkFirst: (req: string | Request, cacheName: string, ttlSeconds?: number) => Promise<Response>;
    [key: string]: unknown;
}

function loadSw(fetchImpl: (req: unknown) => Promise<Response>) {
    const stores: CacheStores = new Map();
    const sandbox: Record<string, unknown> = {
        self: {
            addEventListener: () => { },
            skipWaiting: () => { },
            clients: { claim: () => { } },
        },
        caches: makeCaches(stores),
        fetch: fetchImpl,
        Response, Request, Headers, URL, URLSearchParams, console, Date,
        setTimeout, clearTimeout, Promise,
    };
    sandbox.globalThis = sandbox;
    const ctx = createContext(sandbox);
    runInContext(readFileSync(SW_PATH, 'utf8'), ctx);
    return { sw: ctx as unknown as SwContext, stores };
}

/** Let the fire-and-forget cache write settle (it isn't awaited, by design). */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function stamped(body: string, ageSeconds: number): Response {
    return new Response(body, {
        status: 200,
        headers: { [CACHED_AT]: String(Date.now() - ageSeconds * 1000) },
    });
}

const offline = () => Promise.reject(new Error('offline'));
const CACHE = 'test-dynamic';
const URL_UNDER_TEST = 'https://example.test/api/adopters';

describe('service worker networkFirst', () => {
    let stores: CacheStores;

    beforeEach(() => { stores = new Map(); });

    it('serves the network response and stamps the cached copy', async () => {
        const loaded = loadSw(async () => new Response('fresh', { status: 200 }));
        stores = loaded.stores;
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(await res.text()).toBe('fresh');

        await flush();
        const cached = stores.get(CACHE)?.get(URL_UNDER_TEST);
        expect(cached).toBeDefined();
        expect(Number(cached!.headers.get(CACHED_AT))).toBeGreaterThan(Date.now() - 5000);
    });

    it('falls back to a cached response that is within the TTL', async () => {
        const loaded = loadSw(offline);
        loaded.stores.set(CACHE, new Map([[URL_UNDER_TEST, stamped('cached', 60)]]));
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('cached');
    });

    it('does NOT serve a cached response older than the TTL', async () => {
        const loaded = loadSw(offline);
        loaded.stores.set(CACHE, new Map([[URL_UNDER_TEST, stamped('stale', 7200)]]));
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: 'Offline' });
    });

    it('evicts the expired entry so it cannot be served again', async () => {
        const loaded = loadSw(offline);
        loaded.stores.set(CACHE, new Map([[URL_UNDER_TEST, stamped('stale', 7200)]]));
        await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(loaded.stores.get(CACHE)?.has(URL_UNDER_TEST)).toBe(false);
    });

    it('treats an unstamped entry as expired when a TTL is required', async () => {
        const loaded = loadSw(offline);
        loaded.stores.set(CACHE, new Map([[URL_UNDER_TEST, new Response('legacy', { status: 200 })]]));
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(res.status).toBe(503);
    });

    it('serves any cached response when no TTL is given', async () => {
        const loaded = loadSw(offline);
        loaded.stores.set(CACHE, new Map([[URL_UNDER_TEST, stamped('ancient', 99999)]]));
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ancient');
    });

    it('returns 503 when offline with nothing cached', async () => {
        const loaded = loadSw(offline);
        const res = await loaded.sw.networkFirst(URL_UNDER_TEST, CACHE, 3600);
        expect(res.status).toBe(503);
    });
});
