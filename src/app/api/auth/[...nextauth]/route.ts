import type { NextRequest } from "next/server"
import { handlers } from "@/auth"
import { logger } from "@/lib/logger"
import { detectBrowserEnv } from "@/domain/inAppBrowser"

export const runtime = "edge"
export const { GET } = handlers

// Log every Google sign-in start with the browser it came from. A sign-in
// Google refuses (in-app browsers) never reaches our callback, so without this
// line a vanished sign-in leaves no server-side trace at all (2026-10-08).
export async function POST(req: NextRequest) {
    if (new URL(req.url).pathname.endsWith("/signin/google")) {
        const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? ""
        const { inApp, os } = detectBrowserEnv(userAgent)
        logger.info("Google sign-in started", { inApp, os, userAgent })
    }
    return handlers.POST(req)
}
