/**
 * Route-level loading skeleton for /adopter/[id].
 *
 * Why this file exists: the profile page is an edge SSR page with a deep data
 * waterfall (auth → parallel data batch → name/org resolution). On a dynamic
 * (cookie-reading) route with NO loading boundary, the App Router blocks on the
 * full RSC payload before swapping the view — so tapping an adopter card left
 * the *old* list on screen for the entire fetch with zero feedback ("is the app
 * broken?"). This Suspense fallback paints instantly on navigation and mirrors
 * the real profile layout (avatar, name, rating, contact, activity cards) so the
 * transition into real content is a fill-in, not a jump.
 *
 * Theme-safe: uses only themed base classes (bg-white → --surface-card,
 * bg-stone-* → --surface-*, bg-teal-50) remapped under [data-theme] in
 * globals.css. No `dark:` variants (this app themes via [data-theme], not
 * Tailwind dark mode — see memory project_theming).
 */
function Bar({ className = '' }: { className?: string }) {
    return <div className={`bg-stone-200 rounded ${className}`} />;
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
            {children}
        </div>
    );
}

export default function AdopterProfileLoading() {
    return (
        <main className="min-h-screen bg-teal-50 py-12 px-4" aria-busy="true" aria-label="Cargando perfil">
            <div className="max-w-3xl mx-auto space-y-5 animate-pulse">
                {/* Header card: avatar + name + rating + visibility */}
                <Card>
                    <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-full bg-stone-200 flex-shrink-0" />
                        <div className="min-w-0 flex-1 space-y-3">
                            <Bar className="h-6 w-1/2" />
                            <div className="flex items-center gap-2">
                                <Bar className="h-5 w-20 rounded-full" />
                                <Bar className="h-5 w-16 rounded-full" />
                            </div>
                            <Bar className="h-4 w-2/3" />
                        </div>
                    </div>
                </Card>

                {/* Alert row placeholder */}
                <Bar className="h-12 w-full rounded-xl" />

                {/* Contact card */}
                <Card>
                    <Bar className="h-3 w-24 mb-4" />
                    <div className="space-y-3">
                        <div className="flex justify-between"><Bar className="h-3 w-1/4" /><Bar className="h-3 w-1/3" /></div>
                        <div className="flex justify-between"><Bar className="h-3 w-1/4" /><Bar className="h-3 w-2/5" /></div>
                        <div className="flex justify-between"><Bar className="h-3 w-1/4" /><Bar className="h-3 w-1/4" /></div>
                    </div>
                </Card>

                {/* Activity card */}
                <Card>
                    <Bar className="h-3 w-24 mb-4" />
                    <div className="space-y-4">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="flex gap-3">
                                <div className="w-8 h-8 rounded-lg bg-stone-200 flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Bar className="h-3.5 w-1/2" />
                                    <Bar className="h-3 w-1/3" />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </main>
    );
}
