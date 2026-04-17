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
    
    console.log('[Global Setup] Initializing database environments...');
    
    // Ensure Wrangler DB directory exists by running a dummy query
    try {
        execSync(`npx wrangler d1 execute DB --local --command="SELECT 1"`, {
            cwd: rootDir,
            stdio: 'ignore'
        });
    } catch {
        // Ignore errors, we just want to ensure the .wrangler state folder exists
    }

    const localDbPath = path.resolve(rootDir, 'local.db');
    let wranglerDbPath: string | null = null;
    
    const wranglerDir = path.resolve(rootDir, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
    if (fs.existsSync(wranglerDir)) {
        const sqliteFiles = fs.readdirSync(wranglerDir).filter(f => f.endsWith('.sqlite'));
        if (sqliteFiles.length > 0) {
            wranglerDbPath = path.join(wranglerDir, sqliteFiles[0]);
        }
    }
    
    const dbPaths = [localDbPath];
    if (wranglerDbPath) {
        dbPaths.push(wranglerDbPath);
    } else {
        console.warn('[Global Setup] Warning: Could not locate Wrangler sqlite DB. Edge runtime tests may fail.');
    }

    try {
        const Database = require('better-sqlite3');
        
        // Prepare SQL arrays to execute
        const drizzleDir = path.resolve(rootDir, 'drizzle');
        const schemaStatements: string[] = [];
        
        if (fs.existsSync(drizzleDir)) {
            const migrations = fs.readdirSync(drizzleDir)
                .filter(f => f.endsWith('.sql'))
                .sort();
            for (const migration of migrations) {
                const sql = fs.readFileSync(path.join(drizzleDir, migration), 'utf-8');
                sql.split(';')
                   .map(s => s.trim())
                   .filter(s => s.length > 0 && !s.startsWith('--'))
                   .forEach(s => schemaStatements.push(s));
            }
        }

        const seedSql = fs.readFileSync(seedFile, 'utf-8');
        const seedStatements = seedSql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const dbPath of dbPaths) {
            console.log(`[Global Setup] Seeding database at: ${path.basename(dbPath)}...`);
            const db = new Database(dbPath);
            
            // 1. Apply Schemas (Ignore constraints/duplicate column collisions safely)
            for (const stmt of schemaStatements) {
                try {
                    db.exec(stmt + ';');
                } catch {
                    // Collision (duplicate column/table) from merged migrations -> safely ignore
                }
            }
            
            // 2. Apply Seed Data
            let seedSuccessCount = 0;
            let seedFailCount = 0;
            for (const stmt of seedStatements) {
                try {
                    db.exec(stmt + ';');
                    seedSuccessCount++;
                } catch (e) {
                    seedFailCount++;
                }
            }
            
            db.close();
            console.log(`[Global Setup] DB Seed Complete: ${seedSuccessCount} injected, ${seedFailCount} dropped (${path.basename(dbPath)}).`);
        }
    } catch (error) {
        console.error('[Global Setup] Failed to run database setup routines:', error);
    }
}
