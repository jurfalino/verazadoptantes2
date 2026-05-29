/**
 * Backfill: parse legacy `adopters.contact_info` blobs into the structured
 * `adopters.contact_entries` JSON column for rows that don't yet have it.
 *
 * Motivation: the v2.15.0-16 popover redesign and the v2.15.0-17 address
 * split both assume the masked viewer is clicking a typed `ContactEntry`.
 * Adopters that pre-date v2.14.x (no `contact_entries`) render their
 * legacy `contact_info` as a free-text blob with no chip affordance — so a
 * masked viewer on one of those rows has no way to open the popover. Once
 * a row has structured entries, every read site (display, masking, matcher)
 * uses the same chip code path.
 *
 * Idempotent: only touches rows where `contact_entries IS NULL` or empty,
 * AND `contact_info` is non-empty, AND the parse produces a non-empty
 * entries array. A second run is a no-op.
 *
 * Usage:
 *   npx tsx scripts/backfill-contact-entries.ts --target=local
 *   npx tsx scripts/backfill-contact-entries.ts --target=staging
 *   npx tsx scripts/backfill-contact-entries.ts --target=staging --apply
 *   npx tsx scripts/backfill-contact-entries.ts --target=production --apply
 *
 * Default is dry-run — prints what would change, writes nothing. Add
 * `--apply` to actually write. Always run against staging first.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseBlobToContactEntries, contactEntriesToBlob, type ContactEntry } from '../src/lib/contactEntries';

const TARGETS = {
    local: { db: 'pet-adoption-db', flag: '--local' },
    staging: { db: 'pet-adoption-db-staging', flag: '--remote' },
    production: { db: 'pet-adoption-db', flag: '--remote' },
} as const;
type TargetName = keyof typeof TARGETS;

const args = process.argv.slice(2);
const targetArg = (args.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'local') as TargetName;
const apply = args.includes('--apply');

if (!(targetArg in TARGETS)) {
    console.error(`Unknown --target: "${targetArg}". Valid: local | staging | production`);
    process.exit(1);
}
const target = TARGETS[targetArg];

console.error(`Target:   ${targetArg} (${target.db})`);
console.error(`Mode:     ${apply ? 'APPLY (writes will happen)' : 'dry-run (no writes)'}`);
console.error('');

function wrangler(command: string): unknown {
    const cmd = `npx wrangler d1 execute ${target.db} ${target.flag} --json --command "${command.replace(/"/g, '\\"')}"`;
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(out);
}

function sqlEscape(v: string): string {
    return "'" + v.replace(/'/g, "''") + "'";
}

// 1. Find candidate rows. The condition mirrors the read-side check
// `hasStoredContactEntries = !!initialData?.contactEntries` — anything D1
// would return as falsy from that field is fair game.
console.error('Querying candidates...');
const result = wrangler(
    `SELECT id, name, contact_info, contact_entries FROM adopters
     WHERE deleted_at IS NULL
     AND contact_info IS NOT NULL
     AND length(trim(contact_info)) > 0
     AND (contact_entries IS NULL OR contact_entries = '' OR contact_entries = '[]')`,
);
const rows = ((result as Array<{ results: Array<{ id: string; name: string; contact_info: string; contact_entries: string | null }> }>)[0]?.results) ?? [];

console.error(`Found ${rows.length} candidate rows.`);
if (rows.length === 0) {
    console.error('Nothing to do.');
    process.exit(0);
}

// 2. Parse each blob and stage UPDATEs.
const updates: Array<{ id: string; name: string; entries: ContactEntry[]; jsonValue: string }> = [];
let emptyParse = 0;
for (const row of rows) {
    const entries = parseBlobToContactEntries(row.contact_info);
    if (entries.length === 0) {
        emptyParse++;
        continue;
    }
    updates.push({
        id: row.id,
        name: row.name,
        entries,
        jsonValue: JSON.stringify(entries),
    });
}

console.error(`Parsed ${updates.length} non-empty entry sets (skipped ${emptyParse} blobs that yielded nothing).`);
console.error('');

// 3. Preview a few + summarize.
console.error('--- Sample of planned updates (first 5) ---');
for (const u of updates.slice(0, 5)) {
    console.error(`${u.id}  ${u.name}`);
    for (const e of u.entries) console.error(`   ${e.type.padEnd(8)} ${e.value}`);
    console.error('');
}

if (!apply) {
    // Write SQL to disk for human review.
    const outPath = `/tmp/backfill-contact-entries-${targetArg}.sql`;
    const sql = [
        '-- Backfill adopters.contact_entries for legacy rows',
        `-- Target: ${targetArg} (${target.db})`,
        `-- Generated: ${new Date().toISOString()}`,
        `-- ${updates.length} rows`,
        '-- D1 wraps the --file batch in its own transaction; explicit BEGIN/COMMIT are rejected.',
        '',
        ...updates.map(u =>
            `UPDATE adopters SET contact_entries = ${sqlEscape(u.jsonValue)}, updated_at = updated_at WHERE id = ${sqlEscape(u.id)} AND (contact_entries IS NULL OR contact_entries = '' OR contact_entries = '[]');`,
        ),
    ].join('\n');
    writeFileSync(outPath, sql);
    console.error(`Dry-run — wrote ${updates.length} UPDATE statements to ${outPath}`);
    console.error('');
    console.error('To apply, re-run with --apply, or apply the SQL file directly:');
    console.error(`  npx wrangler d1 execute ${target.db} ${target.flag} --file ${outPath}`);
    process.exit(0);
}

// 4. Apply mode — confirm explicitly for production.
if (targetArg === 'production') {
    console.error('');
    console.error('!! Production target with --apply.');
    console.error('!! This will write to the production D1 (pet-adoption-db, --remote).');
    console.error('!! Press Ctrl-C in the next 5 seconds to abort, otherwise it proceeds.');
    for (let i = 5; i > 0; i--) {
        process.stderr.write(`  ${i}...\r`);
        // Block synchronously without bringing in extra deps.
        execSync('sleep 1');
    }
    console.error('');
}

// 5. Write the SQL file then apply via wrangler --file. Doing it as one file
// (vs N --command invocations) is way faster and runs atomically per chunk.
const sqlPath = `/tmp/backfill-contact-entries-${targetArg}-apply.sql`;
const applySql = updates.map(u =>
    `UPDATE adopters SET contact_entries = ${sqlEscape(u.jsonValue)}, updated_at = updated_at WHERE id = ${sqlEscape(u.id)} AND (contact_entries IS NULL OR contact_entries = '' OR contact_entries = '[]');`,
).join('\n');
writeFileSync(sqlPath, applySql);

console.error(`Applying ${updates.length} updates via wrangler --file ${sqlPath}...`);
const applyOut = execSync(
    `npx wrangler d1 execute ${target.db} ${target.flag} --file ${sqlPath}`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
);
console.error(applyOut);
console.error(`Done — ${updates.length} adopters backfilled.`);
