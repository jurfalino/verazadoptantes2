import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { logger } from "@/lib/logger"
import { logAudit, ensureUserProfile } from "@/lib/audit"

// Bump this number and deploy to force all users to re-authenticate.
// Exported so auth.ts can use the same value.
export const REQUIRED_SESSION_VERSION = 3;

export const authConfig = {
    providers: [Google],
    callbacks: {
        authorized: async ({ auth }) => {
            if (!auth) return true; // Allow unauthenticated browsing
            // Reject stale sessions (missing or outdated version)
            const ver = (auth as unknown as { sessionVersion?: number }).sessionVersion;
            if (!ver || ver < REQUIRED_SESSION_VERSION) {
                return false; // Middleware will redirect to sign-in
            }
            return true;
        },
        signIn: async ({ user, account }) => {
            logger.info('User signed in', {
                userId: user.id,
                email: user.email,
                provider: account?.provider
            });
            // Track user profile (first sign date + last activity)
            if (user.id) {
                await ensureUserProfile(user.id, user.email || undefined, user.name || undefined, user.image || undefined);
            }
            // Audit log
            await logAudit({
                userId: user.id,
                userEmail: user.email || undefined,
                action: 'sign_in',
                details: { provider: account?.provider }
            });
            return true;
        },
    },
    trustHost: true,
    pages: {
        signIn: '/',
    },
} satisfies NextAuthConfig
