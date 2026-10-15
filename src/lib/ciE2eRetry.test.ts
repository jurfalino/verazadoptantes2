/**
 * scripts/ci-e2e.sh — CI's e2e step (spec: Phase 0 of the e2e memory plan,
 * 2026-10-15). A fake `npx` stands in for Playwright: it records its
 * arguments and fails or passes as each scenario needs.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../scripts/ci-e2e.sh');
const RESTART = '⚠ Server is approaching the used memory threshold, restarting...';

/** Runs the script with a fake npx: attempt N prints outputs[N] and exits codes[N]. */
function run(outputs: string[], codes: number[]) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-e2e-'));
    const calls = join(dir, 'calls');
    writeFileSync(join(dir, 'npx'), `#!/bin/bash
n=$(( $(cat "${calls}.n" 2>/dev/null || echo 0) + 1 )); echo $n > "${calls}.n"
echo "$*" >> "${calls}"
outs=(${outputs.map(o => JSON.stringify(o)).join(' ')}); codes=(${codes.join(' ')})
echo "\${outs[$((n-1))]}"; exit "\${codes[$((n-1))]}"
`);
    chmodSync(join(dir, 'npx'), 0o755);
    const r = spawnSync('bash', [SCRIPT, '--project=authed', '--shard=7/7'], {
        cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
    });
    return { code: r.status, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [], out: r.stdout + r.stderr };
}

describe('CI e2e step: one re-run of the failed tests after a dev-server memory restart', () => {
    it('a green run is just green — one attempt', () => {
        const r = run(['all passed'], [0]);
        expect(r.code).toBe(0);
        expect(r.calls).toEqual(['playwright test --project=authed --shard=7/7']);
    });
    it('a failure with the restart in the log re-runs only the failed tests, and passes if they pass', () => {
        const r = run([`1 failed\n${RESTART}`, 'all passed'], [1, 0]);
        expect(r.code).toBe(0);
        expect(r.calls).toEqual(['playwright test --project=authed --shard=7/7', 'playwright test --project=authed --shard=7/7 --last-failed']);
        expect(r.out).toMatch(/memory restart/i);
    });
    it('a real failure that fails again still fails the step', () => {
        const r = run([`1 failed\n${RESTART}`, '1 failed'], [1, 1]);
        expect(r.code).toBe(1);
    });
    it('a failure WITHOUT the restart is a real failure — no second attempt', () => {
        const r = run(['1 failed: expected 2, got 3'], [1]);
        expect(r.code).toBe(1);
        expect(r.calls).toHaveLength(1);
    });
});
