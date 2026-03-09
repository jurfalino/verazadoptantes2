export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adopterHistory } from "@/db/schema";
import { desc, like, or, and, isNull, eq, sql, ne } from "drizzle-orm";
import Link from "next/link";
import DeleteAdopterButton from "@/components/DeleteAdopterButton";
import { enrichAdopters } from "@/app/actions/enrichAdopters";
import { getRatingColors, getRatingDescription } from "@/lib/ratingColors";
import { formatShortDate } from "@/lib/dates";

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
                            buildFilterUrl={buildFilterUrl}
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

            <div className="space-y-3">
                {filteredList.map((adopter: typeof adopters.$inferSelect) => {
                    const enrichment = enrichmentMap.get(adopter.id);
                    const avgRating = enrichment?.avgRating ?? null;
                    const stats = enrichment?.stats ?? { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
                    const flags = enrichment?.flags ?? {
                        inaccurate: false, duplicate: false, systemDuplicate: false,
                        verified_identity: false, verified_address: false,
                        tooManyAdoptions: null, tooManyRequests: null
                    };
                    const thumbnail = enrichment?.thumbnail ?? null;
                    const addedDate = adopter.createdAt ? formatShortDate(adopter.createdAt) : null;
                    const updatedDate = adopter.updatedAt ? formatShortDate(adopter.updatedAt) : null;

                    // Server-rendered rating badge colors
                    const ratingColors = avgRating !== null ? getRatingColors(Math.round(avgRating)) : null;
                    const ratingLabel = avgRating !== null ? getRatingDescription(Math.round(avgRating)) : null;

                    return (
                        <div key={adopter.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 hover:border-teal-300 hover:shadow-md transition-all">
                            {/* Top Row: Avatar + Name/Contact + Country + Rating */}
                            <div className="flex items-center gap-3 mb-3">
                                {/* Thumbnail */}
                                <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                    {thumbnail ? (
                                        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-stone-500">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        </div>
                                    )}
                                </div>
                                {/* Name + Contact + ID */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-stone-900 truncate">{adopter.name}</div>
                                    <div className="text-xs text-stone-500 truncate">
                                        {adopter.contactInfo || '-'}
                                    </div>
                                    <div className="text-xs text-stone-500 font-mono truncate">{adopter.id}</div>
                                </div>
                                {/* Country badge */}
                                {adopter.country && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">
                                        {countryFlag(adopter.country)} {adopter.country.toUpperCase()}
                                    </span>
                                )}
                                {/* Rating Badge (server-rendered) */}
                                {ratingColors && ratingLabel && (
                                    <div className={`inline-flex items-center gap-1.5 rounded-full font-semibold shadow-sm px-2 py-0.5 text-xs border ${ratingColors.bg} ${ratingColors.text} ${ratingColors.border}`}>
                                        <span className="capitalize">{ratingLabel}</span>
                                    </div>
                                )}
                            </div>

                            {/* Stats Row */}
                            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                                <span>🔍 {stats.searchHits} searches</span>
                                <span>👁 {stats.profileViews} views</span>
                                <span>📋 {stats.requests} requests</span>
                                <span>🏠 {stats.adoptions} adoptions</span>
                                {/* Flags */}
                                <div className="flex flex-wrap gap-1 ml-auto">
                                    {flags.inaccurate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700">⚠ Inaccurate</span>
                                    )}
                                    {flags.duplicate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">📄 Duplicate</span>
                                    )}
                                    {flags.systemDuplicate && !flags.duplicate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-stone-100 text-stone-500">🔗 Possible dup</span>
                                    )}
                                    {flags.verified_identity && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ Identity</span>
                                    )}
                                    {flags.verified_address && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ Address</span>
                                    )}
                                    {flags.tooManyAdoptions && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {flags.tooManyAdoptions.count} adoptions/{flags.tooManyAdoptions.periodDays}d</span>
                                    )}
                                    {flags.tooManyRequests && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {flags.tooManyRequests.count} requests/{flags.tooManyRequests.periodDays}d</span>
                                    )}
                                </div>
                            </div>

                            {/* Bottom Row: Dates + Added By + Actions */}
                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-stone-100">
                                <div className="flex gap-3 text-xs text-stone-500">
                                    {addedDate && <span>📅 {addedDate}</span>}
                                    {updatedDate && <span>✏️ {updatedDate}</span>}
                                    {adopter.addedBy && adopter.addedBy !== 'anonymous' && (
                                        <span className="text-stone-500">by {adopter.addedBy}</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Link
                                        href={`/adopter/${adopter.id}`}
                                        target="_blank"
                                        className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
                                    >
                                        Edit
                                    </Link>
                                    <DeleteAdopterButton adopterId={adopter.id} adopterName={adopter.name} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * User filter dropdown — a small client-side component for navigation on change.
 * Since we're in a server component, we use a script-free approach with links,
 * but a select dropdown requires JS for navigation. We inline a tiny script.
 */
function UserFilterSelect({
    users,
    currentUser,
    query,
    filterCountry,
    filterRating,
}: {
    users: string[];
    currentUser?: string;
    buildFilterUrl: (params: Record<string, string | undefined>) => string;
    query: string;
    filterCountry?: string;
    filterRating?: string;
}) {
    // Build URL for each user option via data attributes
    const baseParams = new URLSearchParams();
    if (query) baseParams.set('q', query);
    if (filterCountry) baseParams.set('country', filterCountry);
    if (filterRating) baseParams.set('rating', filterRating);

    const baseUrl = `/admin/adopters`;

    return (
        <>
            <select
                id="user-filter-select"
                defaultValue={currentUser || ''}
                className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-700 bg-white max-w-xs"
                data-base-url={baseUrl}
                data-base-params={baseParams.toString()}
            >
                <option value="">All users</option>
                {users.map(u => (
                    <option key={u} value={u}>{u}</option>
                ))}
            </select>
            <script
                dangerouslySetInnerHTML={{
                    __html: `
                        document.getElementById('user-filter-select')?.addEventListener('change', function(e) {
                            var sel = e.target;
                            var params = new URLSearchParams(sel.dataset.baseParams || '');
                            if (sel.value) params.set('user', sel.value);
                            var qs = params.toString();
                            window.location.href = sel.dataset.baseUrl + (qs ? '?' + qs : '');
                        });
                    `,
                }}
            />
        </>
    );
}
