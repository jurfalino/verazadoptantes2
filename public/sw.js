// BuenAdoptante Service Worker
// Strategy: Cache-first for static assets, Network-first for pages/API with offline fallback

const CACHE_VERSION = 'buenaadoptante-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const SHARE_CACHE = 'share-target-media';

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
                    .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== SHARE_CACHE)
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

    // ── Share Target: intercept POST, cache image, redirect ──
    if (request.method === 'POST' && url.pathname === '/api/share-target') {
        event.respondWith(handleShareTarget(request));
        return;
    }

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip cross-origin R2/storage requests — let the browser handle them natively
    // (SW fetch violates CSP connect-src when intercepting cross-origin requests)
    if (url.hostname.includes('r2.dev') || url.hostname.includes('cloudflarestorage.com')) return;

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

// --- Share Target Handler ---

async function handleShareTarget(request) {
    try {
        const formData = await request.formData();

        // Extract text fields
        let sharedUrl = formData.get('url') || '';
        let sharedText = formData.get('text') || '';
        const sharedTitle = formData.get('title') || '';

        // Extract URL from text if not in url field
        if (!sharedUrl && sharedText) {
            const urlMatch = sharedText.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                sharedUrl = urlMatch[0];
                sharedText = sharedText.replace(urlMatch[0], '').trim();
            }
        }

        // Extract shared image files
        const imageFiles = formData.getAll('images');
        let hasImages = false;

        if (imageFiles && imageFiles.length > 0) {
            const cache = await caches.open(SHARE_CACHE);
            // Clear any previous shared images
            const existingKeys = await cache.keys();
            for (const key of existingKeys) {
                await cache.delete(key);
            }

            // Cache each shared image with a sequential key
            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                if (file && file.size > 0) {
                    const response = new Response(file, {
                        headers: {
                            'Content-Type': file.type || 'image/jpeg',
                            'X-Filename': file.name || `shared-image-${i}`,
                        },
                    });
                    await cache.put(`/share-target-image-${i}`, response);
                    hasImages = true;
                }
            }
        }

        // Build redirect URL
        const params = new URLSearchParams();
        params.set('shared', 'true');
        if (sharedUrl) params.set('shared_url', sharedUrl);
        if (sharedText) params.set('shared_text', sharedText);
        if (sharedTitle) params.set('shared_title', sharedTitle);
        if (hasImages) params.set('shared_images', 'true');

        // Redirect to import page
        return Response.redirect(`/import?${params.toString()}`, 303);
    } catch (error) {
        console.error('[SW] Share target handling failed:', error);
        return Response.redirect('/import?shared=true', 303);
    }
}

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
