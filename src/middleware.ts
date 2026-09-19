import { NextRequest, NextResponse } from "next/server";
import { DEPLOYMENT_SKEW_SENTINEL } from "@/domain/clientErrors";

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
    //    Rejecting the request converts that into two recoveries, both handled by
    //    the framework or by resolveErrorId:
    //      - an RSC navigation falls back to a full browser navigation, which
    //        lands the user on the current build with no error at all;
    //      - an action throws with this body as its message, which
    //        resolveErrorId turns into a single reload.
    //
    //    Both sides must be known before this can mean anything: no header (an
    //    older client, a non-Next caller) or no build id (local dev, where
    //    APP_BUILD_ID is empty) means we cannot tell, so we let it through.
    const clientBuildId = req.headers.get('x-deployment-id');
    const serverBuildId = process.env.APP_BUILD_ID;
    if (clientBuildId && serverBuildId && clientBuildId !== serverBuildId) {
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
                'x-deployment-id-server': serverBuildId,
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
