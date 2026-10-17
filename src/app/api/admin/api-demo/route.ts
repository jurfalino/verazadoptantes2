// Admin → API → «Personas de ejemplo»: (re)load the people of the API docs'
// exact-search scenarios (src/lib/api/demoSeed.ts). STAGING ONLY — refused on
// the production host, whoever asks.
import { NextResponse } from 'next/server';
import { like } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { environmentForHost } from '@/lib/api/keys';
import { seedApiDemo } from '@/lib/api/demoSeed';

export const runtime = 'edge';

function production(request: Request): boolean {
    return environmentForHost(new URL(request.url).host) === 'live';
}

export async function GET(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    if (production(request)) return NextResponse.json({ available: false });
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const rows = await db.select({ id: adopters.id }).from(adopters).where(like(adopters.id, 'demo-api-%')).all() as unknown[];
        return NextResponse.json({ available: true, loaded: rows.length });
    } catch (e) {
        const errorId = logger.error('api demo: status failed', e, { admin });
        return NextResponse.json({ error: 'Failed to read the demo people', errorId }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    if (production(request)) {
        logger.warn('api demo: refused in production', { admin });
        return NextResponse.json({ error: 'The demo people exist only on staging' }, { status: 404 });
    }
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const result = await seedApiDemo(db);
        logAudit({ userEmail: admin, action: 'api_demo_seeded', details: { ...result } });
        return NextResponse.json(result);
    } catch (e) {
        const errorId = logger.error('api demo: seed failed', e, { admin });
        return NextResponse.json({ error: 'Failed to load the demo people', errorId }, { status: 500 });
    }
}
