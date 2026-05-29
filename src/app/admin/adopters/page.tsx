export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adopterHistory } from "@/db/schema";
import { desc, like, or, and, isNull, eq, sql, ne } from "drizzle-orm";
import Link from "next/link";
import AdminAdopterList from "@/components/AdminAdopterList";
import UserFilterSelect from "@/components/UserFilterSelect";
import { enrichAdopters } from "@/app/actions/enrichAdopters";
import { getRatingColors, getRatingDescription } from "@/lib/ratingColors";
import { getFeatureFlag } from "@/config/features";


export default async function AdminAdoptersPage({ searchParams }: { searchParams: Promise<{ q?: string; country?: string; rating?: string; user?: string }> }) {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const { q, country: filterCountry, rating: filterRating, user: filterUser } = await searchParams;
    const query = q || '';

    // ── Aggregation queries (global counts, unfiltered) ─────────────────
    const [countryRows, userRows, historyUserRows] = await Promise.all([
        // Country distribution
        db.select({
            country: adopters.country,
            count: sql<number>`COUNT(*)`
        }).from(adopters)
            .where(isNull(adopters.deletedAt))
            .groupBy(adopters.country)
            .orderBy(sql`COUNT(*) DESC`),

        // Distinct creators
        db.select({ addedBy: adopters.addedBy })
            .from(adopters)
            .where(and(
                isNull(adopters.deletedAt),
                sql`${adopters.addedBy} IS NOT NULL`,
                ne(adopters.addedBy, 'anonymous')
            ))
            .groupBy(adopters.addedBy),

        // Distinct editors from history
        db.select({ changedBy: adopterHistory.changedBy })
            .from(adopterHistory)
            .where(and(
                sql`${adopterHistory.changedBy} IS NOT NULL`,
                ne(adopterHistory.changedBy, 'Unknown')
            ))
            .groupBy(adopterHistory.changedBy),
    ]);

    // Build country summary: { code: count }
    const countrySummary: { code: string | null; count: number }[] = countryRows.map((r: { country: string | null; count: number }) => ({
        code: r.country,
        count: r.count,
    }));

    // Build distinct users list (union of creators and editors)
    const userSet = new Set<string>();
    for (const r of userRows as { addedBy: string | null }[]) {
        if (r.addedBy) userSet.add(r.addedBy);
    }
    for (const r of historyUserRows as { changedBy: string | null }[]) {
        if (r.changedBy) userSet.add(r.changedBy);
    }
    const distinctUsers = Array.from(userSet).sort();

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
    if (filterUser) {
        conditions.push(eq(adopters.addedBy, filterUser));
    }

    const list = await db.select()
        .from(adopters)
        .where(and(...conditions))
        .orderBy(desc(adopters.updatedAt))
        .limit(200);

    // Enrich adopters with ratings, stats, flags, and thumbnails
    const adopterIds = list.map((a: typeof adopters.$inferSelect) => a.id);
    const enrichmentMap = await enrichAdopters(db, adopterIds);

    // ── Rating summary (computed from enrichment of ALL non-deleted adopters) ──
    // We need global counts, so compute from the full enrichment set
    const ratingCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const noRatingCount = { count: 0 };

    // For the rating summary, we need ALL adopters' ratings, not just the filtered list
    // Fetch a broader set for accurate counts
    const allAdoptersForRating = await db.select({ id: adopters.id })
        .from(adopters)
        .where(isNull(adopters.deletedAt));
    const allIds = allAdoptersForRating.map((a: { id: string }) => a.id);
    const allEnrichment = allIds.length > 0 ? await enrichAdopters(db, allIds) : new Map();

    for (const [, data] of allEnrichment) {
        if (data.avgRating !== null) {
            const rounded = Math.round(data.avgRating);
            const clamped = Math.max(1, Math.min(5, rounded));
            ratingCounts[clamped] = (ratingCounts[clamped] || 0) + 1;
        } else {
            noRatingCount.count++;
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

    // ── Helper to build filter URL ──────────────────────────────────────
    function buildFilterUrl(params: Record<string, string | undefined>) {
        const merged = { q: q || undefined, country: filterCountry, rating: filterRating, user: filterUser, ...params };
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
                    {filterUser && <input type="hidden" name="user" value={filterUser} />}
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
                                    <span>⭐</span>
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

                {/* User Filter Dropdown */}
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                    <div className="flex items-center gap-4">
                        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Created / Updated by</h3>
                        <UserFilterSelect
                            users={distinctUsers}
                            currentUser={filterUser}
                            query={query}
                            filterCountry={filterCountry}
                            filterRating={filterRating}
                        />
                        {filterUser && (
                            <Link href={buildFilterUrl({ user: undefined })} className="text-xs text-teal-700 hover:text-teal-800 font-medium whitespace-nowrap">
                                Clear ✕
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            <div className="text-sm text-stone-500">
                {filteredList.length} adopter{filteredList.length !== 1 ? 's' : ''}
                {(filterCountry || filterRating || filterUser) && (
                    <span> (filtered) · <Link href={buildFilterUrl({ country: undefined, rating: undefined, user: undefined, q: q || undefined })} className="text-teal-700 hover:underline">Clear all filters</Link></span>
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

