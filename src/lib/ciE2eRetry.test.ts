/**
 * scripts/ci-e2e.sh — CI's e2e step (spec: Phase 0 of the e2e memory plan,
 * 2026-10-15). A fake `npx` stands in for Playwright: it records its
 * arguments and fails or passes as each scenario needs.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../scripts/ci-e2e.sh');
const RESTART = '⚠ Server is approaching the used memory threshold, restarting...';

/** Runs the script with a fake npx: attempt N prints outputs[N] and exits codes[N]. */
function run(outputs: string[], codes: number[], opts: { report?: boolean; clock?: number[]; env?: Record<string, string> } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-e2e-'));
    const calls = join(dir, 'calls');
    writeFileSync(join(dir, 'npx'), `#!/bin/bash
n=$(( $(cat "${calls}.n" 2>/dev/null || echo 0) + 1 )); echo $n > "${calls}.n"
echo "$*" >> "${calls}"
outs=(${outputs.map(o => JSON.stringify(o)).join(' ')}); codes=(${codes.join(' ')})
echo "\${outs[$((n-1))]}"; exit "\${codes[$((n-1))]}"
`);
    chmodSync(join(dir, 'npx'), 0o755);
    // A fake `date +%s`: each call returns the next value of opts.clock (the last one repeats).
    if (opts.clock) {
        writeFileSync(join(dir, 'date'), `#!/bin/bash
n=$(( $(cat "${dir}/date.n" 2>/dev/null || echo 0) + 1 )); echo $n > "${dir}/date.n"
ts=(${opts.clock.join(' ')}); i=$((n-1)); [ "$i" -ge "\${#ts[@]}" ] && i=$((\${#ts[@]}-1))
echo "\${ts[$i]}"
`);
        chmodSync(join(dir, 'date'), 0o755);
    }
    if (opts.report) { mkdirSync(join(dir, 'playwright-report')); writeFileSync(join(dir, 'playwright-report', 'index.html'), 'attempt 1'); }
    const r = spawnSync('bash', [SCRIPT, '--project=authed', '--shard=7/7'], {
        cwd: dir, env: { ...process.env, ...opts.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
    });
    return {
        code: r.status, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [], out: r.stdout + r.stderr,
        reportMoved: existsSync(join(dir, 'playwright-report-attempt-1', 'index.html')),
    };
}

describe('CI e2e step: one re-run of the whole shard after a dev-server memory restart killed a test', () => {
    const CONN = 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/settings';
    it('a green run is just green — one attempt', () => {
        const r = run(['all passed'], [0]);
        expect(r.code).toBe(0);
        expect(r.calls).toEqual(['playwright test --project=authed --shard=7/7']);
    });
    it('a restart that dropped a connection re-runs the WHOLE shard (never --last-failed), and passes if it all passes', () => {
        const r = run([`1 failed\n${RESTART}\n${CONN}`, 'all passed'], [1, 0]);
        expect(r.code).toBe(0);
        expect(r.calls).toEqual(['playwright test --project=authed --shard=7/7', 'playwright test --project=authed --shard=7/7']);
        expect(r.out).toMatch(/memory restart/i);
    });
    it('the re-run failing fails the step', () => {
        expect(run([`1 failed\n${RESTART}\n${CONN}`, '1 failed'], [1, 1]).code).toBe(1);
    });
    it('a restart somewhere in the log is not enough — an assertion failure is a real failure', () => {
        const r = run([`1 failed: expected 2, got 3\n${RESTART}`], [1]);
        expect(r.code).toBe(1);
        expect(r.calls).toHaveLength(1);
    });
    it('a dropped connection without a restart is not retried either', () => {
        const r = run([`1 failed\n${CONN}`], [1]);
        expect(r.code).toBe(1);
        expect(r.calls).toHaveLength(1);
    });
    it("keeps the first attempt's report before re-running", () => {
        const r = run([`1 failed\n${RESTART}\n${CONN}`, 'all passed'], [1, 0], { report: true });
        expect(r.code).toBe(0);
        expect(r.reportMoved).toBe(true);
    });
});

describe('CI e2e step: the re-run must fit the step budget, and a long leg is flagged', () => {
    const CONN = 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/settings';
    const FAIL = `1 failed\n${RESTART}\n${CONN}`;
    const env = { E2E_STEP_BUDGET_SEC: '1500', E2E_WARN_AT_SEC: '900' };
    // clock: start, end of attempt 1, end of attempt 2
    it('retries when attempt 1 took exactly (budget - 60) / 2 = 720s', () => {
        const r = run([FAIL, 'all passed'], [1, 0], { clock: [1000, 1720, 2200], env });
        expect(r.code).toBe(0);
        expect(r.calls).toHaveLength(2);
        expect(r.out).not.toMatch(/no time left/);
    });
    it('does not retry when attempt 1 took one second more (721s), and says why', () => {
        const r = run([FAIL, 'all passed'], [1, 0], { clock: [1000, 1721], env });
        expect(r.code).toBe(1);
        expect(r.calls).toHaveLength(1);
        expect(r.out).toContain('::warning::e2e: no time left for a re-run (attempt 1 took 721s of a 1500s budget)');
    });
    it('the budget comes from E2E_STEP_BUDGET_SEC', () => {
        const r = run([FAIL, 'all passed'], [1, 0], { clock: [0, 421], env: { ...env, E2E_STEP_BUDGET_SEC: '900' } });
        expect(r.calls).toHaveLength(1);
        expect(r.out).toContain('attempt 1 took 421s of a 900s budget');
    });
    it('a green run over E2E_WARN_AT_SEC warns how much of the 1800s job limit it used', () => {
        const r = run(['all passed'], [0], { clock: [1000, 1901], env });
        expect(r.code).toBe(0);
        expect(r.out).toContain('::warning::e2e leg used 901s of its 1800s job limit');
    });
    it('a green run under it prints no leg-budget warning', () => {
        const r = run(['all passed'], [0], { clock: [1000, 1900], env });
        expect(r.code).toBe(0);
        expect(r.out).not.toMatch(/job limit/);
    });
    it('a red run over the threshold warns too, counting the re-run', () => {
        const r = run([FAIL, '1 failed'], [1, 1], { clock: [0, 600, 1300], env });
        expect(r.code).toBe(1);
        expect(r.out).toContain('::warning::e2e leg used 1300s of its 1800s job limit');
    });
});
