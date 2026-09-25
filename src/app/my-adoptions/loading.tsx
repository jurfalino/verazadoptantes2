/**
 * Route-level loading skeleton for /my-adoptions.
 *
 * Why this file exists: reported 2026-09-24 — "more than 10 seconds passed
 * without any new page or loading indicator appearing". The page is a client
 * component that renders its own `common.loading` text, but that text cannot
 * appear until the route's RSC payload AND its JS chunk have arrived and the
 * shell has mounted. Until then the App Router holds the PREVIOUS page on
 * screen with no feedback whatsoever, because there was no Suspense boundary
 * here. On a protected route the payload also waits on middleware's
 * `import('@/auth')` + `auth()`, which on a cold Cloudflare worker measured
 * 1.4s before the page's own data fetch even starts.
 *
 * This is the same defect the /adopter/[id] skeleton was added for, and the
 * same cure. Four of the five PROTECTED_ROUTES had no boundary; this is one.
 *
 * Note what it does NOT cover: when a tab is older than the running deployment
 * the middleware answers the navigation with 409 and Next falls back to
 * `location.replace()` — a browser document navigation, during which React is
 * not running and no Suspense fallback can paint. That path is the
 * StaleDeployWatcher notice's job, not this file's.
 *
 * Mirrors the real page's container (`min-h-screen bg-stone-50 py-12 px-4`,
 * `max-w-6xl`) so arriving content fills in rather than jumping.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (this app themes
 * via [data-theme] — see memory project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function MyAdoptionsLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4" aria-busy="true" aria-label="Cargando">
            <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
                {/* Title + "Register adoption" action */}
                <div className="flex items-center justify-between gap-4">
                    <Bar className="h-7 w-52" />
                    <Bar className="h-9 w-40 rounded-xl" />
                </div>

                {/* Record-type filter pills (All / Adoption / Request / …) */}
                <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3, 4].map(i => (
                        <Bar key={i} className="h-8 w-24 rounded-full" />
                    ))}
                </div>

                {/* Adoption cards */}
                <div className="space-y-4">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
                            <div className="flex gap-4">
                                <div className="w-16 h-16 rounded-xl bg-stone-200 flex-shrink-0" />
                                <div className="flex-1 min-w-0 space-y-3">
                                    <Bar className="h-4 w-1/3" />
                                    <Bar className="h-3 w-1/4" />
                                    <Bar className="h-3 w-1/2" />
                                </div>
                                <Bar className="h-6 w-16 rounded-full flex-shrink-0" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
