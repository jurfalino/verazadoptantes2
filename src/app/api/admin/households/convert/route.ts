export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { convertInlineHouseholds } from '@/lib/householdConversion';

/**
 * POST /api/admin/households/convert?dryRun=1&cursor=<hostId>&budget=<n>
 *
 * Households as profiles, Task 7: the bulk conversion of today's household
 * data (inline household_members, household_links, «No convive» corrections)
 * into profiles and memberships — src/lib/householdConversion.ts. Admin only.
 * `dryRun=1` writes nothing and returns the per-member report of what would
 * happen. One page per call, bounded by `budget` (members actually converted,
 * default 10, max 25; a host is never split) and `limit` (hosts read, default
 * 25); repeat with `cursor` = the response's `next` until it is null. Idempotent: running it
 * again changes nothing; members an old tab added since are converted.
 * The report carries ids and reasons only (no names, no contacts).
 * Jon approves the production run; afterwards run Admin → Duplicates → Scan Now.
 */
export async function POST(request: Request) {
    const session = await auth();
    const actor = session?.user?.email;
    if (!actor || !await isAdminAsync(actor)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(request.url);
    const dryRun = ['1', 'true'].includes(url.searchParams.get('dryRun') ?? '');
    const cursor = url.searchParams.get('cursor') || null;
    const num = (name: string) => {
        const v = Number(url.searchParams.get(name) ?? '');
        return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    const limit = num('limit');
    const budget = num('budget');
    try {
        const db = await getDb();
        if (!db) return NextResponse.json({ error: 'Database not available' }, { status: 503 });
        const report = await convertInlineHouseholds(db, { dryRun, actor, cursor, limit, budget });
        return NextResponse.json(report);
    } catch (e) {
        const errorId = logger.error('households/convert: run failed', e, { actor, dryRun, cursor });
        return NextResponse.json({ error: `Conversion failed (Error ID: ${errorId})`, errorId }, { status: 500 });
    }
}
