#!/usr/bin/env node
/**
 * Version regression guard.
 *
 * package.json is this project's only real deploy identity (/api/health is a
 * hardcoded red herring), so a version that moves BACKWARDS makes two
 * different builds claim overlapping numbers and breaks "which build is live?"
 * for good. That happened on 2026-09-06: one session shipped 2.56.0 while a
 * parallel session, continuing the 2.55.x follow-up series from an older base,
 * bumped 2.55.18 → 2.55.19 on top of it.
 *
 * Rule enforced here: the version at HEAD must be >= every recent ancestor's.
 * Deliberately >= and not > — a staging→master release merge and the
 * "merge master back into staging" step after a squash merge both legitimately
 * carry the version unchanged. Catching decreases is what prevents the bug;
 * requiring an increase would fail those merges. That every DEPLOY bumps
 * stays a workflow rule (.agents/workflows/deploy.md).
 *
 * Version format is `major.minor.patch[-build]`. Note the suffix INCREMENTS
 * here (2.55.17 < 2.55.17-1 < 2.55.17-2) — the opposite of semver, where a
 * prerelease sorts before its release. Absent suffix is treated as 0.
 *
 * Usage: node scripts/check-version-bump.mjs
 * Env:   VERSION_GUARD_DEPTH (default 50) — how many ancestors to inspect.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const DEPTH = Number(process.env.VERSION_GUARD_DEPTH || 50);

// Anchor every git call to the repo this script lives in. Without -C the
// check inherits the caller's cwd and, run from anywhere else, every git
// command fails — which the "no history" branch below would read as a PASS.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function git(args) {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** "2.55.17-2" → [2, 55, 17, 2]; "2.56.0" → [2, 56, 0, 0]. Null when unparseable. */
export function parseVersion(raw) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec((raw || '').trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 0];
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
    for (let i = 0; i < 4; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

export function formatVersion(v) {
    return `${v[0]}.${v[1]}.${v[2]}${v[3] ? `-${v[3]}` : ''}`;
}

function versionAt(ref) {
    try {
        return JSON.parse(git(['show', `${ref}:package.json`])).version;
    } catch {
        return null; // commit predates package.json, or object missing in a shallow clone
    }
}

function main() {
    const currentRaw = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const current = parseVersion(currentRaw);
    if (!current) {
        console.error(`✗ package.json version "${currentRaw}" is not major.minor.patch[-build].`);
        process.exit(1);
    }

    let ancestors = [];
    try {
        const out = git(['rev-list', `--max-count=${DEPTH}`, 'HEAD~1']);
        ancestors = out ? out.split('\n') : [];
    } catch {
        // Root commit, or a shallow clone with no parent — nothing to compare.
        console.log(`✓ version ${currentRaw} (no ancestor history available to compare)`);
        return;
    }

    let highest = null;
    let highestSha = null;
    for (const sha of ancestors) {
        const parsed = parseVersion(versionAt(sha));
        if (!parsed) continue;
        if (!highest || compareVersions(parsed, highest) > 0) {
            highest = parsed;
            highestSha = sha;
        }
    }

    if (!highest) {
        console.log(`✓ version ${currentRaw} (no comparable ancestor versions found)`);
        return;
    }

    if (compareVersions(current, highest) < 0) {
        const subject = git(['log', '-1', '--format=%s', highestSha]);
        const suggestion = formatVersion([highest[0], highest[1], highest[2] + 1, 0]);
        console.error('');
        console.error('✗ VERSION REGRESSION — package.json went backwards.');
        console.error('');
        console.error(`    this commit : ${currentRaw}`);
        console.error(`    ancestor    : ${formatVersion(highest)}  (${highestSha.slice(0, 7)} ${subject})`);
        console.error('');
        console.error('  package.json is the only reliable deploy identity in this project, so a');
        console.error('  lower number here makes two builds claim overlapping versions.');
        console.error('');
        console.error(`  Fix: npm version ${suggestion} --no-git-tag-version   (then update CHANGELOG.md)`);
        console.error('  Pick a higher number if this release warrants a minor bump — but note a');
        console.error('  minor/major bump needs explicit user authorization (see deploy.md).');
        console.error('');
        process.exit(1);
    }

    console.log(`✓ version ${currentRaw} does not regress (highest ancestor: ${formatVersion(highest)})`);
}

// Only run when invoked directly, so the comparator can be imported and tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
