/**
 * Route-level loading skeleton for /contract-results/[notificationId].
 *
 * Edge SSR page with a sequential DB waterfall (auth → db → notification →
 * mark-read → matched profiles) and no prior loading boundary, so navigation
 * held the previous screen with no feedback. This fallback paints instantly and
 * mirrors the max-w-2xl content layout.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (see project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

export default function ContractResultsLoading() {
    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl" aria-busy="true" aria-label="Cargando resultados del contrato">
            <div className="animate-pulse space-y-5">
                <Bar className="h-7 w-2/3" />
                <Bar className="h-4 w-1/2" />

                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5 space-y-3">
                    <Bar className="h-3 w-32 mb-2" />
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex justify-between">
                            <Bar className="h-3 w-1/4" />
                            <Bar className="h-3 w-2/5" />
                        </div>
                    ))}
                </div>

                {[0, 1].map((i) => (
                    <div key={i} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-4 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-stone-200 flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                            <Bar className="h-4 w-1/2" />
                            <Bar className="h-3 w-1/3" />
                        </div>
                        <Bar className="h-6 w-16 rounded-full" />
                    </div>
                ))}
            </div>
        </main>
    );
}
