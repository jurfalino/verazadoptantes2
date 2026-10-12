// Admin → API: every transaction, filterable by owner / key / outcome / date.
import { NextResponse } from 'next/server';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { listResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function GET(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    return listResponse(request, admin, null);
}
