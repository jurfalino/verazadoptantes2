const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Pre-WebServer Database initialization script for CI.
 * This script ensures the SQLite environments are generated and seeded BEFORE Miniflare
 * puts a lock on the database during Playwright's webServer instantiation.
 */

const seedFile = path.resolve(__dirname, '../tests/seed.sql');
const rootDir = path.resolve(__dirname, '..');

console.log('[Setup Test DB] Initializing database environments...');
try {
    execSync(`npx wrangler d1 execute DB --local --command="SELECT 1"`, {
        cwd: rootDir,
        stdio: 'ignore'
    });
} catch {
    // Ignore initialization errors
}

const localDbPath = path.resolve(rootDir, 'local.db');
let wranglerDbPath = null;

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
}

try {
    const Database = require('better-sqlite3');
    
    // Prepare SQL arrays to execute
    const drizzleDir = path.resolve(rootDir, 'drizzle');
    const schemaStatements = [];
    
    if (fs.existsSync(drizzleDir)) {
        const migrations = fs.readdirSync(drizzleDir)
            .filter(f => f.endsWith('.sql'))
            .sort();
        for (const migration of migrations) {
            const sql = fs.readFileSync(path.join(drizzleDir, migration), 'utf-8');
            sql.replace(/--.*$/gm, '')
               .split(';')
               .map(s => s.trim())
               .filter(Boolean)
               .forEach(s => schemaStatements.push(s));
        }
    }

    const seedSql = fs.readFileSync(seedFile, 'utf-8');
    const seedStatements = seedSql.replace(/--.*$/gm, '')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);

    for (const dbPath of dbPaths) {
        console.log(`[Setup Test DB] Seeding database at: ${path.basename(dbPath)}...`);
        const db = new Database(dbPath);
        
        for (const stmt of schemaStatements) {
            try { db.exec(stmt + ';'); } catch (err) { 
                if (err.message.includes('database is locked')) {
                    throw new Error('Fatal: SQLite is locked during sequential setup. Make sure no other instances of Miniflare are running.');
                }
                // Safely ignore duplicate collision warnings 
            }
        }
        
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
        console.log(`[Setup Test DB] Complete: ${seedSuccessCount} injected, ${seedFailCount} dropped (${path.basename(dbPath)}).`);
    }
} catch (error) {
    console.error('[Setup Test DB] Exception during execution:', error);
    process.exit(1);
}
