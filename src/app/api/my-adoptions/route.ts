import { NextResponse, NextRequest } from 'next/server';
import { getMyAdoptions } from '@/app/actions';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const filterParam = searchParams.get('filter') || 'all';
        const validFilters = ['all', 'adoption', 'adoption_request', 'observation', 'follow_up', 'returned_pet'];
        const filter = validFilters.includes(filterParam) ? filterParam : 'all';
        const adoptions = await getMyAdoptions(filter as any, 'date');
        return NextResponse.json(adoptions);
    } catch (error) {
        const errorId = logger.error('API my-adoptions error', error, { userEmail: session.user.email });
        return NextResponse.json({ error: 'Failed to load adoptions', errorId }, { status: 500 });
    }
}
