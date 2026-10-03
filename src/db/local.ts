import * as schema from "./schema";

// Cache the local DB instances to prevent creating new connections per request.
// The read-only one serves "view as" requests (src/lib/readOnlyGuard.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cachedLocalDbs: { readWrite: any; readOnly: any } = { readWrite: null, readOnly: null };

export const createLocalDb = async (path: string, { readOnly = false }: { readOnly?: boolean } = {}) => {
    const slot = readOnly ? 'readOnly' : 'readWrite';
    if (cachedLocalDbs[slot]) return cachedLocalDbs[slot];

    try {
        const p = await import('path');
        const dbPath = p.resolve(process.cwd(), path);

        const Database = (await import("better-sqlite3")).default;
        const { drizzle } = await import("drizzle-orm/better-sqlite3");

        const sqlite = new Database(dbPath, { readonly: readOnly });
        cachedLocalDbs[slot] = drizzle(sqlite, { schema });
        return cachedLocalDbs[slot];
    } catch (e) {
        const { logger } = await import('@/lib/logger');
        logger.error("Local DB Create Error", { error: e instanceof Error ? e.message : String(e) });
        return undefined;
    }
};
