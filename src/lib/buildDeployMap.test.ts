import { describe, it, expect } from 'vitest';
import { pickDeployments } from '../../scripts/build-deploy-map.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4);
const cutoff = NOW - 14 * DAY;
const opts = { env: 'production', branch: 'master', cutoff, sha: 'building' };

function dep(commit: string, daysAgo: number, over: Record<string, unknown> = {}) {
    return {
        url: `https://${commit}.verazadoptantes2.pages.dev`,
        environment: 'production',
        created_on: new Date(NOW - daysAgo * DAY).toISOString(),
        latest_stage: { name: 'deploy', status: 'success' },
        deployment_trigger: { metadata: { branch: 'master', commit_hash: commit } },
        ...over,
    };
}

describe('pickDeployments — the builds old tabs are forwarded to', () => {
    it('keeps the live build even when it is older than the window (2026-11-04: 16 days since the last release)', () => {
        expect(pickDeployments([dep('live', 16), dep('older', 20)], opts)).toEqual({ live: 'https://live.verazadoptantes2.pages.dev' });
    });

    it('keeps the builds before the live one only inside the window', () => {
        expect(Object.keys(pickDeployments([dep('live', 1), dep('recent', 10), dep('old', 15)], opts))).toEqual(['live', 'recent']);
    });

    it('the live build is the newest successful one of this branch; failed and other-branch rows do not count', () => {
        const rows = [
            dep('failed', 0, { latest_stage: { name: 'deploy', status: 'failure' } }),
            dep('staging', 0, { deployment_trigger: { metadata: { branch: 'staging', commit_hash: 'staging' } } }),
            dep('live', 30),
        ];
        expect(pickDeployments(rows, opts)).toEqual({ live: 'https://live.verazadoptantes2.pages.dev' });
    });

    it('never maps the sha being built; on a re-run it is the live one, so the build before it gets no age exemption', () => {
        expect(pickDeployments([dep('building', 0), dep('prev', 20)], opts)).toEqual({});
        expect(Object.keys(pickDeployments([dep('building', 0), dep('prev', 3)], opts))).toEqual(['prev']);
    });

    it('skips URLs that are not this project\'s pages.dev deployments', () => {
        expect(pickDeployments([dep('live', 1, { url: 'https://evil.example.com' }), dep('next', 2)], opts))
            .toEqual({ next: 'https://next.verazadoptantes2.pages.dev' });
    });

    it('stops at max entries', () => {
        expect(Object.keys(pickDeployments([dep('a', 1), dep('b', 2), dep('c', 3)], { ...opts, max: 2 }))).toEqual(['a', 'b']);
    });
});
