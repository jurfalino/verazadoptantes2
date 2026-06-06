export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Returns the Google OAuth client ID for the Google Identity Services
 * client-side init (v2.18.0). We don't embed it via NEXT_PUBLIC_* env
 * because Cloudflare Pages doesn't surface runtime env vars to build-time
 * inlines (see memory `project_buildtime_envvars`); instead the client
 * fetches it from this endpoint when the user clicks the "Desde Google
 * Contacts" button.
 *
 * The client ID is a public identifier — OAuth clients are designed for
 * client-side embedding — but we gate the endpoint behind authentication
 * anyway. Unauthenticated visitors don't need it; the only consumer is
 * `GoogleContactsPickerLauncher`, which only renders inside the signed-in
 * homepage. Saves a roundtrip on the public homepage and keeps the value
 * out of view for bots / scrapers.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = process.env.AUTH_GOOGLE_ID || '';
    if (!clientId) {
        return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
    }

    return NextResponse.json({ clientId });
}
