import * as schema from "./schema";

export const createLocalDb = async (path: string) => {
    const { default: Database } = await import("better-sqlite3");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const sqlite = new Database(path);
    return drizzle(sqlite, { schema });
};
