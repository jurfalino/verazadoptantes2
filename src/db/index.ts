import * as schema from "./schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type DbType = DrizzleD1Database<typeof schema>;

// Cache Drizzle instances per D1 binding to prevent memory leaks.
// Without caching, every getDb() call creates a new Drizzle instance
// (10+ per page load), which accumulates in memory and causes OOM.
const dbCache = new WeakMap<D1Database, DbType>();

export const createDb = async (d1: D1Database): Promise<DbType> => {
    const cached = dbCache.get(d1);
    if (cached) return cached;

    const { drizzle } = await import("drizzle-orm/d1");
    const db = drizzle(d1, { schema }) as DbType;
    dbCache.set(d1, db);
    return db;
};
