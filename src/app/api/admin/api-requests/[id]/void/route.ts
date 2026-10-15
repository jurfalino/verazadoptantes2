// Admin → API: undo the record any API transaction saved.
import { NextResponse } from 'next/server';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { voidResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    return voidResponse((await params).id, admin, null);
}
