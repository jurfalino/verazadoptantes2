import type { ActionResult } from '@/app/actions/interviewTypes';

/**
 * What the interview screen does with a candidate re-match result. A refusal
 * other than "feature off" is reported (once per identifier change — the
 * caller runs once per signature), never dropped: otherwise the rescuer keeps
 * interviewing against a stale candidate list without knowing.
 */
export function candidateRefreshOutcome(r: ActionResult<object>): 'apply' | 'report' | 'ignore' {
    if (r.ok) return 'apply';
    return r.error === 'disabled' ? 'ignore' : 'report';
}
