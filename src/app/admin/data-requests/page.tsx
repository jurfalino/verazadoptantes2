export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { dataRequests, adopters } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { formatShortDate } from '@/lib/dates';

async function handleResolve(formData: FormData) {
    'use server';
    const id = formData.get('id') as string;
    const action = formData.get('action') as string; // 'resolved' or 'rejected'
    const db = await getDb();
    if (!db) return;
    await db.update(dataRequests)
        .set({
            status: action,
            resolvedAt: new Date(),
            resolvedBy: 'admin',
        })
        .where(eq(dataRequests.id, id));
    revalidatePath('/admin/data-requests');
}

export default async function AdminDataRequestsPage() {
    const db = await getDb();
    if (!db) return <div>DB Unavailable</div>;

    const requests = await db.select({
        id: dataRequests.id,
        adopterId: dataRequests.adopterId,
        requesterName: dataRequests.requesterName,
        requesterEmail: dataRequests.requesterEmail,
        requestType: dataRequests.requestType,
        details: dataRequests.details,
        status: dataRequests.status,
        createdAt: dataRequests.createdAt,
        resolvedAt: dataRequests.resolvedAt,
        resolvedBy: dataRequests.resolvedBy,
        adopterName: adopters.name,
    })
        .from(dataRequests)
        .leftJoin(adopters, eq(dataRequests.adopterId, adopters.id))
        .orderBy(desc(dataRequests.createdAt));

    type DataRequest = typeof requests[number];
    const pending = requests.filter((r: DataRequest) => r.status === 'pending');
    const resolved = requests.filter((r: DataRequest) => r.status !== 'pending');

    const typeColors: Record<string, string> = {
        inaccuracy: 'bg-amber-100 text-amber-800',
        access: 'bg-blue-100 text-blue-800',
        rectification: 'bg-purple-100 text-purple-800',
        deletion: 'bg-rose-100 text-rose-800',
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-stone-900">📬 Data Requests</h2>
            <p className="text-stone-500 text-sm">ARCO rights requests and inaccuracy reports from data subjects.</p>

            {/* Pending */}
            <div>
                <h3 className="text-lg font-bold text-stone-800 mb-3">
                    Pending <span className="text-sm font-normal text-stone-400">({pending.length})</span>
                </h3>
                {pending.length === 0 ? (
                    <div className="bg-white p-8 text-center rounded-2xl border border-stone-200 text-stone-400">
                        No pending requests. ✅
                    </div>
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-stone-50 border-b border-stone-100">
                                    <tr>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Requester</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Type</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Profile</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Details</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Date</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {pending.map((r: DataRequest) => (
                                        <tr key={r.id} className="hover:bg-stone-50/50">
                                            <td className="p-4">
                                                <div className="font-bold text-stone-900 text-sm">{r.requesterName}</div>
                                                {r.requesterEmail && (
                                                    <div className="text-xs text-stone-400">{r.requesterEmail}</div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold uppercase ${typeColors[r.requestType] || 'bg-stone-100 text-stone-600'}`}>
                                                    {r.requestType}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                {r.adopterId ? (
                                                    <a href={`/adopter/${r.adopterId}`} target="_blank" className="text-teal-600 hover:underline text-sm font-medium">
                                                        {r.adopterName || r.adopterId}
                                                    </a>
                                                ) : (
                                                    <span className="text-stone-400 text-sm">General</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-sm text-stone-600 max-w-xs">
                                                <div className="truncate" title={r.details || ''}>{r.details || '-'}</div>
                                            </td>
                                            <td className="p-4 text-xs text-stone-500">
                                                {r.createdAt ? formatShortDate(new Date(r.createdAt)) : '-'}
                                            </td>
                                            <td className="p-4 text-right space-x-2">
                                                <form action={handleResolve} className="inline-flex gap-2">
                                                    <input type="hidden" name="id" value={r.id} />
                                                    <button
                                                        type="submit"
                                                        name="action"
                                                        value="resolved"
                                                        className="px-3 py-1.5 text-xs font-bold text-white bg-teal-500 rounded-lg hover:bg-teal-600"
                                                    >
                                                        ✓ Resolve
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        name="action"
                                                        value="rejected"
                                                        className="px-3 py-1.5 text-xs font-bold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                                                    >
                                                        ✕ Reject
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
                            {pending.map((r: DataRequest) => (
                                <div key={r.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-stone-900 text-sm">{r.requesterName}</div>
                                            {r.requesterEmail && (
                                                <div className="text-xs text-stone-400 truncate">{r.requesterEmail}</div>
                                            )}
                                        </div>
                                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold uppercase flex-shrink-0 ${typeColors[r.requestType] || 'bg-stone-100 text-stone-600'}`}>
                                            {r.requestType}
                                        </span>
                                    </div>
                                    {r.adopterId && (
                                        <div className="text-sm mb-1">
                                            <a href={`/adopter/${r.adopterId}`} target="_blank" className="text-teal-600 hover:underline font-medium">
                                                {r.adopterName || r.adopterId}
                                            </a>
                                        </div>
                                    )}
                                    {r.details && <p className="text-sm text-stone-600 mb-2">{r.details}</p>}
                                    <div className="text-xs text-stone-500 mb-3">
                                        {r.createdAt ? formatShortDate(new Date(r.createdAt)) : '-'}
                                    </div>
                                    <form action={handleResolve} className="flex gap-2">
                                        <input type="hidden" name="id" value={r.id} />
                                        <button
                                            type="submit"
                                            name="action"
                                            value="resolved"
                                            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-teal-500 rounded-lg hover:bg-teal-600"
                                        >
                                            ✓ Resolve
                                        </button>
                                        <button
                                            type="submit"
                                            name="action"
                                            value="rejected"
                                            className="flex-1 px-3 py-2 text-xs font-bold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                                        >
                                            ✕ Reject
                                        </button>
                                    </form>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Resolved/Rejected */}
            {resolved.length > 0 && (
                <div>
                    <h3 className="text-lg font-bold text-stone-800 mb-3">
                        History <span className="text-sm font-normal text-stone-400">({resolved.length})</span>
                    </h3>
                    <>
                        {/* Desktop table */}
                        <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                            <table className="w-full text-left">
                                <thead className="bg-stone-50 border-b border-stone-100">
                                    <tr>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Requester</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Type</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Profile</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Status</th>
                                        <th className="p-4 font-bold text-stone-500 text-sm">Resolved</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {resolved.map((r: DataRequest) => (
                                        <tr key={r.id} className="opacity-60">
                                            <td className="p-4 text-sm text-stone-700">{r.requesterName}</td>
                                            <td className="p-4">
                                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold uppercase ${typeColors[r.requestType] || 'bg-stone-100 text-stone-600'}`}>
                                                    {r.requestType}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                {r.adopterId ? (
                                                    <a href={`/adopter/${r.adopterId}`} target="_blank" className="text-teal-600 hover:underline text-sm">
                                                        {r.adopterName || r.adopterId}
                                                    </a>
                                                ) : (
                                                    <span className="text-stone-400 text-sm">General</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold uppercase ${r.status === 'resolved' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-600'}`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-xs text-stone-500">
                                                {r.resolvedAt ? formatShortDate(new Date(r.resolvedAt)) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="md:hidden space-y-3">
                            {resolved.map((r: DataRequest) => (
                                <div key={r.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 opacity-60">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="text-sm text-stone-700 font-medium">{r.requesterName}</div>
                                        <div className="flex gap-1.5 flex-shrink-0">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold uppercase ${typeColors[r.requestType] || 'bg-stone-100 text-stone-600'}`}>
                                                {r.requestType}
                                            </span>
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold uppercase ${r.status === 'resolved' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-600'}`}>
                                                {r.status}
                                            </span>
                                        </div>
                                    </div>
                                    {r.adopterId && (
                                        <a href={`/adopter/${r.adopterId}`} target="_blank" className="text-teal-600 hover:underline text-sm block mb-1">
                                            {r.adopterName || r.adopterId}
                                        </a>
                                    )}
                                    <div className="text-xs text-stone-500">
                                        {r.resolvedAt ? formatShortDate(new Date(r.resolvedAt)) : '-'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                </div>
            )}
        </div>
    );
}
