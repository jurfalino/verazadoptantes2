import * as schema from "./schema";

// Creates a D1 drizzle instance. Uses dynamic import to ensure
// the drizzle-orm/d1 module is only loaded when actually needed.
export const createDb = async (d1: D1Database) => {
    console.log("[DB] createDb called with D1 binding");
    const { drizzle } = await import("drizzle-orm/d1");
    return drizzle(d1, { schema });
};
