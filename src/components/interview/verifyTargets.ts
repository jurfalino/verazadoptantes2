/**
 * Which candidates the focus panel should ask the server about. Pure (no
 * React, no server imports) so the decision is unit-testable; the rule on
 * which answers are comparable is the server's own (verifyGivenValues).
 */
import { verifyGivenValues } from '@/domain/interview/verify';
import type { Answer, CandidateSummary, QueueItem } from '@/domain/interview/types';

/** Cache key of one comparison: question, candidate, and the exact answer compared. */
export function verifyCacheKey(itemId: string, candidateId: string, answer: Answer | null): string {
    return `${itemId}|${candidateId}|${JSON.stringify(answer ?? null)}`;
}

/** Candidates that hold this fact but don't show it to the viewer (only the server can compare). */
export function protectedVerifyTargets(item: QueueItem, candidates: readonly CandidateSummary[]): string[] {
    if (!item.verify) return [];
    const fact = item.verify.fact;
    return candidates
        .filter(c => item.verify!.candidateIds.includes(c.adopterId) && !c.visible[fact]?.length)
        .map(c => c.adopterId);
}

/**
 * Candidates needing a server call now: protected ones whose result for this
 * exact answer is not cached yet — and none at all while the answer is not
 * comparable (a partial phone, a blank, more than 3 values, an address
 * without exactly one street number). A call then would spend the per-profile
 * budget and show a false "doesn't match".
 */
export function verifyCallTargets(item: QueueItem, answer: Answer | null, candidates: readonly CandidateSummary[], isCached: (key: string) => boolean): string[] {
    if (!item.verify || !verifyGivenValues(item.verify.fact, answer)) return [];
    return protectedVerifyTargets(item, candidates).filter(id => !isCached(verifyCacheKey(item.id, id, answer)));
}
