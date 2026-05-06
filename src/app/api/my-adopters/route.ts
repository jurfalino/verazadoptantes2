import { NextResponse, NextRequest } from 'next/server';
import { getMyAdopters } from '@/app/actions';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function GET(_request: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const adopters = await getMyAdopters('date');
        return NextResponse.json(adopters);
    } catch (error) {
        const errorId = logger.error('API my-adopters error', error, { userEmail: session.user.email });
        return NextResponse.json({ error: 'Failed to load adopters', errorId }, { status: 500 });
    }
}
