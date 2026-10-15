// Settings → API: the signed-in rescuer's own keys and transactions (decision 12).
import { NextResponse } from 'next/server';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { listResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function GET(request: Request) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    return listResponse(request, me, me);
}
