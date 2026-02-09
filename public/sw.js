// BuenAdoptante Service Worker
// Strategy: Cache-first for static assets, Network-first for pages/API with offline fallback

const CACHE_VERSION = 'buenaadoptante-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    '/offline.html',
];

// Install: pre-cache critical assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
    // Activate immediately
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
                    .map((key) => caches.delete(key))
            );
        })
    );
    // Take control of all clients immediately
    self.clients.claim();
});

// Fetch: route requests to appropriate strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests (POST share_target handled by the app)
    if (request.method !== 'GET') return;

    // Skip auth-related requests (never cache)
    if (url.pathname.startsWith('/api/auth')) return;

    // Skip admin API requests
    if (url.pathname.startsWith('/api/admin')) return;

    // Static assets: cache-first
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // API requests: network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE, 60 * 60)); // 1 hour TTL
        return;
    }

    // Page navigations: network-first with cache fallback
    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    // Everything else: network-first
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// --- Strategies ---

// Cache-first: check cache, fall back to network
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline', { status: 503 });
    }
}

// Network-first: try network, fall back to cache
async function networkFirst(request, cacheName, ttlSeconds) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// Network-first for navigations with offline.html fallback
async function networkFirstNavigation(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Try to serve cached version of the page
        const cached = await caches.match(request);
        if (cached) return cached;

        // Last resort: offline fallback
        const offline = await caches.match('/offline.html');
        return offline || new Response('Offline', { status: 503 });
    }
}

// --- Helpers ---

function isStaticAsset(url) {
    const staticPatterns = [
        '/_next/static/',
        '/icon-',
        '/apple-touch-icon',
        '/favicon',
        '.woff2',
        '.woff',
        '.ttf',
    ];
    return staticPatterns.some((pattern) => url.pathname.includes(pattern));
}
