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
