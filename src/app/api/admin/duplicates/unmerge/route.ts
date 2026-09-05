export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { unmergeAdopters } from '@/app/actions/duplicates';

/**
 * POST /api/admin/duplicates/unmerge
 * Reverse one or more merges by their merge-audit ids. The panel sends a
 * mass-merge's ids newest-first, because unmergeAdopters refuses to undo a
 * merge while a later one into the same survivor still stands.
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { auditIds?: string[] };
    const auditIds = [...new Set(body.auditIds ?? [])].filter(Boolean);
    if (auditIds.length === 0 || auditIds.length > 10) {
        return NextResponse.json({ error: 'Invalid unmerge request' }, { status: 400 });
    }

    const results: Array<{ auditId: string; success: boolean; error?: string }> = [];
    for (const auditId of auditIds) {
        const result = await unmergeAdopters(auditId, session.user.email);
        results.push({ auditId, success: result.success, error: result.error });
    }

    const failed = results.filter(r => !r.success);
    if (failed.length === results.length) {
        return NextResponse.json({ error: failed[0]?.error ?? 'Undo failed', results }, { status: 500 });
    }
    return NextResponse.json({ success: failed.length === 0, undoneCount: results.length - failed.length, results });
}
