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
                // v2.24.9: '-latest' aliases track the current stable model, so
                // they don't 404 when Google retires a pinned version (which is
                // exactly what happened to gemini-2.5-flash).
                { name: 'gemini-flash-latest', displayName: 'Gemini Flash (latest, default)' },
                { name: 'gemini-pro-latest', displayName: 'Gemini Pro (latest)' },
                { name: 'gemini-flash-lite-latest', displayName: 'Gemini Flash Lite (latest)' }
            ]
        });
    }

    return NextResponse.json({ models });
}
