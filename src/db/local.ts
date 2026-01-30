import * as schema from "./schema";

export const createLocalDb = async (path: string) => {
    try {
        console.log("[DB] createLocalDb called with", path);
        const p = require('path');
        const dbPath = p.resolve(process.cwd(), path);
        console.log("[DB] Resolved path:", dbPath);

        const Database = require("better-sqlite3");
        const { drizzle } = require("drizzle-orm/better-sqlite3");

        console.log("[DB] Opening SQLite connection...");
        const sqlite = new Database(dbPath);
        console.log("[DB] Connection opened");

        return drizzle(sqlite, { schema });
    } catch (e) {
        console.error("Local DB Create Error:", e);
        return undefined;
    }
};
