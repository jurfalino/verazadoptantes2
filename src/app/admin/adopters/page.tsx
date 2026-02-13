export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters } from "@/db/schema";
import { desc, like, or, and, isNull } from "drizzle-orm";
import Link from "next/link";
import DeleteAdopterButton from "@/components/DeleteAdopterButton";
import { enrichAdopters } from "@/app/actions/enrichAdopters";
import { getRatingColors, getRatingDescription } from "@/lib/ratingColors";
import { formatShortDate } from "@/lib/dates";

export default async function AdminAdoptersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const { q } = await searchParams;
    const query = q || '';

    const list = await db.select()
        .from(adopters)
        .where(
            and(
                isNull(adopters.deletedAt),
                query ? or(
                    like(adopters.name, `%${query}%`),
                    like(adopters.id, `%${query}%`)
                ) : undefined
            )
        )
        .orderBy(desc(adopters.updatedAt))
        .limit(50);

    // Enrich adopters with ratings, stats, flags, and thumbnails
    const adopterIds = list.map((a: typeof adopters.$inferSelect) => a.id);
    const enrichmentMap = await enrichAdopters(db, adopterIds);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-stone-900">Manage Adopters</h2>
                <form className="flex gap-2">
                    <input
                        name="q"
                        defaultValue={query}
                        placeholder="Search name or ID..."
                        className="px-4 py-2 rounded-lg border border-stone-200 text-sm w-64"
                    />
                    <button type="submit" className="px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-bold">Search</button>
                </form>
            </div>

            <div className="text-sm text-stone-400">{list.length} adopter{list.length !== 1 ? 's' : ''}</div>

            <div className="space-y-3">
                {list.map((adopter: typeof adopters.$inferSelect) => {
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
                            {/* Top Row: Avatar + Name/Contact + Rating */}
                            <div className="flex items-center gap-3 mb-3">
                                {/* Thumbnail */}
                                <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                    {thumbnail ? (
                                        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-stone-400">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        </div>
                                    )}
                                </div>
                                {/* Name + Contact + ID */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-stone-900 truncate">{adopter.name}</div>
                                    <div className="text-xs text-stone-400 truncate">
                                        {adopter.contactInfo || '-'}
                                    </div>
                                    <div className="text-xs text-stone-300 font-mono truncate">{adopter.id}</div>
                                </div>
                                {/* Rating Badge (server-rendered) */}
                                {ratingColors && ratingLabel && (
                                    <div className={`inline-flex items-center gap-1.5 rounded-full font-bold shadow-sm px-2 py-0.5 text-xs border ${ratingColors.bg} ${ratingColors.text} ${ratingColors.border}`}>
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
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">✓ Identity</span>
                                    )}
                                    {flags.verified_address && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">✓ Address</span>
                                    )}
                                    {flags.tooManyAdoptions && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {flags.tooManyAdoptions.count} adoptions/{flags.tooManyAdoptions.periodDays}d</span>
                                    )}
                                    {flags.tooManyRequests && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {flags.tooManyRequests.count} requests/{flags.tooManyRequests.periodDays}d</span>
                                    )}
                                </div>
                            </div>

                            {/* Bottom Row: Dates + Actions */}
                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-stone-100">
                                <div className="flex gap-3 text-xs text-stone-400">
                                    {addedDate && <span>📅 {addedDate}</span>}
                                    {updatedDate && <span>✏️ {updatedDate}</span>}
                                </div>
                                <div className="flex gap-2">
                                    <Link
                                        href={`/adopter/${adopter.id}`}
                                        target="_blank"
                                        className="px-3 py-1.5 text-xs font-bold text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100"
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
