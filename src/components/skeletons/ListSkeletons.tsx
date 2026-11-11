/**
 * Loading skeletons for the two list pages, shared by each route's
 * `loading.tsx` (painted before the page's code arrives) and by the page
 * itself while its data loads. One shape for both moments, so the screen
 * never swaps from a skeleton to a "Cargando…" line and back to content.
 *
 * Each piece mirrors the real markup it stands in for (sizes copied from
 * AdopterListToolbar, the /my-adopters table and cards, and the /my-animals
 * cards), so nothing jumps when the content replaces it.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (this app themes
 * via [data-theme] — see project_theming).
 */

export function SkeletonBar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

/** /my-adopters list area: toolbar, desktop table, phone cards. */
export function AdopterListSkeleton() {
    return (
        <div aria-busy="true" aria-label="Cargando" data-testid="adopter-list-skeleton" className="animate-pulse">
            {/* AdopterListToolbar: search (44px), phone sort select, «Filtros» chip */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[12rem] md:flex-none md:w-64 h-11 rounded-xl border border-stone-200 bg-white" />
                <div className="md:hidden flex-1 min-w-[10rem] h-11 rounded-xl border border-stone-200 bg-white" />
                <div className="h-11 w-28 rounded-xl border border-stone-200 bg-white" />
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-2xl overflow-hidden shadow-sm border border-stone-200">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-stone-50 border-b border-stone-200">
                    <div className="col-span-4 h-8 flex items-center"><SkeletonBar className="h-3 w-24" /></div>
                    <div className="col-span-2 h-8 flex items-center justify-center"><SkeletonBar className="h-3 w-20" /></div>
                    <div className="col-span-2 h-8 flex items-center"><SkeletonBar className="h-3 w-16" /></div>
                    <div className="col-span-4 h-8 flex items-center"><SkeletonBar className="h-3 w-24" /></div>
                </div>
                <div className="divide-y divide-stone-100">
                    {[0, 1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="grid grid-cols-12 gap-2 px-4 py-3 items-center">
                            <div className="col-span-4 flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full bg-stone-200 flex-shrink-0" />
                                <div className="flex-1 min-w-0 space-y-2">
                                    <SkeletonBar className="h-3.5 w-2/3" />
                                    <SkeletonBar className="h-3 w-1/3" />
                                </div>
                            </div>
                            <div className="col-span-2 flex justify-center"><SkeletonBar className="h-6 w-16 rounded-full" /></div>
                            <div className="col-span-2"><SkeletonBar className="h-3 w-14" /></div>
                            <div className="col-span-4 space-y-2">
                                <SkeletonBar className="h-3 w-3/4" />
                                <SkeletonBar className="h-3 w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Phone cards */}
            <div className="md:hidden space-y-3">
                {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-stone-200 flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-2">
                                <SkeletonBar className="h-3.5 w-1/2" />
                                <SkeletonBar className="h-3 w-1/3" />
                            </div>
                            <SkeletonBar className="h-6 w-14 rounded-full flex-shrink-0" />
                        </div>
                        <SkeletonBar className="h-3 w-2/3 mt-3" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** /my-animals search row, shown on the first load (before we know whether there are animals). */
export function AnimalSearchSkeleton() {
    return (
        <div aria-hidden="true" className="flex flex-col sm:flex-row gap-3 mb-6 animate-pulse">
            {/* min-h: in the phone's column layout flex-1 would collapse an empty box to 0 */}
            <div className="flex-1 min-h-[40px] h-10 rounded-xl border border-stone-200 bg-white" />
            <div className="flex gap-1.5">
                <SkeletonBar className="h-8 w-16 rounded-lg" />
                <SkeletonBar className="h-8 w-20 rounded-lg" />
            </div>
        </div>
    );
}

/** /my-animals card grid: same columns, card radius and 16:9 photo area as the real cards. */
export function AnimalGridSkeleton() {
    return (
        <div aria-busy="true" aria-label="Cargando" data-testid="animal-grid-skeleton"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className="bg-white rounded-xl shadow-sm border border-stone-200">
                    <div className="aspect-video bg-stone-200 rounded-t-xl" />
                    <div className="p-4 space-y-3">
                        <SkeletonBar className="h-4 w-1/2" />
                        <SkeletonBar className="h-3 w-1/3" />
                        <div className="flex gap-2 pt-1">
                            <SkeletonBar className="h-6 w-16 rounded-full" />
                            <SkeletonBar className="h-6 w-20 rounded-full" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
