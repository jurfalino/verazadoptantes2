export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { resolveAuthSecret } from '@/lib/otp';
import { setNoticePrefsForEmail } from '@/lib/emailPrefs';
import { verifyUnsubscribe } from '@/lib/emailUnsubscribe';
import { unsubscribeRows } from '@/domain/noticeRows';

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
        // A row key, or an old category (emails sent before «Avisos») mapped to its rows.
        const rows = unsubscribeRows(category);
        if (!rows || !(await verifyUnsubscribe(email, category, sig, resolveAuthSecret()))) {
            logger.warn('email.unsubscribe: invalid signature', { category });
            return back(req, { invalid: '1' });
        }
        await setNoticePrefsForEmail(await getDb(), email.toLowerCase(), rows, false);
        return back(req, { done: '1', c: category });
    } catch (e) {
        const errorId = logger.error('email.unsubscribe: failed', e, { category, email: maskEmail(email) });
        return back(req, { error: errorId });
    }
}
