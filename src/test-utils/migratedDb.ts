/**
 * An in-memory SQLite with the real schema: the tracked e2e seed DB's
 * (local.db) table/view/index definitions — read-only, no rows — then every
 * drizzle/*.sql migration on top, the same way scripts/setup-test-db.js does
 * (comments stripped, split on ';', duplicate-column / already-exists errors
 * tolerated). Replaying the migrations alone from scratch does not reproduce
 * the production schema (early migrations rebuild tables), hence the seed.
 * For integration tests of server actions that need real SQL.
 * Test-only: never import from app code.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let statements: string[] | null = null;

function migrationStatements(): string[] {
    if (statements) return statements;
    const dir = resolve(process.cwd(), 'drizzle');
    statements = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(f =>
        readFileSync(resolve(dir, f), 'utf8').replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean));
    return statements;
}

let seedSchema: string[] | null = null;

function seedSchemaStatements(): string[] {
    if (seedSchema) return seedSchema;
    const seed = new Database(resolve(process.cwd(), 'local.db'), { readonly: true, fileMustExist: true });
    const rows = seed.prepare(
        `SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END`,
    ).all() as Array<{ type: string; sql: string }>;
    seed.close();
    seedSchema = rows.map(r => r.sql);
    return seedSchema;
}

export function migratedDb() {
    const sqlite = new Database(':memory:');
    for (const stmt of seedSchemaStatements()) {
        try { sqlite.exec(stmt + ';'); } catch { /* a view/trigger over a table that came later — retried by migrations */ }
    }
    for (const stmt of migrationStatements()) {
        try { sqlite.exec(stmt + ';'); } catch { /* same tolerance as setup-test-db.js */ }
    }
    return { sqlite, db: drizzle(sqlite) };
}
