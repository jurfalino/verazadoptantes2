import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { eq } from "drizzle-orm"
import { users } from "./db/schema"

function getDrizzleDb() {
    try {
        const Database = require("better-sqlite3");
        const { drizzle } = require("drizzle-orm/better-sqlite3");
        const schema = require("./db/schema");
        const sqlite = new Database("local.db");
        return drizzle(sqlite, { schema });
    } catch (e) {
        console.error("DB Init Error:", e);
        return null;
    }
}

function getAdapter() {
    // For local development, we use better-sqlite3 directly
    const db = getDrizzleDb();
    if (db) {
        // @ts-ignore - Adapter type mismatch issues are common but harmless here
        return DrizzleAdapter(db);
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

                const db = getDrizzleDb();
                if (!db) return null; // Should not happen in local dev

                // Check if user exists
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
