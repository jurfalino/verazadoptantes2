import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Playwright global setup — seeds the local D1 database with test data.
 * Runs once before all test files.
 *
 * Seeds two DB paths to cover both Cloudflare bindings (setupDevPlatform)
 * and the better-sqlite3 fallback (local.db).
 */
export default function globalSetup() {
    const seedFile = path.resolve(__dirname, 'seed.sql');
    const rootDir = path.resolve(__dirname, '..');

    // 1. Seed the Wrangler D1 local store (used when setupDevPlatform works)
    console.log('[Global Setup] Seeding Wrangler D1 local store...');
    try {
        execSync(`npx wrangler d1 execute DB --local --file="${seedFile}"`, {
            cwd: rootDir,
            stdio: 'inherit',
        });
        console.log('[Global Setup] Wrangler D1 seed complete.');
    } catch (error) {
        console.error('[Global Setup] Wrangler D1 seed failed:', error);
    }

    // 2. Seed the better-sqlite3 fallback (local.db) for when getRequestContext() fails
    console.log('[Global Setup] Seeding local.db fallback...');
    try {
        const localDbPath = path.resolve(rootDir, 'local.db');
        const Database = require('better-sqlite3');
        const db = new Database(localDbPath);

        // Apply all migrations first
        const drizzleDir = path.resolve(rootDir, 'drizzle');
        if (fs.existsSync(drizzleDir)) {
            const migrations = fs.readdirSync(drizzleDir)
                .filter(f => f.endsWith('.sql'))
                .sort();
            for (const migration of migrations) {
                const sql = fs.readFileSync(path.join(drizzleDir, migration), 'utf-8');
                try { db.exec(sql); } catch { /* table already exists */ }
            }
        }

        // Apply seed data
        const seedSql = fs.readFileSync(seedFile, 'utf-8');
        db.exec(seedSql);
        db.close();
        console.log('[Global Setup] local.db seed complete.');
    } catch (error) {
        console.error('[Global Setup] local.db seed failed (better-sqlite3 may not be available):', error);
    }
}
