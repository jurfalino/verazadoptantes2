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
            logger.warn('email.unsubscribe: invalid signature', { category });
            return back(req, { invalid: '1' });
        }
        await setEmailPrefForEmail(await getDb(), email.toLowerCase(), cat, false);
        return back(req, { done: '1', c: cat });
    } catch (e) {
        const errorId = logger.error('email.unsubscribe: failed', e, { category, email });
        return back(req, { error: errorId });
    }
}
