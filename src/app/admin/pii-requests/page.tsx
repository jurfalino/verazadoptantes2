export const runtime = 'edge';

import { getPiiAccessRequestsForApprover } from '@/app/actions/piiAccess';
import { isPiiGatingEnabled } from '@/lib/piiAccessServer';
import PiiAccessRequestPanel from '@/components/PiiAccessRequestPanel';

/**
 * Admin dashboard for PII access requests — the safety net so requests never
 * rot when a record's owner is unresponsive. Lists every pending request
 * across all adopters, oldest first; admins can approve or deny inline.
 */
export default async function AdminPiiRequestsPage() {
    const [gatingOn, requests] = await Promise.all([
        isPiiGatingEnabled(),
        getPiiAccessRequestsForApprover(),
    ]);

    return (
        <div className="max-w-3xl">
            <h1 className="text-2xl font-bold text-stone-900 mb-1">Contact Access Requests</h1>
            <p className="text-sm text-stone-500 mb-6">
                Pending requests for adopter contact info, across every record. Oldest first.
            </p>

            {!gatingOn && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 mb-4">
                    PII access gating is currently disabled (<code>ENABLE_PII_ACCESS_GATING</code> is off).
                    Any pending requests are still shown below, but contact masking is not active.
                </div>
            )}

            {requests.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
                    No pending contact access requests.
                </div>
            ) : (
                <PiiAccessRequestPanel requests={requests} showAdopter />
            )}
        </div>
    );
}
