/**
 * Route-level loading skeleton for /my-animals — painted before the page's code
 * arrives. Same defect and same cure as the /my-adoptions and /my-adopters
 * skeletons; see src/app/my-adoptions/loading.tsx for what this does NOT cover
 * (a tab older than the running deployment navigates via `location.replace()`,
 * where React is not running and no Suspense fallback can paint).
 *
 * It must look like the page's own loading state, which follows it: same
 * container (`py-12 px-4`, `max-w-6xl`), header row (back arrow, title, action
 * buttons), the form-vs-contract hint, the tab bar, the search row and the card
 * grid (the last two shared with the page). Before 2026-11-11 it had no hint,
 * tabs or search, so the page grew under the reader as it arrived.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (this app themes via
 * [data-theme] — see memory project_theming).
 */
import { AnimalGridSkeleton, AnimalSearchSkeleton, SkeletonBar } from '@/components/skeletons/ListSkeletons';

export default function MyAnimalsLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                <div className="animate-pulse" aria-hidden="true">
                    {/* Header: back arrow + title, then the action buttons */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                        <div className="flex items-center gap-4">
                            <div className="w-6 h-6 rounded bg-stone-200 flex-shrink-0" />
                            <SkeletonBar className="h-9 w-56 max-w-full" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <SkeletonBar className="h-10 w-32 rounded-xl" />
                            <SkeletonBar className="h-11 w-40 rounded-xl" />
                        </div>
                    </div>

                    {/* Hint: form vs contract (two lines of text-sm) */}
                    <div className="mb-4 rounded-xl px-4 py-3 max-w-2xl border border-stone-200 bg-stone-100 space-y-2">
                        <SkeletonBar className="h-3.5 w-full" />
                        <SkeletonBar className="h-3.5 w-2/3" />
                    </div>

                    {/* Tab bar */}
                    <div className="bg-white p-1.5 rounded-xl border border-stone-200 inline-flex flex-wrap gap-1 mb-4">
                        <SkeletonBar className="h-7 w-28 rounded-lg" />
                        <SkeletonBar className="h-7 w-32 rounded-lg" />
                        <SkeletonBar className="h-7 w-20 rounded-lg" />
                    </div>
                </div>

                <AnimalSearchSkeleton />
                <AnimalGridSkeleton />
            </div>
        </div>
    );
}
