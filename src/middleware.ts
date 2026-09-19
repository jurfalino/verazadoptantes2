import { NextRequest, NextResponse } from "next/server";
import { DEPLOYMENT_SKEW_SENTINEL } from "@/domain/clientErrors";
import { decideSkew, parseDeployMap } from "@/domain/deploySkew";

// Build id → deployment URL for recent deployments, baked in by CI
// (scripts/build-deploy-map.mjs). Parsed once per isolate; only our own Pages
// deployment URLs survive parsing, so a forwarding target is never caller-chosen.
const DEPLOY_MAP = parseDeployMap(process.env.APP_DEPLOY_MAP, process.env.APP_DEPLOY_MAP_ALLOW_LOCAL === '1');

/**
 * Re-issue an old tab's request against the deployment it was loaded from.
 * `x-forwarded-host` must carry the public host: Next's server-action origin
 * check compares it with the browser's Origin, and without it the old
 * deployment answers 500 (verified against production 2026-09-19).
 */
async function forwardToDeployment(req: NextRequest, origin: string, buildId: string): Promise<NextResponse | null> {
    try {
        const target = new URL(req.nextUrl.pathname + req.nextUrl.search, origin);
        // A path like `//evil.com/x` or `/\evil.com` resolves to ANOTHER HOST.
        // Without this check the forwarder is an open proxy (pre-production
        // review of 2.56.68). The target must be exactly the mapped deployment.
        if (target.origin !== origin) return null;
        const headers = new Headers(req.headers);
        headers.set('x-forwarded-host', req.headers.get('host') || req.nextUrl.host);
        headers.set('x-skew-proxied', '1');
        headers.delete('host');
        headers.delete('content-length');
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const res = await fetch(target, {
            method: req.method,
            headers,
            body: hasBody ? await req.arrayBuffer() : undefined,
            redirect: 'manual',
            // A hung old deployment must not hang the user's save.
            signal: AbortSignal.timeout(10_000),
        });
        // Only an action result is worth returning. A deleted deployment, a
        // Cloudflare error page or a redirect to the old pages.dev host is not:
        // fall back to the 409, whose notice at least explains what to do.
        const isActionResult = (res.headers.get('content-type') || '').startsWith('text/x-component');
        if (!isActionResult && (res.status >= 300)) return null;
        const out = new Headers(res.headers);
        // fetch already decoded the body; these would now describe the wrong bytes.
        out.delete('content-encoding');
        out.delete('content-length');
        out.set('x-deployment-skew-proxied', buildId);
        return new NextResponse(res.body, { status: res.status, headers: out });
    } catch {
        return null;
    }
}

// Canonical domain mapping: redirect .pages.dev URLs to custom domains
const DOMAIN_REDIRECTS: Record<string, string> = {
    'verazadoptantes2.pages.dev': 'https://buenadoptante.org',
    'staging.verazadoptantes2.pages.dev': 'https://staging.buenadoptante.org',
};

const PROTECTED_ROUTES = ['/my-animals', '/my-adopters', '/my-adoptions', '/settings', '/admin'];

export default async function middleware(req: NextRequest) {
    // 0. Deployment skew. `deploymentId` in next.config.ts makes the client send
    //    its build id on server-action and RSC-navigation requests. Next 15.1.6
    //    never compares it — that is left to the host, and Cloudflare Pages does
    //    not do it, so an action id the running build no longer knows is simply
    //    answered with 200 + HTML. Next's client reads any non-RSC response under
    //    status 400 as an action that succeeded and returned nothing, so reads
    //    hand back `undefined` and writes silently do nothing (errorId 3d84fc1c).
    //
    //    What happens next is decided in src/domain/deploySkew.ts:
    //      - a save or search from a recent build is SERVED BY THAT BUILD'S own
    //        deployment, so the person notices nothing (v2.56.68);
    //      - a page navigation is rejected with 409, which Next turns into a
    //        full browser navigation — the tab upgrades itself silently;
    //      - an action from a build too old to be in the map is rejected too,
    //        and the browser shows the "new version" notice (never a reload).
    //
    //    Both sides must be known before any of this can mean anything: no
    //    header (an older client, a non-Next caller) or no build id (local dev)
    //    means we cannot tell, so the request passes through.
    const clientBuildId = req.headers.get('x-deployment-id');
    const serverBuildId = process.env.APP_BUILD_ID;
    const decision = decideSkew({
        clientBuildId,
        serverBuildId,
        // Server actions are always POST; nothing else is ever forwarded.
        isServerAction: req.method === 'POST' && req.headers.has('next-action'),
        alreadyProxied: req.headers.has('x-skew-proxied'),
        map: DEPLOY_MAP,
    });

    // An old tab's save or search: serve it from the deployment the tab was loaded
    // from, so the person notices nothing (v2.56.68 — see src/domain/deploySkew.ts).
    if (decision.kind === 'proxy') {
        const proxied = await forwardToDeployment(req, decision.origin, clientBuildId as string);
        if (proxied) return proxied;
        // Old deployment unreachable: fall through to the 409 and its notice.
    }

    if (decision.kind !== 'pass') {
        return new NextResponse(DEPLOYMENT_SKEW_SENTINEL, {
            status: 409,
            headers: {
                // EXACTLY 'text/plain' — Next surfaces the body as the error
                // message only on an exact match (pinned in middleware.test.ts).
                'content-type': 'text/plain',
                // Lets the browser recognise the rejection from the response
                // alone, whatever a caller's catch block does with the error
                // (StaleDeployWatcher), and records which build answered.
                'x-deployment-skew': '1',
                'x-deployment-id-server': serverBuildId as string,
            },
        });
    }

    // 1. Domain redirect — no auth needed, return immediately
    const host = req.headers.get('host') || '';
    const canonicalOrigin = DOMAIN_REDIRECTS[host];
    if (canonicalOrigin) {
        const url = new URL(req.url);
        return NextResponse.redirect(
            `${canonicalOrigin}${url.pathname}${url.search}`,
            301
        );
    }

    // 2. Auth check only for protected routes — skipped entirely for public pages
    //    (cold-start optimization: NextAuth is not loaded for anonymous traffic)
    const { nextUrl } = req;
    const isProtected = PROTECTED_ROUTES.some(p => nextUrl.pathname.startsWith(p));

    if (isProtected) {
        const { auth } = await import('@/auth');
        const { REQUIRED_SESSION_VERSION } = await import('@/auth.config');
        const session = await auth();

        // Redirect to sign-in if unauthenticated or session version is stale
        const ver = (session as unknown as { sessionVersion?: number })?.sessionVersion;
        if (!session || !ver || ver < REQUIRED_SESSION_VERSION) {
            const callbackUrl = encodeURIComponent(nextUrl.pathname + nextUrl.search);
            return NextResponse.redirect(
                new URL(`/?callbackUrl=${callbackUrl}&authRequired=true`, nextUrl.origin)
            );
        }
    }

    return NextResponse.next();
}

// Run middleware on all routes except static assets and auth API routes
export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons|sw\\.js|offline|workbox-).*)"
    ]
};
