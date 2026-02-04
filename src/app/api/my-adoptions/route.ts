import { NextResponse } from 'next/server';
import { getMyAdoptions } from '@/app/actions';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const filter = searchParams.get('filter') === 'adopted' ? 'adopted' : 'all';
        const adoptions = await getMyAdoptions(filter, 'date');
        return NextResponse.json(adoptions);
    } catch (error) {
        console.error('API my-adoptions error:', error);
        return NextResponse.json([], { status: 500 });
    }
}
