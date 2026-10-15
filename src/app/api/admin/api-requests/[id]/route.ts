// Admin → API: one transaction with its request and response bodies.
import { NextResponse } from 'next/server';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { detailResponse } from '@/lib/api/reviewRoutes';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    return detailResponse((await params).id, admin, null);
}
