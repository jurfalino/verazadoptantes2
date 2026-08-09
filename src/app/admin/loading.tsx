/**
 * Route-level loading skeleton for /admin/* (segment-level: one file covers
 * every admin sub-page via App Router nesting).
 *
 * Most admin pages are SSR pages that query D1 before rendering; without a
 * loading boundary, navigating between admin screens held the previous screen
 * with no feedback. A generic header + table skeleton is a sensible universal
 * fallback for the admin list/dashboard pages.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (see project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function AdminLoading() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" aria-busy="true" aria-label="Cargando">
            <div className="animate-pulse space-y-6">
                {/* Page header */}
                <div className="space-y-3">
                    <Bar className="h-7 w-56" />
                    <Bar className="h-4 w-80 max-w-full" />
                </div>

                {/* Table / list card */}
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                    <div className="border-b border-stone-200 px-4 py-3">
                        <Bar className="h-3 w-40" />
                    </div>
                    <div className="divide-y divide-stone-100">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="flex items-center gap-3 px-4 py-4">
                                <div className="w-9 h-9 rounded-full bg-stone-200 flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Bar className="h-3.5 w-1/3" />
                                    <Bar className="h-3 w-1/4" />
                                </div>
                                <Bar className="h-6 w-20 rounded-full" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
