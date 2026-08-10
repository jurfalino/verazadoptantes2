export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adoptions } from "@/db/schema";
import { desc, like, or, and, isNull, eq, sql, ne } from "drizzle-orm";
import Link from "next/link";
import AdminAdopterList from "@/components/AdminAdopterList";
import UserFilterSelect from "@/components/UserFilterSelect";
import SortSelect from "@/components/SortSelect";
import { enrichAdopters } from "@/app/actions/enrichAdopters";
import { getRatingColors, getRatingDescription } from "@/lib/ratingColors";
import { StarIcon } from "@/components/StarIcon";
import { getFeatureFlag } from "@/config/features";


export default async function AdminAdoptersPage({ searchParams }: { searchParams: Promise<{ q?: string; country?: string; rating?: string; created_by?: string; updated_by?: string; visibility?: string; sort?: string; user?: string }> }) {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const params = await searchParams;
    const { q, country: filterCountry, rating: filterRating, visibility: filterVisibility, sort: filterSort } = params;
    // v2.19.61: `?user=` was a single combined "Created / Updated by" filter
    // that resolved to `eq(addedBy, user)` (i.e., creator only). Split into
    // two independent facets. Legacy `?user=` aliases to `created_by` for
    // bookmark compatibility.
    const filterCreatedBy = params.created_by || params.user;
    const filterUpdatedBy = params.updated_by;
    const query = q || '';

    // ── Aggregation queries (global counts, unfiltered) ─────────────────
    // v2.19.61: each facet is one aggregated SQL query. NEVER fan out per
    // adopter (see v2.19.59 incident).
    const [countryRows, createdByRows, updatedByRows, visibilityRows] = await Promise.all([
        // Country distribution
        db.select({
            country: adopters.country,
            count: sql<number>`COUNT(*)`
        }).from(adopters)
            .where(isNull(adopters.deletedAt))
            .groupBy(adopters.country)
            .orderBy(sql`COUNT(*) DESC`),

        // Created by — distinct creators with adopter count.
        db.select({
            addedBy: adopters.addedBy,
            count: sql<number>`COUNT(*)`,
        })
            .from(adopters)
            .where(and(
                isNull(adopters.deletedAt),
                sql`${adopters.addedBy} IS NOT NULL`,
                ne(adopters.addedBy, 'anonymous')
            ))
            .groupBy(adopters.addedBy)
            .orderBy(sql`COUNT(*) DESC`),

        // Updated by — "most recent editor per adopter" where the editor is
        // NOT the creator (v2.19.64). A record whose latest editor is also
        // its creator is just "untouched by anyone else" — counting it under
        // the editor's chip makes the facet redundant with "Created by" for
        // that row. The useful signal is external contribution: "Maria
        // created it, Pedro updated it later." JOINs adopters to access
        // `added_by` for the per-row exclusion. Soft-deleted rows are
        // skipped (`a.deleted_at IS NULL`) to match every other facet.
        db.all(sql`
            SELECT h.changed_by AS updated_by, COUNT(*) AS n
            FROM (
                SELECT adopter_id, changed_by,
                       ROW_NUMBER() OVER (PARTITION BY adopter_id ORDER BY changed_at DESC) AS rn
                FROM adopter_history
            ) h
            JOIN adopters a ON a.id = h.adopter_id
            WHERE h.rn = 1
              AND h.changed_by IS NOT NULL
              AND h.changed_by != 'Unknown'
              AND h.changed_by != a.added_by
              AND a.deleted_at IS NULL
            GROUP BY h.changed_by
            ORDER BY n DESC
        `) as Promise<{ updated_by: string; n: number }[]>,

        // Visibility — `is_public` (0/1) counts.
        db.select({
            isPublic: adopters.isPublic,
            count: sql<number>`COUNT(*)`,
        })
            .from(adopters)
            .where(isNull(adopters.deletedAt))
            .groupBy(adopters.isPublic),
    ]);

    // Build country summary: { code: count }
    const countrySummary: { code: string | null; count: number }[] = countryRows.map((r: { country: string | null; count: number }) => ({
        code: r.country,
        count: r.count,
    }));

    // Created-by + Updated-by lists with counts (sorted descending by count).
    const createdByList = (createdByRows as { addedBy: string | null; count: number }[])
        .filter((r) => r.addedBy)
        .map((r) => ({ email: r.addedBy as string, count: r.count }));
    const updatedByList = (updatedByRows as { updated_by: string; n: number }[])
        .map((r) => ({ email: r.updated_by, count: r.n }));

    // Visibility: lookup public vs private counts. Default 0 if a bucket is empty.
    const visibilityCounts = { public: 0, private: 0 };
    for (const r of visibilityRows as { isPublic: number; count: number }[]) {
        if (r.isPublic === 1) visibilityCounts.public = r.count;
        else visibilityCounts.private = r.count;
    }

    // ── Main list query (with filters) ──────────────────────────────────
    const conditions = [isNull(adopters.deletedAt)];

    if (query) {
        conditions.push(or(
            like(adopters.name, `%${query}%`),
            like(adopters.id, `%${query}%`)
        )!);
    }
    if (filterCountry) {
        if (filterCountry === '_none') {
            conditions.push(isNull(adopters.country));
        } else {
            conditions.push(eq(adopters.country, filterCountry));
        }
    }
    if (filterCreatedBy) {
        conditions.push(eq(adopters.addedBy, filterCreatedBy));
    }
    if (filterUpdatedBy) {
        // Most-recent-editor filter: pick adopters whose latest history entry
        // was authored by `filterUpdatedBy`. Window-function subquery in raw
        // SQL — D1's inArray helper is broken so we can't pre-fetch IDs and
        // pass an array; the subquery runs in-engine. Cheap (one indexed
        // pass on adopter_history) and self-contained.
        conditions.push(sql`${adopters.id} IN (
            SELECT adopter_id FROM (
                SELECT adopter_id, changed_by,
                       ROW_NUMBER() OVER (PARTITION BY adopter_id ORDER BY changed_at DESC) AS rn
                FROM adopter_history
            )
            WHERE rn = 1 AND changed_by = ${filterUpdatedBy}
        )`);
        // v2.19.64: only show rows where the creator is a different person
        // — keeps the filtered list in sync with the facet count
        // (`changed_by != added_by` in the facet query).
        conditions.push(ne(adopters.addedBy, filterUpdatedBy));
    }
    if (filterVisibility === 'public') {
        conditions.push(eq(adopters.isPublic, 1));
    } else if (filterVisibility === 'private') {
        conditions.push(eq(adopters.isPublic, 0));
    }

    // Sort selector (v2.19.61). Default matches pre-existing behaviour.
    const sortOptionsMap = {
        updated_desc: desc(adopters.updatedAt),
        updated_asc: adopters.updatedAt,
        created_desc: desc(adopters.createdAt),
        created_asc: adopters.createdAt,
        name_asc: adopters.name,
        name_desc: desc(adopters.name),
    } as const;
    const sortKey = (filterSort && filterSort in sortOptionsMap)
        ? filterSort as keyof typeof sortOptionsMap
        : 'updated_desc';
    const orderByClause = sortOptionsMap[sortKey];

    const list = await db.select()
        .from(adopters)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(200);

    // Enrich adopters with ratings, stats, flags, and thumbnails
    const adopterIds = list.map((a: typeof adopters.$inferSelect) => a.id);
    const enrichmentMap = await enrichAdopters(db, adopterIds);

    // ── Rating summary (single aggregated query) ──
    // v2.19.59: previously fan-out enriched every non-deleted adopter just
    // to count rating-bucket sizes (5 queries × N adopters). At ~66 prod
    // adopters that's ~330 D1 subrequests on every render — past the
    // Cloudflare Worker resource cap. router.refresh() after a toggle flip
    // produced Error 1102. Replaced with one aggregated SQL: per-adopter
    // avg(rating) via a left-join + groupBy. Bucketing is identical math to
    // the old in-process loop, one D1 round trip instead of 330.
    const ratingCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const noRatingCount = { count: 0 };

    const perAdopterAvg = await db.select({
        id: adopters.id,
        avgRating: sql<number | null>`AVG(${adoptions.rating})`,
    })
        .from(adopters)
        .leftJoin(adoptions, and(eq(adoptions.adopterId, adopters.id), sql`${adoptions.rating} IS NOT NULL`))
        .where(isNull(adopters.deletedAt))
        .groupBy(adopters.id);

    for (const row of perAdopterAvg as { avgRating: number | null }[]) {
        if (row.avgRating === null) {
            noRatingCount.count++;
        } else {
            const clamped = Math.max(1, Math.min(5, Math.round(row.avgRating)));
            ratingCounts[clamped] = (ratingCounts[clamped] || 0) + 1;
        }
    }

    // ── Post-enrichment rating filter ───────────────────────────────────
    let filteredList = list;
    if (filterRating) {
        const ratingNum = parseInt(filterRating, 10);
        if (ratingNum >= 1 && ratingNum <= 5) {
            filteredList = list.filter((adopter: typeof adopters.$inferSelect) => {
                const enrichment = enrichmentMap.get(adopter.id);
                if (!enrichment || enrichment.avgRating === null) return false;
                return Math.round(enrichment.avgRating) === ratingNum;
            });
        }
    }

    // ── Post-fetch sort (rating_*) ──────────────────────────────────────
    // Rating isn't a column, so SQL ORDER BY can't sort it. SQL fetched the
    // list in `updated_desc` order; if the user picked a rating sort we
    // re-sort the already-fetched list in-process. Sorts the displayed
    // ~200-row window only — fine for current prod scale.
    if (filterSort === 'rating_desc' || filterSort === 'rating_asc') {
        const dir = filterSort === 'rating_desc' ? -1 : 1;
        filteredList = [...filteredList].sort((a: typeof adopters.$inferSelect, b: typeof adopters.$inferSelect) => {
            const ra = enrichmentMap.get(a.id)?.avgRating ?? -1;
            const rb = enrichmentMap.get(b.id)?.avgRating ?? -1;
            return (ra - rb) * dir;
        });
    }

    // ── Helper to build filter URL ──────────────────────────────────────
    function buildFilterUrl(overrides: Record<string, string | undefined>) {
        const merged: Record<string, string | undefined> = {
            q: q || undefined,
            country: filterCountry,
            rating: filterRating,
            created_by: filterCreatedBy,
            updated_by: filterUpdatedBy,
            visibility: filterVisibility,
            sort: filterSort,
            ...overrides,
        };
        const qs = Object.entries(merged)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
            .join('&');
        return `/admin/adopters${qs ? `?${qs}` : ''}`;
    }

    // Country flag emoji helper
    function countryFlag(code: string): string {
        if (code.length !== 2) return '🌍';
        const upper = code.toUpperCase();
        return String.fromCodePoint(
            ...upper.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h2 className="text-2xl font-semibold text-stone-900">Manage Adopters</h2>
                <form className="flex gap-2">
                    {/* Preserve active filters in hidden inputs */}
                    {filterCountry && <input type="hidden" name="country" value={filterCountry} />}
                    {filterRating && <input type="hidden" name="rating" value={filterRating} />}
                    {filterCreatedBy && <input type="hidden" name="created_by" value={filterCreatedBy} />}
                    {filterUpdatedBy && <input type="hidden" name="updated_by" value={filterUpdatedBy} />}
                    {filterVisibility && <input type="hidden" name="visibility" value={filterVisibility} />}
                    {filterSort && <input type="hidden" name="sort" value={filterSort} />}
                    <input
                        name="q"
                        defaultValue={query}
                        placeholder="Search name or ID..."
                        className="px-4 py-2 rounded-lg border border-stone-200 text-sm w-full sm:w-64"
                    />
                    <button type="submit" className="px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-semibold flex-shrink-0">Search</button>
                </form>
            </div>

            {/* ── Filter Summary Bars ────────────────────────────────── */}
            <div className="space-y-3">
                {/* Country Summary */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">By Country</h3>
                        {filterCountry && (
                            <Link href={buildFilterUrl({ country: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {countrySummary.map((c) => {
                            const code = c.code || '_none';
                            const isActive = filterCountry === code;
                            return (
                                <Link
                                    key={code}
                                    href={buildFilterUrl({ country: isActive ? undefined : code })}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isActive
                                        ? 'bg-teal-600 text-white shadow-sm'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                >
                                    <span>{c.code ? countryFlag(c.code) : '❓'}</span>
                                    <span>{c.code?.toUpperCase() || 'Unknown'}</span>
                                    <span className={`font-semibold ${isActive ? 'text-teal-100' : 'text-stone-500'}`}>
                                        {c.count}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Rating Summary */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">By Rating</h3>
                        {filterRating && (
                            <Link href={buildFilterUrl({ rating: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[5, 4, 3, 2, 1].map((r) => {
                            const colors = getRatingColors(r);
                            const label = getRatingDescription(r);
                            const count = ratingCounts[r] || 0;
                            const isActive = filterRating === String(r);
                            return (
                                <Link
                                    key={r}
                                    href={buildFilterUrl({ rating: isActive ? undefined : String(r) })}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${isActive
                                        ? 'ring-2 ring-offset-1 ring-teal-500 shadow-sm'
                                        : ''
                                        } ${colors.bg} ${colors.text} ${colors.border}`}
                                >
                                    <StarIcon className="w-3.5 h-3.5" />
                                    <span className="capitalize">{label}</span>
                                    <span className="font-semibold opacity-70">{count}</span>
                                </Link>
                            );
                        })}
                        {noRatingCount.count > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-stone-50 text-stone-500 border border-stone-200">
                                No rating
                                <span className="font-semibold opacity-70">{noRatingCount.count}</span>
                            </span>
                        )}
                    </div>
                </div>

                {/* Visibility — public / private chip pair (v2.19.61). */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">By Visibility</h3>
                        {filterVisibility && (
                            <Link href={buildFilterUrl({ visibility: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {([
                            { key: 'public', label: 'Público', icon: '🌐', count: visibilityCounts.public },
                            { key: 'private', label: 'Privado', icon: '🔒', count: visibilityCounts.private },
                        ] as const).map((v) => {
                            const isActive = filterVisibility === v.key;
                            return (
                                <Link
                                    key={v.key}
                                    href={buildFilterUrl({ visibility: isActive ? undefined : v.key })}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isActive
                                        ? 'bg-teal-600 text-white shadow-sm'
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                >
                                    <span>{v.icon}</span>
                                    <span>{v.label}</span>
                                    <span className={`font-semibold ${isActive ? 'text-teal-100' : 'text-stone-500'}`}>
                                        {v.count}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Created by / Updated by / Sort by — three dropdowns in one card (v2.19.61). */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap sm:w-28">Created by</h3>
                        <UserFilterSelect
                            kind="created_by"
                            users={createdByList}
                            currentUser={filterCreatedBy}
                            preserved={{ q: query || undefined, country: filterCountry, rating: filterRating, created_by: filterCreatedBy, updated_by: filterUpdatedBy, visibility: filterVisibility, sort: filterSort }}
                            allLabel="All creators"
                        />
                        {filterCreatedBy && (
                            <Link href={buildFilterUrl({ created_by: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium whitespace-nowrap">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap sm:w-28">Updated by</h3>
                        <UserFilterSelect
                            kind="updated_by"
                            users={updatedByList}
                            currentUser={filterUpdatedBy}
                            preserved={{ q: query || undefined, country: filterCountry, rating: filterRating, created_by: filterCreatedBy, updated_by: filterUpdatedBy, visibility: filterVisibility, sort: filterSort }}
                            allLabel="All editors"
                        />
                        {filterUpdatedBy && (
                            <Link href={buildFilterUrl({ updated_by: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium whitespace-nowrap">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap sm:w-28">Sort by</h3>
                        <SortSelect
                            currentSort={filterSort}
                            preserved={{ q: query || undefined, country: filterCountry, rating: filterRating, created_by: filterCreatedBy, updated_by: filterUpdatedBy, visibility: filterVisibility, sort: filterSort }}
                        />
                    </div>
                </div>
            </div>

            <div className="text-sm text-stone-500">
                {filteredList.length} adopter{filteredList.length !== 1 ? 's' : ''}
                {(filterCountry || filterRating || filterCreatedBy || filterUpdatedBy || filterVisibility || filterSort) && (
                    <span> (filtered) · <Link href={buildFilterUrl({ country: undefined, rating: undefined, created_by: undefined, updated_by: undefined, visibility: undefined, sort: undefined, q: q || undefined })} className="text-teal-700 hover:underline">Clear all filters</Link></span>
                )}
            </div>

            <AdminAdopterList
                publicProfilesFlag={await getFeatureFlag('ENABLE_PUBLIC_PROFILES')}
                adopters={filteredList.map((adopter: typeof adopters.$inferSelect) => ({
                    adopter: {
                        id: adopter.id,
                        name: adopter.name,
                        contactInfo: adopter.contactInfo,
                        country: adopter.country,
                        addedBy: adopter.addedBy,
                        isPublic: adopter.isPublic === 1,
                        createdAt: adopter.createdAt ? adopter.createdAt.toISOString() : null,
                        updatedAt: adopter.updatedAt ? adopter.updatedAt.toISOString() : null,
                    },
                    enrichment: enrichmentMap.get(adopter.id) ?? null,
                }))}
                countries={countrySummary}
            />
        </div>
    );
}

