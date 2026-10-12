/**
 * Session guards for the API review routes (admin page, Settings → API).
 * Not 'use server': plain helpers for route handlers.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { getFeatureFlag } from '@/config/features';

export async function adminEmailOr401(): Promise<string | NextResponse> {
    const email = (await auth())?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await isAdminAsync(email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return email;
}

/** A signed-in rescuer, and only while the API is enabled. */
export async function rescuerEmailOr401(): Promise<string | NextResponse> {
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const email = (await auth())?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return email;
}
