// Admin → API → People: one row per person with API access or keys (status, use, badges).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { listPeople } from '@/lib/api/adminInsights';

export const runtime = 'edge';

export async function GET(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const q = new URL(request.url).searchParams;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        return NextResponse.json(await listPeople(db, {
            status: q.get('status'), badge: q.get('badge'), q: q.get('q'), sort: q.get('sort'), page: Number(q.get('page') || 1),
        }));
    } catch (e) {
        const errorId = logger.error('admin api: people failed', e, { admin });
        return NextResponse.json({ error: 'Failed to load people', errorId }, { status: 500 });
    }
}
