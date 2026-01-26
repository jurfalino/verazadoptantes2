import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Helper to determine if we are running in a Cloudflare Worker/Pages environment
// or locally with better-sqlite3 for quick testing (optional, but good for robust dev)

// For this MVP, we will assume standard D1 usage via context if possible, 
// or let the calling code pass the DB instance. 
// However, server actions in Next.js on Cloudflare need the bindings.

// We'll export a helper to get the DB instance from the request context or proxy.
// But Next.js Server Actions don't easily access Cloudflare bindings directly without setup.
// We'll use the recommended `getRequestContext` from `@cloudflare/next-on-pages` if available,
// or fallback to a setup that works.

// Actually, the easiest way for now is to rely on `process.env.DB` if we are using `wrangler dev` 
// but Next.js App Router + Cloudflare setup can be tricky.
// Let's standardise on passing the D1Database binding to the drizzle helper function.

export const createDb = (d1: D1Database) => {
    return drizzle(d1, { schema });
};


