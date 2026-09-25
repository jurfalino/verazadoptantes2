/**
 * Route-level loading skeleton for /settings.
 *
 * Same defect and same cure as the other protected-route skeletons — see
 * src/app/my-adoptions/loading.tsx for the full reasoning and for what this does
 * NOT cover (the stale-tab `location.replace()` path).
 *
 * The page already renders a pulse skeleton of its own for `status === 'loading'
 * || loading`; this is the same shape one step earlier in the sequence, for the
 * window before the shell has mounted at all. With this file every one of the
 * five PROTECTED_ROUTES has a boundary.
 *
 * Deliberately NOT a copy of the page's inline skeleton: that one uses
 * `dark:bg-stone-700`, and this app themes via [data-theme] remaps rather than
 * Tailwind's dark variant, so a `dark:` class renders raw (memory
 * project_theming / feedback_themed_colors_only). Themed base classes only here.
 *
 * Mirrors the real page's container: `flex-1 container mx-auto px-4 py-8
 * max-w-2xl`.
 */
export default function SettingsLoading() {
    return (
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl" aria-busy="true" aria-label="Cargando">
            <div className="animate-pulse space-y-6">
                {/* Page title */}
                <div className="h-8 bg-stone-200 rounded w-1/3" />
                {/* Setting cards */}
                <div className="h-32 bg-stone-200 rounded-xl" />
                <div className="h-32 bg-stone-200 rounded-xl" />
            </div>
        </main>
    );
}
