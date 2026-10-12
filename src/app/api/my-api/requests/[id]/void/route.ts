// Settings → API: void a record the rescuer's own key saved (decision 11).
import { NextResponse } from 'next/server';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { voidResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    return voidResponse((await params).id, me, me);
}
