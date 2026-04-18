import { auth } from "@/auth"
import { NextResponse } from "next/server"

// Canonical domain mapping: redirect .pages.dev URLs to custom domains
const DOMAIN_REDIRECTS: Record<string, string> = {
    'verazadoptantes2.pages.dev': 'https://buenadoptante.org',
    'staging.verazadoptantes2.pages.dev': 'https://staging.buenadoptante.org',
};

export default auth((req) => {
    const host = req.headers.get('host') || '';

    // Redirect .pages.dev to canonical custom domain (preserving path + query)
    const canonicalOrigin = DOMAIN_REDIRECTS[host];
    if (canonicalOrigin) {
        const url = new URL(req.url);
        return NextResponse.redirect(
            `${canonicalOrigin}${url.pathname}${url.search}`,
            301
        );
    }

    // Default: let auth middleware handle the rest (session version check, etc.)
});

// Run middleware on all routes except static assets, API routes, and auth routes
export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons|sw\\.js|offline|workbox-).*)"
    ]
}
