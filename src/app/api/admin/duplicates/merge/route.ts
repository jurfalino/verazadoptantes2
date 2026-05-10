export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdmin } from '@/config/admins';
import { mergeAdopters } from '@/app/actions/duplicates';

/**
 * POST /api/admin/duplicates/merge
 * Admin-triggered merge of any two adopter profiles. Merge mechanics live in
 * `mergeAdopters()` in actions/duplicates.ts and are shared with the rescuer-
 * triggered contract-link flow. This route only does the admin-auth check.
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { primaryId, secondaryId } = await request.json() as { primaryId: string; secondaryId: string };

    const result = await mergeAdopters(primaryId, secondaryId, session.user.email);
    if (!result.success) {
        const status = result.error?.includes('not found') ? 404
            : result.error?.includes('Invalid') || result.error?.includes('already-deleted') ? 400
            : 500;
        return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
        success: true,
        primaryId,
        secondaryId,
        mergeDetails: result.mergeDetails,
    });
}
