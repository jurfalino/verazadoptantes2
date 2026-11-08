/**
 * Who may open a contract result (/contract-results/[id]) and answer its
 * «¿Es la misma persona?» cards (attachContractToExistingAdopter). ONE rule
 * for both, the same "team acts as one" rule form results follow
 * (src/lib/formSubmissionAccess.ts):
 *
 *   1. the notice's recipient (`notifications.user_id`, the rescuer who sent
 *      the contract link);
 *   2. an org-mate of the recipient;
 *   3. an admin.
 *
 * Only a CONTRACT RESULT is shared this way: anyone else's notification of
 * another type stays the recipient's (the page renders `metadata` as a
 * contract, so it must never open some other notice by id).
 *
 * Pure apart from the injected lookups, so the rule is unit-tested
 * (contractResultAccess.test.ts). Callers pass the STRICT lookups, so a D1
 * failure throws (an error with its errorId) instead of reading as "stranger".
 */

import type { NOTIFICATION_TYPES } from '@/domain/constants';

export const CONTRACT_RESULT_TYPE = 'contract_result' satisfies (typeof NOTIFICATION_TYPES)[number];

export interface ContractResultRef {
    /** Recipient email (`notifications.user_id`). */
    userId: string;
    type: string | null;
}

export interface ContractResultAccessDeps {
    isOrgMate(viewer: string, recipient: string): Promise<boolean>;
    isAdmin(viewer: string): Promise<boolean>;
}

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export async function canViewerAccessContractResult(
    viewerEmail: string | null | undefined,
    notification: ContractResultRef,
    deps: ContractResultAccessDeps,
): Promise<boolean> {
    const viewer = norm(viewerEmail);
    if (!viewer) return false;
    const recipient = norm(notification.userId);
    if (recipient && viewer === recipient) return true;
    if (notification.type !== CONTRACT_RESULT_TYPE) return false;
    if (recipient && await deps.isOrgMate(viewer, recipient)) return true;
    return deps.isAdmin(viewer);
}
