#!/usr/bin/env node
/**
 * Households as profiles, final fix D1(c) — the release runbook's +1d / +14d
 * check: which merges ran on an OLD build after the release?
 *
 * Old tabs are forwarded to the build they were loaded from for up to 14 days
 * (deploy skew). An old build's mergeAdopters doesn't know household
 * memberships: it leaves the absorbed profile's memberships pointing at the
 * soft-deleted row and records an undo payload WITHOUT `householdMemberships`
 * (every new-build merge writes that key, even when nothing moved). The
 * household reads follow such a member to its survivor and the conversion
 * reuses the converted profile of a copied member, but each listed merge
 * should still be looked at by hand.
 *
 * READ-ONLY: one SELECT (wrangler d1 execute --command). It prints the merges
 * and how many memberships still name the absorbed profile.
 *
 *   node scripts/list-old-build-merges.mjs --since 2026-11-01 [--db pet-adoption-db] [--local]
 *
 * Exit 0 with a list (possibly empty); 2 when the query could not run.
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        since: { type: 'string' },
        db: { type: 'string', default: 'pet-adoption-db' },
        local: { type: 'boolean', default: false },
    },
});

const sinceMs = values.since ? Date.parse(values.since) : NaN;
if (!Number.isFinite(sinceMs)) {
    console.error('::error::--since must be a date (YYYY-MM-DD or ISO), e.g. --since 2026-11-01');
    process.exit(2);
}
const since = Math.floor(sinceMs / 1000);

// json_valid guards a malformed details row; the absence check is exactly
// "the undo payload has no householdMemberships key".
const SQL = `
    SELECT a.id AS audit_id,
           a.created_at,
           json_extract(a.details, '$.primaryId') AS survivor_id,
           json_extract(a.details, '$.secondaryId') AS absorbed_id,
           json_extract(a.details, '$.undoneAt') IS NOT NULL AS undone,
           (SELECT COUNT(*) FROM household_memberships m
              WHERE m.adopter_id = json_extract(a.details, '$.secondaryId')) AS memberships_left_on_absorbed
    FROM audit_log a
    WHERE a.action = 'adopter_merge'
      AND a.created_at >= ${since}
      AND json_valid(a.details)
      AND json_type(a.details, '$.undo.householdMemberships') IS NULL
    ORDER BY a.created_at`;

let rows;
try {
    const out = execFileSync('npx', [
        'wrangler', 'd1', 'execute', values.db, values.local ? '--local' : '--remote', '--json', '--command', SQL,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 << 20 });
    const start = out.indexOf('[');
    const end = out.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error(`no JSON in wrangler output: ${out.slice(0, 200)}`);
    rows = JSON.parse(out.slice(start, end + 1))[0].results;
} catch (e) {
    console.error(`::error::could not query ${values.db}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
}

if (!rows.length) {
    console.log(`No merges without household data since ${new Date(sinceMs).toISOString()} on ${values.db}.`);
    process.exit(0);
}
console.log(`${rows.length} merge(s) since ${new Date(sinceMs).toISOString()} on ${values.db} ran on a build that doesn't move households:`);
for (const r of rows) {
    const at = new Date(Number(r.created_at) * 1000).toISOString();
    console.log(`- ${at}  audit ${r.audit_id}  ${r.absorbed_id} → ${r.survivor_id}${r.undone ? '  (undone)' : ''}  memberships still on the absorbed profile: ${r.memberships_left_on_absorbed}`);
}
