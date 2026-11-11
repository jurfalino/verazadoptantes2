/**
 * Route-level loading skeleton for /my-adopters — painted before the page's
 * code arrives. Same defect and same cure as the /my-adoptions skeleton beside
 * it; see that file's header for what this does NOT cover (a tab older than the
 * running deployment navigates via `location.replace()`, where React is not
 * running and no Suspense fallback can paint).
 *
 * It must look exactly like the page's own loading state, which follows it:
 * same container (`py-8 px-4`, `max-w-6xl`), same header row (back button,
 * title, count, «Agregar adoptante»), the duplicates section's placeholder,
 * and the list skeleton the page itself shows (shared components). The page
 * then swaps in its real header text and, when the data lands, the list.
 *
 * Theme-safe: themed base classes only, no `dark:` variants (see project_theming).
 */
import { PendingDedupPlaceholder } from '@/components/PendingDedup';
import { AdopterListSkeleton, SkeletonBar } from '@/components/skeletons/ListSkeletons';

export default function MyAdoptersLoading() {
    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header: back button (36px), title, count; «Agregar adoptante» */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6 animate-pulse" aria-hidden="true">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-stone-200" />
                        <SkeletonBar className="h-7 w-44" />
                        <div className="h-5 w-8 rounded-full bg-stone-100" />
                    </div>
                    <SkeletonBar className="h-9 w-40 rounded-lg" />
                </div>
                <PendingDedupPlaceholder />
                <AdopterListSkeleton />
            </div>
        </div>
    );
}
