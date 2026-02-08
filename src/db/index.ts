import * as schema from "./schema";

// Cache Drizzle instances per D1 binding to prevent memory leaks.
// Without caching, every getDb() call creates a new Drizzle instance
// (10+ per page load), which accumulates in memory and causes OOM.
const dbCache = new WeakMap<D1Database, ReturnType<typeof import("drizzle-orm/d1")["drizzle"]>>();

export const createDb = async (d1: D1Database) => {
    const cached = dbCache.get(d1);
    if (cached) return cached;

    const { drizzle } = await import("drizzle-orm/d1");
    const db = drizzle(d1, { schema });
    dbCache.set(d1, db);
    return db;
};
