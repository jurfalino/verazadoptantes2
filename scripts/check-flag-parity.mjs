#!/usr/bin/env node
/**
 * Warn when the e2e seed's feature flags differ from production's.
 *
 * The e2e suite only exercises the flag states tests/seed.sql sets. When a flag
 * is ON in production but not in the seed, the code path real users run is never
 * tested — how v2.56.62's hidden family text shipped (ENABLE_HOUSEHOLD_MEMBERS on
 * in prod since 09-03, absent from the seed). Audit 2026-09-19, PR-4.
 *
 * Advisory: prints GitHub ::warning:: lines and exits 0, because some differences
 * are deliberate (a flag being trialled in prod, or kept off in tests on purpose).
 * Pass --strict to exit 1 instead.
 *
 *   node scripts/check-flag-parity.mjs                 # queries production D1 (read-only)
 *   node scripts/check-flag-parity.mjs --prod-json f   # use a saved `wrangler --json` result
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonIdx = args.indexOf('--prod-json');

function seedFlags() {
    const sql = readFileSync(new URL('../tests/seed.sql', import.meta.url), 'utf8');
    const out = {};
    for (const m of sql.matchAll(/\('(ENABLE_[A-Z0-9_]+)',\s*'(true|false)'/g)) out[m[1]] = m[2];
    return out;
}

function prodFlags() {
    const raw = jsonIdx >= 0
        ? readFileSync(args[jsonIdx + 1], 'utf8')
        : execSync(`npx wrangler d1 execute pet-adoption-db --remote --json --command "SELECT key, value FROM app_config WHERE key LIKE 'ENABLE_%'"`,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(raw);
    const rows = (Array.isArray(parsed) ? parsed[0] : parsed).results ?? [];
    return Object.fromEntries(rows.map(r => [r.key, String(r.value)]));
}

// A flag with no row falls back to its default in src/config/features.ts
// (FEATURE_FLAGS), e.g. ENABLE_FOLLOWUPS defaults to on. Compare EFFECTIVE values.
function codeDefaults() {
    const src = readFileSync(new URL('../src/config/features.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('FEATURE_FLAGS'), src.indexOf('} as const'));
    const out = {};
    for (const m of block.matchAll(/\b(ENABLE_[A-Z0-9_]+):\s*(true|false)/g)) out[m[1]] = m[2];
    return out;
}

const defaults = codeDefaults();
const seedRaw = seedFlags();
const prodRaw = prodFlags();
const keys = new Set([...Object.keys(defaults), ...Object.keys(seedRaw), ...Object.keys(prodRaw)]);
const seed = {}, prod = {};
for (const k of keys) { seed[k] = seedRaw[k] ?? defaults[k] ?? 'false'; prod[k] = prodRaw[k] ?? defaults[k] ?? 'false'; }
const on = v => v === 'true' || v === '1';
const findings = [];
for (const [key, value] of Object.entries(prod)) {
    if (on(value) && !on(seed[key])) findings.push(`${key} is ON in production but OFF in e2e (tests/seed.sql) — the path users run is not covered`);
}
for (const [key, value] of Object.entries(seed)) {
    if (on(value) && !on(prod[key])) findings.push(`${key} is ON in e2e (tests/seed.sql) but OFF in production — e2e tests a path users don't see`);
}

if (!findings.length) { console.log('flag parity: seed matches production for all ENABLE_* flags'); process.exit(0); }
for (const f of findings) console.log(`::warning title=Flag parity::${f}`);
console.log(`flag parity: ${findings.length} difference(s)`);
process.exit(strict ? 1 : 0);
