import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: NextRequest, ctx: any) => Promise<Response>;
let _handler: { GET: RouteHandler; POST: RouteHandler } | null = null;
let _initError: string | null = null;

async function getHandler() {
    if (_initError) return null;
    if (!_handler) {
        try {
            const { makeRouteHandler } = await import('@keystatic/next/route-handler');
            const { default: config } = await import('../../../../../keystatic.config');
            _handler = makeRouteHandler({ config }) as unknown as { GET: RouteHandler; POST: RouteHandler };
        } catch (err) {
            _initError = err instanceof Error ? err.message : String(err);
            return null;
        }
    }
    return _handler;
}

function errorResponse() {
    return NextResponse.json(
        {
            error: 'Keystatic GitHub mode not configured',
            details: _initError,
            setup: 'Set KEYSTATIC_GITHUB_CLIENT_ID, KEYSTATIC_GITHUB_CLIENT_SECRET, and KEYSTATIC_SECRET as secrets in the Cloudflare dashboard, then redeploy.',
        },
        { status: 503 }
    );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    if (!h) return errorResponse();
    return h.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ params: string[] }> }) {
    const h = await getHandler();
    if (!h) return errorResponse();
    return h.POST(req, ctx);
}
