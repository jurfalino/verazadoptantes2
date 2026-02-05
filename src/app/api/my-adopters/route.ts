import { NextResponse } from 'next/server';
import { getMyAdopters } from '@/app/actions';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const adopters = await getMyAdopters('date');
        return NextResponse.json(adopters);
    } catch (error) {
        console.error('API my-adopters error:', error);
        return NextResponse.json([], { status: 500 });
    }
}
