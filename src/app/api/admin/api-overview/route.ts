// Admin → API → Overview: on/off, pending access requests, last 24h / 7 days, top fuzzy users.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { apiOverview } from '@/lib/api/adminInsights';

export const runtime = 'edge';

export async function GET() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        return NextResponse.json(await apiOverview(db));
    } catch (e) {
        const errorId = logger.error('admin api: overview failed', e, { admin });
        return NextResponse.json({ error: 'Failed to load the overview', errorId }, { status: 500 });
    }
}
