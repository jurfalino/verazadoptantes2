export const runtime = 'edge';

import { getDb } from '@/app/actions';
import { dataRequests } from '@/db/schema';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as { adopterId?: string; requesterName?: string; requesterEmail?: string; requestType?: string; details?: string };
        const { adopterId, requesterName, requesterEmail, requestType, details } = body;

        if (!requesterName?.trim()) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        if (!requestType) {
            return NextResponse.json({ error: 'Request type is required' }, { status: 400 });
        }

        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        const id = crypto.randomUUID();
        await db.insert(dataRequests).values({
            id,
            adopterId: adopterId || null,
            requesterName: requesterName.trim(),
            requesterEmail: requesterEmail?.trim() || null,
            requestType,
            details: details?.trim() || null,
        });

        return NextResponse.json({ success: true, id });
    } catch (error) {
        console.error('Data request error:', error);
        return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
    }
}
