export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getAvailableModels } from '@/lib/gemini';
import { auth } from '@/auth';

export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const models = await getAvailableModels();

    if (models.length === 0) {
        // Fallback list if API fails
        return NextResponse.json({
            models: [
                { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash (Default)' },
                { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
                { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' }
            ]
        });
    }

    return NextResponse.json({ models });
}
