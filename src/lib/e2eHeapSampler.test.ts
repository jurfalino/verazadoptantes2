/**
 * scripts/e2e-heap-sampler.sh and scripts/e2e-heap-probe.cjs (task C1,
 * 2026-11-03): the memory log must have the documented line format, skip
 * quietly while there is no server, and never fail.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLER = join(__dirname, '../../scripts/e2e-heap-sampler.sh');
const PROBE = join(__dirname, '../../scripts/e2e-heap-probe.cjs');

function sample(probe: string | null, iterations = 1) {
    const dir = mkdtempSync(join(tmpdir(), 'heap-'));
    const probeFile = join(dir, 'probe.txt');
    const log = join(dir, 'e2e-heap.log');
    if (probe !== null) writeFileSync(probeFile, probe);
    const r = spawnSync('bash', [SAMPLER], {
        env: { ...process.env, E2E_HEAP_LOG: log, E2E_HEAP_PROBE: probeFile, E2E_HEAP_INTERVAL: '0', E2E_HEAP_ITERATIONS: String(iterations) },
        encoding: 'utf8',
    });
    return { code: r.status, lines: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
}

describe('e2e heap sampler', () => {
    it('writes "<epoch> <rss_kb> <heap_used_mb>" for the probe pid', () => {
        const r = sample(`${process.pid} 321\n`);
        expect(r.code).toBe(0);
        expect(r.lines).toHaveLength(1);
        const [epoch, rss, heap] = r.lines[0].split(' ');
        expect(Number(epoch)).toBeGreaterThan(1_700_000_000);
        expect(Number(rss)).toBeGreaterThan(0);
        expect(heap).toBe('321');
    });
    it('writes nothing, and still exits 0, with no probe file yet', () => {
        const r = sample(null, 2);
        expect(r.code).toBe(0);
        expect(r.lines).toEqual([]);
    });
    it('writes nothing for a process that is gone (mid-restart) or a garbled probe', () => {
        expect(sample('2999999 100\n').lines).toEqual([]);
        expect(sample('garbage\n').lines).toEqual([]);
    });
    it('the probe is silent outside next-server and never throws', () => {
        const dir = mkdtempSync(join(tmpdir(), 'heap-'));
        const file = join(dir, 'probe.txt');
        const r = spawnSync('node', ['-r', PROBE, '-e', 'setTimeout(()=>{},200)'], { env: { ...process.env, E2E_HEAP_PROBE: file }, encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(existsSync(file)).toBe(false);
    });
});
