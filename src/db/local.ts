import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

export const createLocalDb = (path: string) => {
    const sqlite = new Database(path);
    return drizzle(sqlite, { schema });
};
