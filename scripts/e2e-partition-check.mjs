#!/usr/bin/env node
// Guard: every Playwright test runs in exactly one CI e2e leg.
//
// The e2e matrix in .github/workflows/ci.yml splits the suite with --shard and
// --grep / --grep-invert. A mistake there (a new @leg- tag, a shard count that
// no longer matches its legs) makes a test run NOWHERE or TWICE, and a test that
// silently doesn't run is the worst failure this pipeline can have. This check
// lists each leg with its exact args and compares against the full suite.
//
// Usage: node scripts/e2e-partition-check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** @param {string[]} all @param {Record<string, string[]>} legs */
export function checkPartition(all, legs) {
    const isSetup = (id) => id.startsWith('[setup]');
    const allIds = [...new Set(all.filter((id) => !isSetup(id)))];
    const owners = new Map();
    for (const [leg, ids] of Object.entries(legs)) {
        for (const id of new Set(ids.filter((i) => !isSetup(i)))) {
            if (!owners.has(id)) owners.set(id, []);
            owners.get(id).push(leg);
        }
    }
    const missing = allIds.filter((id) => !owners.has(id));
    const duplicated = [...owners.entries()]
        .filter(([, l]) => l.length > 1)
        .map(([id, l]) => ({ id, legs: l }));
    return { missing, duplicated };
}

/** Narrow parser for the e2e job's `- group:` / `projects:` pairs. */
export function parseLegs(yamlText) {
    const lines = yamlText.split('\n');
    const start = lines.findIndex((l) => /^ {2}e2e:\s*$/.test(l));
    if (start < 0) throw new Error('e2e job not found in ci.yml');
    const legs = [];
    let group = null;
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^ {2}\S/.test(l)) break; // next job
        const g = l.match(/^\s*-\s*group:\s*(\S+)\s*$/);
        if (g) { group = g[1]; continue; }
        const p = l.match(/^\s*projects:\s*(.+?)\s*$/);
        if (p && group) { legs.push({ group, args: p[1].split(/\s+/) }); group = null; }
    }
    if (legs.length === 0) throw new Error('no matrix legs parsed from ci.yml');
    return legs;
}

function list(args) {
    const out = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=list', ...args], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
    });
    // "  [proj] › file:line:col › title" -> "[proj] › file:line › title"
    return out.split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\[[a-z]+\] ›/.test(l))
        .map((l) => l.replace(/^(\[[^\]]+\] › [^›]*?:\d+):\d+( ›)/, '$1$2'));
}

function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const legDefs = parseLegs(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    const all = list(['--project=user', '--project=authed', '--project=unauthed', '--project=mobile']);
    const legs = {};
    for (const { group, args } of legDefs) legs[group] = list(args);
    const { missing, duplicated } = checkPartition(all, legs);
    if (missing.length || duplicated.length) {
        for (const id of missing) console.error(`MISSING from every leg: ${id}`);
        for (const d of duplicated) console.error(`DUPLICATED in ${d.legs.join(', ')}: ${d.id}`);
        process.exit(1);
    }
    console.log(`partition OK: ${new Set(all.filter((i) => !i.startsWith('[setup]'))).size} tests in ${legDefs.length} legs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
