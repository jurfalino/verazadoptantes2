export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters } from "@/db/schema";
import { desc, like, or } from "drizzle-orm";
import Link from "next/link";
import DeleteAdopterButton from "@/components/DeleteAdopterButton";

export default async function AdminAdoptersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const { q } = await searchParams;
    const query = q || '';

    const list = await db.select()
        .from(adopters)
        .where(
            query ? or(
                like(adopters.name, `%${query}%`),
                like(adopters.id, `%${query}%`)
            ) : undefined
        )
        .orderBy(desc(adopters.updatedAt))
        .limit(50);

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

            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-stone-50 border-b border-stone-100">
                        <tr>
                            <th className="p-4 font-bold text-stone-500 text-sm">Name</th>
                            <th className="p-4 font-bold text-stone-500 text-sm">Contact</th>
                            <th className="p-4 font-bold text-stone-500 text-sm">Status</th>
                            <th className="p-4 font-bold text-stone-500 text-sm text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                        {list.map((adopter: typeof adopters.$inferSelect) => (
                            <tr key={adopter.id} className="hover:bg-stone-50/50">
                                <td className="p-4">
                                    <div className="font-bold text-stone-900">{adopter.name}</div>
                                    <div className="text-xs text-stone-400 font-mono">{adopter.id}</div>
                                </td>
                                <td className="p-4 text-sm text-stone-600 max-w-xs truncate">
                                    {adopter.contactInfo || '-'}
                                </td>
                                <td className="p-4">
                                    <span className="inline-flex px-2 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700">
                                        Rating: {adopter.status}
                                    </span>
                                </td>
                                <td className="p-4 text-right space-x-2">
                                    <Link
                                        href={`/adopter/${adopter.id}`}
                                        target="_blank"
                                        className="px-3 py-1.5 text-xs font-bold text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100"
                                    >
                                        Edit
                                    </Link>
                                    <DeleteAdopterButton adopterId={adopter.id} adopterName={adopter.name} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
