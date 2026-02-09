export { auth as middleware } from "@/auth"

// Run middleware on all routes except static assets, API routes, and auth routes
export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons|sw\\.js|offline|workbox-).*)"
    ]
}
