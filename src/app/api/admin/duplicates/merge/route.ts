export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { mergeAdopters, mergeCandidatePair } from '@/app/actions/duplicates';

/**
 * How many secondaries one request may merge into the primary. Each merge is
 * ~20 D1 subrequests (merge mechanics + immediate re-tokenize), so the cap
 * keeps a full batch well under the Workers subrequest ceiling.
 */
const MASS_MERGE_MAX = 10;

/**
 * POST /api/admin/duplicates/merge
 * Admin-triggered merge of adopter profiles. Accepts a single `secondaryId`
 * (the classic pair merge) or `secondaryIds[]` (mass-merge of a duplicate
 * cluster into one survivor). Merge mechanics live in `mergeAdopters()` in
 * actions/duplicates.ts and are shared with the rescuer-triggered
 * contract-link flow. This route only does the admin-auth check and the
 * sequential fan-out.
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { primaryId?: string; secondaryId?: string; secondaryIds?: string[]; candidateIds?: string[] };

    // Batch PAIR-WISE mode: each candidate pair merges independently, survivor
    // picked automatically (see mergeCandidatePair). This is the queue-clearing
    // workhorse — NOT the pool-into-one-survivor mode below.
    if (body.candidateIds && body.candidateIds.length > 0) {
        const candidateIds = [...new Set(body.candidateIds)].filter(Boolean);
        if (candidateIds.length > MASS_MERGE_MAX) {
            return NextResponse.json({ error: `At most ${MASS_MERGE_MAX} pairs can be merged per request` }, { status: 400 });
        }
        // Sequential: an earlier merge may resolve a later selected pair (a
        // record shared between them) — processing in order turns that into a
        // clean skip instead of a race.
        const results: Array<{ candidateId: string; success: boolean; skipped?: boolean; error?: string; auditId?: string }> = [];
        for (const candidateId of candidateIds) {
            const r = await mergeCandidatePair(candidateId, session.user.email);
            results.push({ candidateId, success: r.success, skipped: r.skipped, error: r.error, auditId: r.auditId });
        }
        const failed = results.filter(r => !r.success);
        const merged = results.filter(r => r.success && !r.skipped);
        if (failed.length === results.length) {
            return NextResponse.json({ error: failed[0]?.error ?? 'Merge failed', results }, { status: 500 });
        }
        return NextResponse.json({
            success: failed.length === 0,
            mergedCount: merged.length,
            skippedCount: results.filter(r => r.skipped).length,
            results,
        });
    }

    const { primaryId } = body;
    // Dedupe and drop the primary itself; a UI slip must not merge A into A.
    const secondaryIds = [...new Set(body.secondaryIds ?? (body.secondaryId ? [body.secondaryId] : []))]
        .filter(id => id && id !== primaryId);

    if (!primaryId || secondaryIds.length === 0) {
        return NextResponse.json({ error: 'Invalid merge request' }, { status: 400 });
    }
    if (secondaryIds.length > MASS_MERGE_MAX) {
        return NextResponse.json({ error: `At most ${MASS_MERGE_MAX} profiles can be merged per request` }, { status: 400 });
    }

    // Sequential on purpose: every merge rewrites the same primary row
    // (contact info, entries, token refresh), so parallel merges would race
    // on read-modify-write and drop each other's absorbed data.
    const results: Array<{ secondaryId: string; success: boolean; error?: string; auditId?: string }> = [];
    for (const secondaryId of secondaryIds) {
        const result = await mergeAdopters(primaryId, secondaryId, session.user.email);
        results.push({ secondaryId, success: result.success, error: result.error, auditId: result.auditId });
    }

    const failed = results.filter(r => !r.success);
    if (failed.length === results.length) {
        const firstError = failed[0]?.error ?? 'Merge failed';
        const status = firstError.includes('not found') ? 404
            : firstError.includes('Invalid') || firstError.includes('already-deleted') ? 400
            : 500;
        return NextResponse.json({ error: firstError, results }, { status });
    }

    return NextResponse.json({
        success: failed.length === 0,
        primaryId,
        mergedCount: results.length - failed.length,
        results,
    });
}
