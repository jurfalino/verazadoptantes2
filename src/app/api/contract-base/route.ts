import { NextResponse } from 'next/server';
import { getContractBaseUrl } from '@/lib/contractUrl';

export const runtime = 'edge';

export async function GET() {
    const url = await getContractBaseUrl();
    return NextResponse.json(
        { url },
        { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } }
    );
}
