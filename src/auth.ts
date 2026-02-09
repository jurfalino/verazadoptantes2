import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { eq } from "drizzle-orm"
import { users } from "./db/schema"
import Resend from "next-auth/providers/resend"

import { getRequestContext } from "@cloudflare/next-on-pages";

async function getDb() {
    // 1. Try Cloudflare D1 (Production/Edge)
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            const { drizzle } = await import("drizzle-orm/d1");
            const schema = await import("./db/schema");
            return drizzle(env.DB, { schema });
        }
    } catch (e) {
        // Ignore error, likely running locally or during build
    }

    // 2. Fallback to Local SQLite (Development)
    if (process.env.NODE_ENV === 'development' || process.env.NEXT_RUNTIME === 'nodejs') {
        try {
            const Database = require("better-sqlite3");
            const { drizzle } = require("drizzle-orm/better-sqlite3");
            const schema = require("./db/schema");
            const sqlite = new Database("local.db");
            return drizzle(sqlite, { schema });
        } catch (e) {
            console.warn("Local DB init failed:", e);
        }
    }
    return null;
}

// Adapter is not easily supported in Edge with Drizzle currently due to sync requirements?
// For now, return undefined for Edge to rely on JWT strategy fully.
// Or if possible, we could try to get it, but it might be async.
function getAdapter() {
    // DrizzleAdapter is REQUIRED for Resend (Email) provider to store verification tokens.
    // In local/Node.js environments, use better-sqlite3.
    // In Edge/Cloudflare, the adapter would need async init (not supported here), so we skip.
    try {
        // Check if we're in a Node.js environment where better-sqlite3 works
        if (typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
            const Database = require("better-sqlite3");
            const { drizzle } = require("drizzle-orm/better-sqlite3");
            const schema = require("./db/schema");
            const sqlite = new Database("local.db");
            const db = drizzle(sqlite, { schema });
            console.log("[Auth] DrizzleAdapter initialized successfully");
            return DrizzleAdapter(db);
        }
    } catch (e) {
        console.warn("[Auth] Adapter init failed:", e);
    }
    // Return undefined for Edge - Resend won't work there without async adapter support
    return undefined;
}

// Bump this number and deploy to force all users to re-authenticate.
// Old JWT tokens with a lower version will be rejected — zero runtime cost.
const REQUIRED_SESSION_VERSION = 2;

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        ...authConfig.providers,
        // Resend (Magic Links) requires adapter in all environments - not compatible with Edge/RSC.
        // Using Credentials provider instead for simpler direct login.
        Credentials({
            name: "Direct Login",
            credentials: {
                email: { label: "Email", type: "email" }
            },
            authorize: async (credentials) => {
                const email = credentials?.email as string;
                if (!email) return null;

                const db = await getDb();
                if (!db) {
                    // If no DB, create a simple user object (anonymous-ish)
                    return {
                        id: crypto.randomUUID(),
                        email: email,
                        name: email.split('@')[0],
                    };
                }

                // Check if user exists
                const existingUser = await db.query.users.findFirst({
                    where: eq(users.email, email)
                });

                if (existingUser) {
                    return existingUser;
                }

                // Create new user
                const newUser = {
                    id: crypto.randomUUID(),
                    email: email,
                    name: email.split('@')[0],
                    emailVerified: new Date(),
                    image: null
                };

                await db.insert(users).values(newUser);
                return newUser;
            }
        }),
    ],
    callbacks: {
        ...authConfig.callbacks,
        jwt: async ({ token, trigger }) => {
            // Stamp new tokens with the current required version
            if (trigger === 'signIn') {
                token.sessionVersion = REQUIRED_SESSION_VERSION;
            }
            return token;
        },
        authorized: async ({ auth: session }) => {
            if (!session) return false;
            // Reject tokens without a version or with an outdated version
            const tokenVersion = (session as unknown as { sessionVersion?: number }).sessionVersion;
            if (!tokenVersion || tokenVersion < REQUIRED_SESSION_VERSION) return false;
            return true;
        },
        session: async ({ session, token }) => {
            (session as unknown as { sessionVersion: number }).sessionVersion = token.sessionVersion as number;
            return session;
        },
    },
    adapter: getAdapter(),
    session: {
        strategy: "jwt", // Credentials provider requires JWT strategy
        maxAge: 315360000, // 10 years (effectively "never" expire)
    },
})

