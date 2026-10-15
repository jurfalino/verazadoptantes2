// Settings → API: one of the rescuer's own transactions, with the bodies they sent and got.
import { NextResponse } from 'next/server';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { detailResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    return detailResponse((await params).id, me, me);
}
