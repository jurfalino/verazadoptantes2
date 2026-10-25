export const runtime = 'edge';

import { getDb } from '@/app/actions/_db';
import { listMergeRequestsForAdmin } from '@/lib/mergeRequests';
import MergeRequestsPanel from '@/components/admin/MergeRequestsPanel';

/**
 * Admin queue of merge requests between rescuers. Lives under `(admin-only)`
 * so the route-group layout refuses moderators server-side (URL stays
 * `/admin/merge-requests`). Pending first, oldest first; declined requests stay
 * listed so an admin can still approve them.
 */
export default async function AdminMergeRequestsPage() {
    const db = await getDb();
    const requests = db ? await listMergeRequestsForAdmin(db) : [];

    return (
        <div className="max-w-3xl">
            <h1 className="text-2xl font-bold text-stone-900 mb-1">Pedidos de combinación</h1>
            <p className="text-sm text-stone-500 mb-6">
                Pedidos para unir dos perfiles de adoptantes. Los pendientes primero, del más antiguo al más nuevo.
            </p>

            {requests.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
                    No hay pedidos de combinación pendientes.
                </div>
            ) : (
                <MergeRequestsPanel requests={requests} />
            )}
        </div>
    );
}
