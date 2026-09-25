/**
 * Route-level loading skeleton for /my-adopters.
 *
 * Same defect and same cure as the /my-adoptions skeleton beside it — see that
 * file's header for the full reasoning and for what this does NOT cover (a tab
 * older than the running deployment navigates via `location.replace()`, where
 * React is not running and no Suspense fallback can paint).
 *
 * Mirrors the real page's container (`min-h-screen bg-stone-50 py-8 px-4`,
 * `max-w-6xl`) and its row shape: thumbnail, name, rating badge, activity
 * counts.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (see project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function MyAdoptersLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4" aria-busy="true" aria-label="Cargando">
            <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
                {/* Title + primary action */}
                <div className="flex items-center justify-between gap-4">
                    <Bar className="h-7 w-48" />
                    <Bar className="h-9 w-36 rounded-xl" />
                </div>

                {/* Adopter rows */}
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                    <div className="border-b border-stone-200 px-4 py-3">
                        <Bar className="h-3 w-40" />
                    </div>
                    <div className="divide-y divide-stone-100">
                        {[0, 1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex items-center gap-3 px-4 py-4">
                                <div className="w-10 h-10 rounded-full bg-stone-200 flex-shrink-0" />
                                <div className="flex-1 min-w-0 space-y-2">
                                    <Bar className="h-3.5 w-1/3" />
                                    <Bar className="h-3 w-1/5" />
                                </div>
                                <Bar className="h-6 w-14 rounded-full flex-shrink-0" />
                                <Bar className="h-3 w-10 flex-shrink-0 hidden sm:block" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
