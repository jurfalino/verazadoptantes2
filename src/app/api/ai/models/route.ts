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
        // Fallback list if the live API call fails. Kept minimal — the
        // models we've actually verified work as of v2.16.0-41. Anything
        // listed here can still be retired by Google between deploys; the
        // admin can always type a model name manually in /admin/config
        // when that happens.
        return NextResponse.json({
            models: [
                { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Default)' },
                { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
                { name: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' }
            ]
        });
    }

    return NextResponse.json({ models });
}
