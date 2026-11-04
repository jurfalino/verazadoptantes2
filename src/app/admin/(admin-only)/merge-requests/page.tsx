export const runtime = 'edge';

import { getDb } from '@/app/actions/_db';
import { logger } from '@/lib/logger';
import { listMergeRequestsForAdmin } from '@/lib/mergeRequests';
import { listMergeDisputesForAdmin } from '@/lib/mergeDisputes';
import MergeRequestsPanel from '@/components/admin/MergeRequestsPanel';

/**
 * Admin queue of merge requests between rescuers, and the disputes about
 * merges that already happened («Disputas», D50). Lives under `(admin-only)`
 * so the route-group layout refuses moderators server-side (URL stays
 * `/admin/merge-requests`). Pending first, oldest first; declined requests stay
 * listed so an admin can still approve them; one row per pair.
 */
export default async function AdminMergeRequestsPage() {
    const db = await getDb();
    // Each list stands on its own: one failing read must not hide the other.
    const [requests, disputes] = db ? await Promise.all([
        listMergeRequestsForAdmin(db).catch((e) => {
            logger.error('AdminMergeRequestsPage: merge requests not loaded', e, { list: 'requests' });
            return [];
        }),
        listMergeDisputesForAdmin(db).catch((e) => {
            logger.error('AdminMergeRequestsPage: merge disputes not loaded', e, { list: 'disputes' });
            return [];
        }),
    ]) : [[], []];

    return <MergeRequestsPanel requests={requests} disputes={disputes} />;
}
