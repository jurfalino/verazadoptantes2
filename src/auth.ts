import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { REQUIRED_SESSION_VERSION } from "./auth.config";
import { SESSION_MAX_AGE_SECONDS } from "./config/constants";

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    callbacks: {
        ...authConfig.callbacks,
        jwt: async ({ token, trigger }) => {
            if (trigger === 'signIn') {
                token.sessionVersion = REQUIRED_SESSION_VERSION;

                // Resolve canonical user ID and admin role from DB
                // JWT strategy generates a new random sub on each sign-in,
                // so we look up by email to find the persisted user record.
                if (token.email) {
                    try {
                        const { getRequestContext } = await import('@cloudflare/next-on-pages');
                        const { env } = getRequestContext();
                        if (env?.DB) {
                            const row = await env.DB.prepare(
                                `SELECT u.id, COALESCE(up.role, 'viewer') as role
                                 FROM user u
                                 LEFT JOIN user_profiles up ON up.user_id = u.id
                                 WHERE u.email = ? LIMIT 1`
                            ).bind(token.email).first<{ id: string; role: string }>();

                            if (row) {
                                token.sub = row.id; // Use canonical DB id, not random JWT id
                                token.isAdmin = row.role === 'admin';
                            }
                        }
                    } catch {
                        // Edge context unavailable (e.g., dev mode) — keep original token.sub
                    }
                }
            }
            return token;
        },
        session: async ({ session, token }) => {
            // Expose sessionVersion so the authorized middleware callback can check it
            (session as unknown as { sessionVersion: number }).sessionVersion = (token.sessionVersion as number) || 0;
            // Expose user.id (DB primary key / UUID) and isAdmin for client components
            // session.user is frozen by NextAuth v5 — must spread, not mutate
            if (token.sub && session.user) {
                (session as any).user = { ...session.user, id: token.sub, isAdmin: !!(token.isAdmin) };
            }
            return session;
        },
    },
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE_SECONDS,
    },
})
