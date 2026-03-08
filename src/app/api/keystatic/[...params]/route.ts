import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: NextRequest, ctx: any) => Promise<NextResponse>;
let _handler: { GET: RouteHandler; POST: RouteHandler } | null = null;

async function getHandler() {
    if (!_handler) {
        const { makeRouteHandler } = await import('@keystatic/next/route-handler');
        const { default: config } = await import('../../../../../keystatic.config');
        _handler = makeRouteHandler({ config }) as unknown as { GET: RouteHandler; POST: RouteHandler };
    }
    return _handler;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    return h.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    return h.POST(req, ctx);
}
