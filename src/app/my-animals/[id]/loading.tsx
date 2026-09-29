/**
 * Route-level loading skeleton for /my-animals/[id].
 *
 * Without this file the segment inherits `src/app/my-animals/loading.tsx`, so
 * opening ONE animal flashed the LIST's 1/2/3-column card grid before resolving
 * into a single profile — the skeleton promised a layout the page never had,
 * which reads as the wrong page loading rather than this one.
 *
 * Mirrors the real page: the `min-h-screen bg-stone-50 py-8 px-4` shell and
 * `max-w-3xl` column of src/app/my-animals/[id]/page.tsx, then the pieces of
 * AnimalProfile in order — back link, the header card's full-bleed 2:1 hero with
 * its caption block, the action row, and the timeline's rail with its beacons.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (this app themes via
 * [data-theme] — see memory project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function AnimalProfileLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4" aria-busy="true" aria-label="Cargando">
            <div className="max-w-3xl mx-auto animate-pulse">
                {/* back link */}
                <Bar className="h-4 w-28 mb-3" />

                {/* header card: 2:1 hero, name + descriptor on the scrim */}
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="relative bg-stone-200" style={{ aspectRatio: '2 / 1' }}>
                        {/* caption block sits bottom-left on the scrim */}
                        <div className="absolute bottom-4 left-4 right-4 space-y-2">
                            <div className="h-7 w-44 rounded bg-stone-300" />
                            <div className="h-4 w-60 rounded bg-stone-300" />
                        </div>
                    </div>
                    <div className="p-4">
                        {/* status chip */}
                        <Bar className="h-6 w-40 rounded-full" />
                        {/* attribution line */}
                        <Bar className="h-3 w-52 mt-3" />
                        {/* action row: one primary, one secondary, share, then ✎ and 🗑 */}
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            <Bar className="h-9 w-36 rounded-xl" />
                            <Bar className="h-9 w-32 rounded-xl" />
                            <Bar className="h-9 w-28 rounded-xl" />
                            <Bar className="h-10 w-10 rounded-xl" />
                            <Bar className="h-10 w-10 rounded-xl" />
                        </div>
                    </div>
                </div>

                {/* timeline: heading, then the rail with beacons and cards */}
                <Bar className="h-5 w-36 mt-8 mb-4" />
                <div className="relative pl-6 md:pl-8">
                    <div className="absolute left-[7px] md:left-[15px] top-2 bottom-2 w-0.5 bg-stone-200" aria-hidden />
                    <div className="space-y-3">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="relative">
                                <div className="absolute -left-6 top-3.5 w-4 h-4 rounded-full bg-stone-300" />
                                <div className="bg-white rounded-xl border border-stone-200 border-l-[3px] border-l-stone-200 px-4 py-3">
                                    <div className="flex items-baseline gap-2">
                                        <Bar className="h-4 flex-1 max-w-[16rem]" />
                                        <Bar className="h-3 w-16 ml-auto" />
                                    </div>
                                    <Bar className="h-3 w-3/4 mt-2" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
