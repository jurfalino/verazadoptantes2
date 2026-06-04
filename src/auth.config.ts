import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { logger } from "@/lib/logger"
import { logAudit, ensureUserProfile } from "@/lib/audit"
import { isAdminAsync } from "@/config/admins"
import { checkAdopterLoginGate } from "@/lib/adopterLoginGate"
import { recordBlockedLogin } from "@/lib/blockedLoginRecorder"

// Bump this number and deploy to force all users to re-authenticate.
// Exported so auth.ts can use the same value.
// The adopter-login gate (v2.14.9-14) intentionally does NOT bump this —
// existing legit rescuers stay signed in; the gate only runs on fresh
// sign-ins. Bump manually if/when the gate's posture changes and we want
// to re-run it across the current user base.
export const REQUIRED_SESSION_VERSION = 3;

export const authConfig = {
    providers: [
        Google,
        // Dev-only credentials login — accepts any email, never ships to production
        ...(process.env.NODE_ENV !== 'production' ? [
            Credentials({
                id: 'dev-login',
                name: 'Dev Login',
                credentials: {
                    email: { label: "Email", type: "email", placeholder: "test@example.com" },
                },
                async authorize(credentials) {
                    const email = credentials?.email as string | undefined;
                    if (!email) return null;
                    return {
                        id: email,
                        email: email,
                        name: `Dev (${email})`,
                    };
                },
            })
        ] : []),
    ],
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
            // Adopter-login gate (v2.14.9-14): if the signing-in email matches
            // an adopter profile with a low rating or density flags, reject
            // the session. Admins are always allowed (bootstrap list); the
            // gate fails open on DB errors. See src/lib/adopterLoginGate.ts
            // for the full contract.
            const email = user.email || '';
            // Bypass admins so the gate never blocks them. Uses the async
            // check so DB-grant admins (user_profiles.role='admin') are
            // honored, not just BOOTSTRAP_ADMIN_EMAILS — sync isAdmin missed
            // every admin granted via /admin/users, causing intermittent
            // /auth-error redirects when their email also lived in some
            // adopter's contactInfo (v2.17.1). Mirrors the v2.16.0-32 sweep
            // that fixed the same bug on every admin API route.
            if (email && !await isAdminAsync(email)) {
                try {
                    const gate = await checkAdopterLoginGate(email);
                    if (gate.blocked) {
                        // Audit row + notifications + Axiom log live in
                        // recordBlockedLogin so this callback stays terse.
                        await recordBlockedLogin(email, gate).catch((e) => {
                            // Even if the recorder fails, we still reject the
                            // sign-in — the user MUST NOT get through.
                            logger.error('recordBlockedLogin failed (still rejecting login)', e, { email });
                        });
                        // Returning false rejects the session. NextAuth
                        // redirects to /auth-error which renders a generic
                        // "Ocurrió un error inesperado" page (configured
                        // below under `pages.error`).
                        return false;
                    }
                } catch (e) {
                    // Gate threw despite its internal try/catch — same fail-open
                    // posture as the gate itself.
                    logger.warn('adopter-login gate threw, failing open', { email, error: e instanceof Error ? e.message : String(e) });
                }
            }

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
        // Generic error page — adopter-login-gate rejections land here.
        // Copy intentionally doesn't reveal the reason; see /auth-error.
        error: '/auth-error',
    },
} satisfies NextAuthConfig
