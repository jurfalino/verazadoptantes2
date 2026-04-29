import * as schema from "./schema";

// Cache the local DB instance to prevent creating new connections per request
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLocalDb: any = null;

export const createLocalDb = async (path: string) => {
    if (cachedLocalDb) return cachedLocalDb;

    try {
        const p = await import('path');
        const dbPath = p.resolve(process.cwd(), path);

        const Database = (await import("better-sqlite3")).default;
        const { drizzle } = await import("drizzle-orm/better-sqlite3");

        const sqlite = new Database(dbPath);
        cachedLocalDb = drizzle(sqlite, { schema });
        return cachedLocalDb;
    } catch (e) {
        const { logger } = await import('@/lib/logger');
        logger.error("Local DB Create Error", { error: e instanceof Error ? e.message : String(e) });
        return undefined;
    }
};
