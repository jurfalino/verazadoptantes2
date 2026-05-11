export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { errorReports } from '@/db/schema';
import { logger } from '@/lib/logger';

/**
 * Public endpoint for the /auth-error "report this problem" form.
 * No auth required — the user is by definition unauthenticated when they
 * land here. Validates input lengths, hashes the IP (we don't store raw
 * IPs for privacy), and writes a row to `error_reports`.
 *
 * No rate limiting at this layer (Cloudflare's upstream WAF + Workers
 * platform handle abuse). The form has a 2000-char message cap and the
 * insert is O(1), so worst case is wasted D1 writes.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json() as { email?: string; message?: string };
        const email = (body.email || '').trim().slice(0, 200) || null;
        const message = (body.message || '').trim().slice(0, 2000) || null;

        const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null;
        const rawIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
        const ipHash = rawIp ? await hashIp(rawIp) : null;

        const db = await getDb();
        if (db) {
            await db.insert(errorReports).values({
                id: crypto.randomUUID(),
                email,
                message,
                userAgent,
                ipHash,
            });
        }

        // Always return success — the form is also part of the deception
        // (real apps have working error-report flows). Even if D1 is down
        // we don't surface that to the submitter.
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.warn('error-report: submission handler threw', {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ ok: true });
    }
}

/**
 * Hash an IP with SHA-256 and truncate to 16 hex chars. Enough entropy
 * to dedup repeat submissions from the same address; reversible only via
 * pre-image search. Avoids storing raw IPs in the DB (privacy hygiene).
 */
async function hashIp(ip: string): Promise<string> {
    const data = new TextEncoder().encode(ip);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 16);
}
