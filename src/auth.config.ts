import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { eq } from "drizzle-orm"
import { logger } from "@/lib/logger"
import { logAudit, ensureUserProfile } from "@/lib/audit"
import { isAdminAsync } from "@/config/admins"
import { checkAdopterLoginGate } from "@/lib/adopterLoginGate"
import { recordBlockedLogin } from "@/lib/blockedLoginRecorder"
import { getDb } from "@/lib/db"
import { users } from "@/db/schema"
import { getFeatureFlag } from "@/config/features"
import { maskEmail } from "@/lib/dates"
import { normalizeOtpEmail, hashOtpCode, resolveAuthSecret } from "@/lib/otp"
import { findActiveOtp, tryConsumeAttempt, retireOtp, consumeOtp } from "@/lib/otpStore"

// Bump this number and deploy to force all users to re-authenticate.
// Exported so auth.ts can use the same value.
// The adopter-login gate (v2.14.9-14) intentionally does NOT bump this —
// existing legit rescuers stay signed in; the gate only runs on fresh
// sign-ins. Bump manually if/when the gate's posture changes and we want
// to re-run it across the current user base.
export const REQUIRED_SESSION_VERSION = 3;

export const authConfig = {
    providers: [
        // `prompt: 'select_account'` forces Google's account-chooser to render
        // on every sign-in (v2.17.3) — without it, if the browser already has
        // an active Google session, OAuth silently picks that account and the
        // user can't switch accounts or sign in as a different one. The user
        // experience after sign-out becomes "sign back in with the same
        // account, no choice." Adding `select_account` makes the standard
        // chooser appear: pick one of the currently-signed-in Google accounts,
        // or click "Use another account" to add a new one.
        Google({
            authorization: {
                params: {
                    prompt: 'select_account',
                },
            },
        }),
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
        // Email OTP login (ENABLE_EMAIL_OTP): verifies a 6-digit code issued
        // by the requestEmailOtp server action against the email_otp_codes
        // table. A Credentials provider (NOT a custom cookie-setting route) so
        // the sign-in flows through callbacks.signIn below — adopter-login
        // gate, blocked-login recording, ensureUserProfile, audit — exactly
        // like Google. Everything here must stay edge-safe: this file lands in
        // the middleware bundle via middleware.ts's dynamic import of @/auth.
        Credentials({
            id: 'email-otp',
            name: 'Email code',
            credentials: {
                email: { label: "Email", type: "email" },
                code: { label: "Code", type: "text" },
            },
            async authorize(credentials) {
                const email = normalizeOtpEmail((credentials?.email as string | undefined) || '');
                const code = (credentials?.code as string | undefined) || '';
                if (!email || !/^\d{6}$/.test(code)) return null;
                try {
                    // Defense in depth — the request action is the primary
                    // flag gate, but a stale outstanding code must not keep
                    // working after the feature is switched off.
                    if (!(await getFeatureFlag('ENABLE_EMAIL_OTP'))) return null;

                    const db = await getDb();
                    if (!db) {
                        logger.error('email-otp authorize: DB unavailable', undefined, { email: maskEmail(email) });
                        return null;
                    }

                    const now = new Date();
                    const active = await findActiveOtp(db, email);
                    if (!active || active.expiresAt.getTime() < now.getTime()) return null;

                    // Count the attempt BEFORE comparing — a wrong guess must
                    // spend budget even if the caller races parallel requests.
                    // The atomic `attempts < max` guard makes over-budget
                    // attempts fail here; retire the row so it stops matching
                    // findActiveOtp.
                    if (!await tryConsumeAttempt(db, active.id)) {
                        await retireOtp(db, active.id, now);
                        return null;
                    }

                    const hash = await hashOtpCode(code, resolveAuthSecret());
                    if (hash !== active.codeHash) return null;

                    // Single-use: losing the conditional consume means another
                    // request already used this code.
                    if (!await consumeOtp(db, active.id, now)) return null;

                    // Reuse the existing account for this email if there is
                    // one; otherwise mint an id for ensureUserProfile to
                    // insert. The jwt callback re-resolves the canonical id by
                    // email on every request either way.
                    const existing = await db
                        .select({ id: users.id })
                        .from(users)
                        .where(eq(users.email, email))
                        .limit(1);
                    return { id: existing[0]?.id ?? crypto.randomUUID(), email };
                } catch (e) {
                    logger.error('email-otp authorize failed', e, { email: maskEmail(email) });
                    return null;
                }
            },
        }),
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
            // Track user profile (first sign date + last activity). An OTP
            // sign-in is proof of inbox ownership — record emailVerified.
            if (user.id) {
                await ensureUserProfile(user.id, user.email || undefined, user.name || undefined, user.image || undefined, account?.provider === 'email-otp');
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
