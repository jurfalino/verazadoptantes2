import { NextResponse } from 'next/server';
import { getMyAdoptions } from '@/app/actions';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const filterParam = searchParams.get('filter') || 'all';
        const validFilters = ['all', 'adoption', 'adoption_request', 'observation', 'follow_up', 'returned_pet'];
        const filter = validFilters.includes(filterParam) ? filterParam : 'all';
        const adoptions = await getMyAdoptions(filter as any, 'date');
        return NextResponse.json(adoptions);
    } catch (error) {
        console.error('API my-adoptions error:', error);
        return NextResponse.json([], { status: 500 });
    }
}
