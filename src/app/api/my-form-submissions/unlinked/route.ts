import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getMyUnlinkedFormSubmissions } from '@/app/actions/dashboard';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const forms = await getMyUnlinkedFormSubmissions();
        return NextResponse.json(forms);
    } catch (error) {
        logger.error('API my-form-submissions/unlinked error', error);
        return NextResponse.json([], { status: 500 });
    }
}
