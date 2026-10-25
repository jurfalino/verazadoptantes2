export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { resolveAuthSecret } from '@/lib/otp';
import { setEmailPrefForEmail } from '@/lib/emailPrefs';
import { unsubscribableCategory, verifyUnsubscribe } from '@/lib/emailUnsubscribe';

function back(req: NextRequest, params: Record<string, string>): NextResponse {
    const url = new URL('/email/unsubscribe', req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // 303 so the browser follows with GET.
    return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
    let email = '';
    let category = '';
    try {
        const form = await req.formData();
        email = String(form.get('e') ?? '');
        category = String(form.get('c') ?? '');
        const sig = String(form.get('s') ?? '');
        const cat = unsubscribableCategory(category);
        if (!cat || !(await verifyUnsubscribe(email, category, sig, resolveAuthSecret()))) {
            return back(req, { invalid: '1' });
        }
        await setEmailPrefForEmail(await getDb(), email.toLowerCase(), cat, false);
        return back(req, { done: '1', c: cat });
    } catch (e) {
        logger.error('emailUnsubscribe: failed', { category, error: e instanceof Error ? e.message : String(e) });
        return back(req, { invalid: '1' });
    }
}
