import * as schema from "./schema";

// Cache the local DB instance to prevent creating new connections per request
let cachedLocalDb: any = null;

export const createLocalDb = async (path: string) => {
    if (cachedLocalDb) return cachedLocalDb;

    try {
        const p = require('path');
        const dbPath = p.resolve(process.cwd(), path);

        const Database = require("better-sqlite3");
        const { drizzle } = require("drizzle-orm/better-sqlite3");

        const sqlite = new Database(dbPath);
        cachedLocalDb = drizzle(sqlite, { schema });
        return cachedLocalDb;
    } catch (e) {
        console.error("Local DB Create Error:", e);
        return undefined;
    }
};
