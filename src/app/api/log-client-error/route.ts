import { NextResponse, NextRequest } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

interface ClientErrorPayload {
    errorId?: string;           // client-supplied id; logger uses it as-is so the displayed id matches Axiom
    message?: string;
    stack?: string;
    source?: string;            // 'boundary' | 'global-error' | 'window-error' | 'unhandled-rejection' | string
    url?: string;               // window.location.href
    userAgent?: string;
    digest?: string;            // Next.js error digest if available
    componentStack?: string;
    extra?: Record<string, unknown>;
    /**
     * 'warn' for conditions the app recovered from on its own (React hydration
     * mismatches — see src/domain/clientErrors.ts). Those are real defects we
     * want in Axiom, but they get no errorId because nothing is shown to the
     * user to quote back at us. Anything else defaults to 'error'.
     */
    level?: 'warn' | 'error';
}

function isValidErrorId(id: unknown): id is string {
    return typeof id === 'string' && /^[a-f0-9]{6,16}$/i.test(id);
}

export async function POST(request: NextRequest) {
    let payload: ClientErrorPayload = {};
    try {
        payload = (await request.json()) as ClientErrorPayload;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const session = await auth().catch(() => null);
    const userEmail = session?.user?.email || undefined;

    const message = (payload.message || 'Client error').slice(0, 500);
    const reconstructedError = new Error(message);
    if (payload.stack) reconstructedError.stack = payload.stack;

    const suppliedErrorId = isValidErrorId(payload.errorId) ? payload.errorId : undefined;

    const context = {
        source: payload.source || 'unknown',
        url: payload.url,
        userAgent: payload.userAgent,
        digest: payload.digest,
        componentStack: payload.componentStack,
        userEmail,
        ...(payload.extra || {}),
    };

    if (payload.level === 'warn') {
        logger.warn(`client: ${message}`, { ...context, stack: payload.stack });
        return NextResponse.json({ errorId: null });
    }

    const errorId = logger.error(`client: ${message}`, reconstructedError, {
        errorId: suppliedErrorId,
        source: payload.source || 'unknown',
        url: payload.url,
        userAgent: payload.userAgent,
        digest: payload.digest,
        componentStack: payload.componentStack,
        userEmail,
        ...(payload.extra || {}),
    });

    return NextResponse.json({ errorId });
}
