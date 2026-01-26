import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const createLocalDb = (path: string) => {
    const Database = require("better-sqlite3");
    const sqlite = new Database(path);
    return drizzle(sqlite, { schema });
};
