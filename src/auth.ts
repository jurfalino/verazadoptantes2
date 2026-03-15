import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { REQUIRED_SESSION_VERSION } from "./auth.config";
import { SESSION_MAX_AGE_SECONDS } from "./config/constants";
import { getDb } from "@/lib/db";
import { users, userProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    callbacks: {
        ...authConfig.callbacks,
        jwt: async ({ token, trigger }) => {
            if (trigger === 'signIn') {
                token.sessionVersion = REQUIRED_SESSION_VERSION;
            }
            // Always resolve canonical user ID and admin role from DB when we have email,
            // so every request (including form-results, client nav, etc.) gets correct isAdmin
            // and sub, even if the JWT was issued before we added this or claims were missing.
            if (token.email) {
                let row: { id: string; role: string | null } | undefined;

                try {
                    const { getRequestContext } = await import('@cloudflare/next-on-pages');
                    const { env } = getRequestContext();
                    if (env?.DB) {
                        const r = await env.DB.prepare(
                            `SELECT u.id, COALESCE(up.role, 'viewer') as role
                             FROM user u
                             LEFT JOIN user_profiles up ON up.user_id = u.id
                             WHERE u.email = ? LIMIT 1`
                        ).bind(token.email).first<{ id: string; role: string }>();
                        row = r ?? undefined;
                    }
                } catch {
                    // Edge context unavailable (e.g., local dev) — use getDb() and Drizzle
                }

                if (!row) {
                    try {
                        const db = await getDb();
                        if (db) {
                            const u = await db
                                .select({
                                    id: users.id,
                                    role: userProfiles.role,
                                })
                                .from(users)
                                .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
                                .where(eq(users.email, token.email as string))
                                .limit(1)
                                .then(rows => rows[0]);
                            if (u) row = { id: u.id, role: u.role ?? 'viewer' };
                        }
                    } catch {
                        // ignore
                    }
                }

                if (row) {
                    token.sub = row.id;
                    token.isAdmin = row.role === 'admin';

                    // One-time geo backfill: capture CF location headers for existing sessions
                    // that never triggered ensureUserProfile since we added geo columns.
                    // Runs once per session lifetime via the geoBackfilled flag.
                    if (!token.geoBackfilled) {
                        try {
                            const { headers: getHeaders } = await import('next/headers');
                            const h = await getHeaders();
                            const province = h.get('cf-region') || null;
                            const provinceCode = h.get('cf-region-code') || null;
                            const city = h.get('cf-ipcity') || null;
                            const tz = h.get('cf-timezone') || null;

                            if (province || city || tz) {
                                try {
                                    const { getRequestContext: grc } = await import('@cloudflare/next-on-pages');
                                    const { env: e } = grc();
                                    if (e?.DB) {
                                        await e.DB.prepare(
                                            `UPDATE user_profiles SET
                                                province = COALESCE(province, ?),
                                                province_code = COALESCE(province_code, ?),
                                                city = COALESCE(city, ?),
                                                timezone = COALESCE(timezone, ?)
                                             WHERE user_id = ?`
                                        ).bind(province, provinceCode, city, tz, row.id).run();
                                    }
                                } catch { /* D1 unavailable */ }
                            }
                            token.geoBackfilled = true;
                        } catch { /* headers() unavailable */ }
                    }
                }
            }
            return token;
        },
        session: async ({ session, token }) => {
            // Expose sessionVersion so the authorized middleware callback can check it
            (session as unknown as { sessionVersion: number }).sessionVersion = (token.sessionVersion as number) || 0;
            // Always expose user.id and isAdmin when session.user exists (so layout + SessionProvider + useSession get them)
            // session.user is frozen by NextAuth v5 — must spread, not mutate
            if (session.user) {
                (session as any).user = {
                    ...session.user,
                    id: token.sub ?? (session.user as { id?: string }).id,
                    isAdmin: !!(token.isAdmin),
                };
            }
            return session;
        },
    },
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE_SECONDS,
    },
})
