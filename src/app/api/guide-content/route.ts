import { NextResponse } from 'next/server';
import { STEPS, FAQ, HERO, BENEFITS, LABELS } from '@/content/guide-data';

export const runtime = 'edge';

export async function GET() {
    return NextResponse.json(
        { steps: STEPS, faq: FAQ, hero: HERO, benefits: BENEFITS, labels: LABELS },
        {
            headers: {
                'Cache-Control': 'public, max-age=3600, s-maxage=86400',
            },
        }
    );
}
