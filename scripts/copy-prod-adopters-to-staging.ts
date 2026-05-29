/**
 * One-off: copy the N most-recently-updated non-deleted adopters from prod
 * (`pet-adoption-db`) into staging (`pet-adoption-db-staging`), with the
 * related rows that make them useful for testing (history, adoptions,
 * flags, stats). Idempotent via INSERT OR REPLACE on each row's PK.
 *
 * Excludes:
 *   - `adopter_images` (R2 keys won't resolve in staging)
 *   - `pii_access_grants` / `pii_access_requests` (per-user state tied to
 *     emails that may not exist in staging)
 *   - `duplicate_tokens` / `duplicate_candidates` (derived; will be empty
 *     until re-tokenization)
 *   - auth tables (user/account/session — break staging sign-in if copied)
 *
 * Usage:
 *   npx tsx scripts/copy-prod-adopters-to-staging.ts                  # dry-run, default limit 15
 *   npx tsx scripts/copy-prod-adopters-to-staging.ts --limit=25
 *   npx tsx scripts/copy-prod-adopters-to-staging.ts --apply          # actually write to staging
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PROD_DB = 'pet-adoption-db';
const STAGING_DB = 'pet-adoption-db-staging';

const RELATED_TABLES = [
    { name: 'adopters', idCol: 'id' },
    { name: 'adopter_history', idCol: 'adopter_id' },
    { name: 'adoptions', idCol: 'adopter_id' },
    { name: 'adopter_flags', idCol: 'adopter_id' },
    { name: 'adopter_stats', idCol: 'adopter_id' },
];

const args = process.argv.slice(2);
const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 15);
const apply = args.includes('--apply');

console.error(`Source:   prod (${PROD_DB})`);
console.error(`Target:   staging (${STAGING_DB})`);
console.error(`Limit:    ${limit} adopters`);
console.error(`Mode:     ${apply ? 'APPLY (writes to staging)' : 'dry-run (no writes)'}`);
console.error('');

function wranglerQuery(db: string, command: string): unknown[] {
    const cmd = `npx wrangler d1 execute ${db} --remote --json --command "${command.replace(/"/g, '\\"')}"`;
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
    const parsed = JSON.parse(out) as Array<{ results: unknown[] }>;
    return parsed[0]?.results ?? [];
}

function sqlEscape(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return "'" + String(v).replace(/'/g, "''") + "'";
}

console.error('Picking adopters from prod...');
const adopters = wranglerQuery(
    PROD_DB,
    `SELECT id, name FROM adopters WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${limit}`,
) as Array<{ id: string; name: string }>;
console.error(`Picked ${adopters.length} adopters (names omitted from log to limit PII exposure).`);

const ids = adopters.map(a => a.id);
const idsSql = ids.map(id => `'${id}'`).join(',');

// D1 wraps the --file batch in its own transaction; explicit BEGIN/COMMIT
// and PRAGMA statements are rejected by the Durable Object SQL gateway.
// Table order below (adopters first, then *_history / adoptions / flags /
// stats which reference adopter_id) keeps FK insert order correct.
let sql = '-- prod → staging adopter sample\n';
sql += `-- ${ids.length} adopters + related rows\n`;
sql += `-- generated ${new Date().toISOString()}\n\n`;

const summary: Record<string, number> = {};

for (const { name: table, idCol } of RELATED_TABLES) {
    console.error(`Reading ${table} (${idCol} IN ...)...`);
    const rows = wranglerQuery(
        PROD_DB,
        `SELECT * FROM ${table} WHERE ${idCol} IN (${idsSql})`,
    ) as Array<Record<string, unknown>>;
    summary[table] = rows.length;
    console.error(`  → ${rows.length} rows`);
    if (rows.length === 0) continue;

    sql += `-- ${table}: ${rows.length} rows\n`;
    for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map(c => sqlEscape(row[c]));
        sql += `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${vals.join(',')});\n`;
    }
    sql += '\n';
}


const sqlPath = `/tmp/copy-prod-to-staging${apply ? '-apply' : ''}.sql`;
writeFileSync(sqlPath, sql);

console.error('');
console.error('Summary of rows:');
for (const [t, n] of Object.entries(summary)) console.error(`  ${t}: ${n}`);
console.error('');
console.error(`Wrote ${sqlPath} (${sql.length} bytes, ${sql.split('\n').length} lines)`);

if (!apply) {
    console.error('');
    console.error('Dry-run — no writes. To apply, re-run with --apply, or:');
    console.error(`  npx wrangler d1 execute ${STAGING_DB} --remote --file ${sqlPath}`);
    process.exit(0);
}

console.error('');
console.error('Applying to staging...');
const applyOut = execSync(
    `npx wrangler d1 execute ${STAGING_DB} --remote --file ${sqlPath}`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
);
console.error(applyOut);
console.error('Done.');
