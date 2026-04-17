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
        // Apply schemas first - file by file to catch and bypass duplicate column errors safely
        const drizzleDir = path.resolve(rootDir, 'drizzle');
        if (fs.existsSync(drizzleDir)) {
            const migrations = fs.readdirSync(drizzleDir)
                .filter(f => f.endsWith('.sql'))
                .sort();
            for (const migration of migrations) {
                try {
                    // Ignore stdout/stderr to avoid polluting test logs with expected collision warnings
                    execSync(`npx wrangler d1 execute DB --local --file="drizzle/${migration}"`, {
                        cwd: rootDir,
                        stdio: 'ignore',
                    });
                } catch (e) {
                    // Collision (duplicate column/table) from merged migrations -> safely ignore
                }
            }
        }
        
        // Inject test data
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

        // Apply all migrations first — run each statement individually
        // so that one failure (e.g. "table already exists") doesn't block later migrations
        const drizzleDir = path.resolve(rootDir, 'drizzle');
        if (fs.existsSync(drizzleDir)) {
            const migrations = fs.readdirSync(drizzleDir)
                .filter(f => f.endsWith('.sql'))
                .sort();
            for (const migration of migrations) {
                const sql = fs.readFileSync(path.join(drizzleDir, migration), 'utf-8');
                // Split into individual statements and run each one
                const statements = sql.split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0 && !s.startsWith('--'));
                for (const stmt of statements) {
                    try { db.exec(stmt + ';'); } catch { /* column/table already exists — OK */ }
                }
            }
        }

        // Apply seed data — also per-statement to handle partial schema issues
        const seedSql = fs.readFileSync(seedFile, 'utf-8');
        const seedStatements = seedSql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));
        let seedSuccessCount = 0;
        let seedFailCount = 0;
        for (const stmt of seedStatements) {
            try {
                db.exec(stmt + ';');
                seedSuccessCount++;
            } catch (e) {
                seedFailCount++;
                console.warn(`[Global Setup] Seed statement failed: ${(e as Error).message.slice(0, 100)}`);
            }
        }
        db.close();
        console.log(`[Global Setup] local.db seed complete: ${seedSuccessCount} ok, ${seedFailCount} failed.`);
    } catch (error) {
        console.error('[Global Setup] local.db seed failed (better-sqlite3 may not be available):', error);
    }
}
