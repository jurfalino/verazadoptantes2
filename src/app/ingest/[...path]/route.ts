export const runtime = 'edge';

import { resolvePostHogTarget } from '@/lib/posthogProxy';
import { logger } from '@/lib/logger';

/**
 * Same-origin reverse proxy for PostHog ingestion and assets.
 *
 * Why this exists rather than a Next.js `rewrite`: `@cloudflare/next-on-pages`
 * was archived in September 2025, and external-destination rewrites on it once
 * silently dropped query parameters (cloudflare/next-on-pages#429). Fixed long
 * before our v1.13.16, but "ingestion breaks and looks like no data arrived" is
 * not a failure mode to build on an unmaintained adapter. A route handler owns
 * the forwarding explicitly and is covered by unit tests on the URL mapper.
 *
 * Cost, stated plainly: every session-replay batch is a Pages Function
 * invocation. Roughly 60-80 requests per 5-minute session. Accepted trade for
 * zero CSP changes and adblock resistance (spec decision D4a).
 */

async function proxy(request: Request, pathSegments: string[]): Promise<Response> {
    const search = new URL(request.url).search;
    const target = resolvePostHogTarget(pathSegments, search);

    // Rebuild headers rather than forwarding wholesale: `host` must reflect the
    // PostHog origin (fetch sets it from the URL, so we drop ours), and cookies
    // are first-party to buenadoptante.org and have no business at PostHog.
    const headers = new Headers();
    for (const [key, value] of request.headers) {
        const k = key.toLowerCase();
        if (k === 'host' || k === 'cookie' || k === 'content-length') continue;
        headers.set(key, value);
    }

    // Without this, PostHog geolocates every session to a Cloudflare edge IP,
    // because the proxy is the client as far as it can tell.
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set('x-forwarded-for', clientIp);

    // Decide once. Reading `request.body` in a condition can mark the stream
    // disturbed on some runtimes, and a body/duplex mismatch is the classic
    // "works in next dev, fails on Workers" bug.
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    try {
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: hasBody ? request.body : undefined,
            // `duplex: 'half'` is required by undici/workers whenever a request
            // body is streamed through, and invalid when there is none.
            ...(hasBody ? { duplex: 'half' } : {}),
        } as RequestInit);

        return new Response(upstream.body, {
            status: upstream.status,
            headers: upstream.headers,
        });
    } catch (e) {
        // Telemetry must never break the page. Log and return 204 so posthog-js
        // treats the batch as delivered rather than retrying in a hot loop.
        logger.warn('posthog proxy: upstream fetch failed', {
            target,
            method: request.method,
            error: e instanceof Error ? e.message : String(e),
        });
        return new Response(null, { status: 204 });
    }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}

export async function OPTIONS(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
    return proxy(request, (await ctx.params).path);
}
