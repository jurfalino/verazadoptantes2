import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { logger } from "@/lib/logger"
import { logAudit, ensureUserProfile } from "@/lib/audit"

export const authConfig = {
    providers: [Google],
    callbacks: {
        authorized: async ({ auth }) => {
            // Logged in users are authenticated, otherwise false
            return !!auth
        },
        signIn: async ({ user, account }) => {
            logger.info('User signed in', {
                userId: user.id,
                email: user.email,
                provider: account?.provider
            });
            // Track user profile (first sign date + last activity)
            if (user.id) {
                ensureUserProfile(user.id, user.email || undefined, user.name || undefined, user.image || undefined);
            }
            // Audit log
            logAudit({
                userId: user.id,
                userEmail: user.email || undefined,
                action: 'sign_in',
                details: { provider: account?.provider }
            });
            return true;
        },
    },
    trustHost: true,
} satisfies NextAuthConfig
