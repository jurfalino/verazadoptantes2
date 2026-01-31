import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { eq } from "drizzle-orm"
import { users } from "./db/schema"

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
    // We are skipping adapter for Edge to avoid complexity, relying on JWT.
    // DrizzleAdapter requires a db instance synchronouslyish or passed in.
    // If we need it, we'd need to init it.
    if (process.env.NODE_ENV === 'development') {
        try {
            const Database = require("better-sqlite3");
            const { drizzle } = require("drizzle-orm/better-sqlite3");
            const schema = require("./db/schema");
            const sqlite = new Database("local.db");
            const db = drizzle(sqlite, { schema });
            return DrizzleAdapter(db);
        } catch (e) { return undefined; }
    }
    return undefined;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        ...authConfig.providers,
        Credentials({
            name: "Direct Login",
            credentials: {
                email: { label: "Email", type: "email" }
            },
            authorize: async (credentials) => {
                const email = credentials.email as string;
                if (!email) return null;

                const db = await getDb();
                if (!db) return null; // Should not happen if env is set

                // Check if user exists
                // @ts-ignore
                const existingUser = await db.query.users.findFirst({
                    where: eq(users.email, email)
                });

                if (existingUser) {
                    return existingUser;
                }

                // Create new user (Simulated "Signup")
                const newUser = {
                    id: crypto.randomUUID(),
                    email: email,
                    name: email.split('@')[0], // Default name
                    emailVerified: new Date(),
                    image: null
                };

                await db.insert(users).values(newUser);
                return newUser;
            }
        }),
    ],
    adapter: getAdapter(),
    session: {
        strategy: "jwt", // Credentials provider requires strategy: 'jwt'
    },
})
