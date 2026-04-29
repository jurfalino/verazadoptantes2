import { NextRequest, NextResponse } from "next/server";

// Canonical domain mapping: redirect .pages.dev URLs to custom domains
const DOMAIN_REDIRECTS: Record<string, string> = {
    'verazadoptantes2.pages.dev': 'https://buenadoptante.org',
    'staging.verazadoptantes2.pages.dev': 'https://staging.buenadoptante.org',
};

const PROTECTED_ROUTES = ['/my-animals', '/my-adopters', '/my-adoptions', '/settings', '/admin'];

export default async function middleware(req: NextRequest) {
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
