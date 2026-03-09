export const runtime = 'edge';
import { getDb, dismissFlag } from "@/app/actions";
import { adopterFlags, adopters } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { formatShortDate } from '@/lib/dates';

// Server Actions for this page
async function handleDismiss(formData: FormData) {
    'use server';
    const id = formData.get('id') as string;
    await dismissFlag(id);
    revalidatePath('/admin/flags');
}

export default async function AdminFlagsPage() {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const flags = await db.select({
        id: adopterFlags.id,
        reason: adopterFlags.reason,
        details: adopterFlags.details,
        flaggedBy: adopterFlags.flaggedBy,
        createdAt: adopterFlags.createdAt,
        adopterId: adopterFlags.adopterId,
        adopterName: adopters.name, // Join to get name
    })
        .from(adopterFlags)
        .leftJoin(adopters, eq(adopterFlags.adopterId, adopters.id))
        .orderBy(desc(adopterFlags.createdAt));

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <h2 className="text-2xl font-semibold text-stone-900">Flagged Content Review</h2>

            {flags.length === 0 ? (
                <div className="bg-white p-12 text-center rounded-2xl border border-stone-200 text-stone-500">
                    No active flags. Good job!
                </div>
            ) : (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Adopter</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Reason</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Details</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Reporter</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {flags.map((flag: typeof flags[number]) => (
                                    <tr key={flag.id} className="hover:bg-stone-50/50">
                                        <td className="p-4">
                                            <div className="font-semibold text-stone-900">{flag.adopterName || 'Unknown'}</div>
                                            <div className="text-xs text-stone-500 font-mono">{flag.adopterId}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold uppercase ${flag.reason === 'dangerous' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                                                {flag.reason}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-stone-600 max-w-xs truncate" title={flag.details || ''}>
                                            {flag.details || '-'}
                                        </td>
                                        <td className="p-4 text-xs text-stone-500">
                                            {flag.flaggedBy}
                                            <br />
                                            {flag.createdAt ? formatShortDate(new Date(flag.createdAt)) : ''}
                                        </td>
                                        <td className="p-4 text-right space-x-2">
                                            <a
                                                href={`/adopter/${flag.adopterId}`}
                                                target="_blank"
                                                className="px-3 py-1.5 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                                            >
                                                View
                                            </a>
                                            <form action={handleDismiss} className="inline-block">
                                                <input type="hidden" name="id" value={flag.id} />
                                                <button
                                                    type="submit"
                                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-sm"
                                                >
                                                    Dismiss
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {flags.map((flag: typeof flags[number]) => (
                            <div key={flag.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="min-w-0">
                                        <div className="font-semibold text-stone-900 truncate">{flag.adopterName || 'Unknown'}</div>
                                        <div className="text-xs text-stone-500 font-mono truncate">{flag.adopterId}</div>
                                    </div>
                                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold uppercase flex-shrink-0 ${flag.reason === 'dangerous' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                                        {flag.reason}
                                    </span>
                                </div>
                                {flag.details && (
                                    <p className="text-sm text-stone-600 mb-2">{flag.details}</p>
                                )}
                                <div className="text-xs text-stone-500 mb-3">
                                    {flag.flaggedBy} · {flag.createdAt ? formatShortDate(new Date(flag.createdAt)) : ''}
                                </div>
                                <div className="flex gap-2">
                                    <a
                                        href={`/adopter/${flag.adopterId}`}
                                        target="_blank"
                                        className="flex-1 text-center px-3 py-2 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                                    >
                                        View
                                    </a>
                                    <form action={handleDismiss} className="flex-1">
                                        <input type="hidden" name="id" value={flag.id} />
                                        <button
                                            type="submit"
                                            className="w-full px-3 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-sm"
                                        >
                                            Dismiss
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
