import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Lazy-init: defer makeRouteHandler to the first request so it doesn't
// crash during `next build` when env vars are missing. This also lets
// the Keystatic GitHub App creation wizard work before env vars exist.
let _handler: { GET: Function; POST: Function } | null = null;

async function getHandler() {
    if (!_handler) {
        const { makeRouteHandler } = await import('@keystatic/next/route-handler');
        const { default: config } = await import('../../../../../keystatic.config');
        _handler = makeRouteHandler({ config });
    }
    return _handler;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    return (h.GET as Function)(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    return (h.POST as Function)(req, ctx);
}
