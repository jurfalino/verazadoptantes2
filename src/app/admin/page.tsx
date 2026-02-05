export const runtime = 'edge';
import { auth } from "@/auth";
import { getDb } from "@/app/actions"; // Or use direct DB access in Server Component
import { adopters, adoptions, adopterFlags } from "@/db/schema";
import { count, eq, isNull } from "drizzle-orm";
import AdminDangerZone from "@/components/AdminDangerZone";

export default async function AdminOverviewPage() {
    const db = await getDb();
    if (!db) return <div>Database unavailable</div>;

    // Use await Promise.all for parallel fetching
    const [
        adopterCount,
        adoptionCount,
        activeFlagsCount
    ] = await Promise.all([
        db.select({ count: count() }).from(adopters),
        db.select({ count: count() }).from(adoptions),
        db.select({ count: count() }).from(adopterFlags),
    ]);

    const stats = [
        { label: 'Total Adopters', value: adopterCount[0].count, color: 'emerald' },
        { label: 'Recorded Adoptions', value: adoptionCount[0].count, color: 'blue' },
        { label: 'Active Flags', value: activeFlagsCount[0].count, color: 'rose' },
    ];

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <header>
                <h2 className="text-3xl font-bold text-stone-900">Dashboard Overview</h2>
                <p className="text-stone-500 mt-2">Welcome back, Admin.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {stats.map((stat) => (
                    <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <p className={`text-sm font-bold uppercase tracking-wider text-${stat.color}-600/70 mb-2`}>
                            {stat.label}
                        </p>
                        <p className="text-4xl font-extrabold text-stone-900">
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Quick Actions or Recent Activity could go here */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-stone-200 text-center py-24 text-stone-400">
                <p>Activity Log coming soon...</p>
            </div>

            {/* Danger Zone */}
            <AdminDangerZone />
        </div>
    );
}
