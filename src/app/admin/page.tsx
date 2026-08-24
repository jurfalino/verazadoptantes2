export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adoptions, adopterFlags } from "@/db/schema";
import { count, isNull, and, ne } from "drizzle-orm";
import AdminMetricsCollapsible from "@/components/admin/AdminMetricsCollapsible";
import { FLAG_REASONS } from "@/domain/constants";

export default async function AdminOverviewPage() {
    const db = await getDb();
    if (!db) return <div>Database unavailable</div>;

    // Only the cheap DB counters load eagerly — the (slow) Axiom metrics now live
    // in a collapsible that fetches on expand, so the overview renders fast.
    const [adopterCount, adoptionCount, activeFlagsCount] = await Promise.all([
        db.select({ count: count() }).from(adopters).where(isNull(adopters.deletedAt)),
        // "Adopter Activities" — counts every row in the adoptions table
        // regardless of recordType (adoption, request, observation, follow-up,
        // returned, foster, available).
        db.select({ count: count() }).from(adoptions),
        // Active Flags: exclude positive verification flags (verified_identity,
        // verified_address) — those aren't "active concerns", they're trust signals.
        db.select({ count: count() }).from(adopterFlags).where(and(
            ne(adopterFlags.reason, FLAG_REASONS.VERIFIED_IDENTITY),
            ne(adopterFlags.reason, FLAG_REASONS.VERIFIED_ADDRESS),
        )),
    ]);

    const stats = [
        { label: 'Total Adopters', value: adopterCount[0].count, color: 'emerald' },
        { label: 'Adopter Activities', value: adoptionCount[0].count, color: 'blue' },
        { label: 'Active Flags', value: activeFlagsCount[0].count, color: 'rose' },
    ];

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <header>
                <h2 className="text-3xl font-semibold text-stone-900">Dashboard Overview</h2>
                <p className="text-stone-500 mt-2">Welcome back, Admin.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {stats.map((stat) => (
                    <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <p className={`text-sm font-semibold uppercase tracking-wider text-${stat.color}-600/70 mb-2`}>
                            {stat.label}
                        </p>
                        <p className="text-4xl font-extrabold text-stone-900">
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Métricas — the /admin/metrics dashboard, folded in here as a
                collapsible that only queries Axiom when expanded (v2.44.1). */}
            <AdminMetricsCollapsible />
        </div>
    );
}
