/**
 * Route-level loading skeleton for /my-animals.
 *
 * Same defect and same cure as the /my-adoptions and /my-adopters skeletons —
 * see src/app/my-adoptions/loading.tsx for the full reasoning, including what
 * this does NOT cover (a tab older than the running deployment navigates via
 * `location.replace()`, where React is not running and no Suspense fallback can
 * paint).
 *
 * With this file, four of the five PROTECTED_ROUTES are covered; only /settings
 * remains, and it lands in the same change.
 *
 * Mirrors the real page's container (`min-h-screen bg-stone-50 py-12 px-4`,
 * `max-w-6xl`), its header row (back arrow, title, action chips) and its
 * 1/2/3-column card grid.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (this app themes via
 * [data-theme] — see memory project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function MyAnimalsLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4" aria-busy="true" aria-label="Cargando">
            <div className="max-w-6xl mx-auto animate-pulse">
                {/* Header: back arrow + title, then the action chips */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-6 h-6 rounded bg-stone-200 flex-shrink-0" />
                        <Bar className="h-8 w-64 max-w-full" />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Bar className="h-9 w-28 rounded-xl" />
                        <Bar className="h-9 w-32 rounded-xl" />
                    </div>
                </div>

                {/* Animal cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[0, 1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                            <div className="h-40 bg-stone-200" />
                            <div className="p-4 space-y-3">
                                <Bar className="h-4 w-1/2" />
                                <Bar className="h-3 w-1/3" />
                                <div className="flex gap-2 pt-1">
                                    <Bar className="h-6 w-16 rounded-full" />
                                    <Bar className="h-6 w-20 rounded-full" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
