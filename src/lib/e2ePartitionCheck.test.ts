import { describe, it, expect } from 'vitest';
import { checkPartition, parseLegs, normalizeListOutput, diffMatrices } from '../../scripts/e2e-partition-check.mjs';

const A = '[user] › a.spec.ts:1 › one';
const B = '[authed] › b.spec.ts:2 › two';

describe('checkPartition', () => {
    it('reports a test that is in no leg as missing', () => {
        const r = checkPartition([A, B], { l1: [A] });
        expect(r.missing).toEqual([B]);
        expect(r.duplicated).toEqual([]);
    });
    it('reports a test in two legs as duplicated, naming both', () => {
        const r = checkPartition([A, B], { l1: [A, B], l2: [B] });
        expect(r.missing).toEqual([]);
        expect(r.duplicated).toEqual([{ id: B, legs: ['l1', 'l2'] }]);
    });
    it('ignores [setup] tests, which run as a dependency in every leg', () => {
        const S = '[setup] › auth.setup.ts:14 › authenticate as admin';
        const r = checkPartition([S, A], { l1: [S, A], l2: [S] });
        expect(r).toEqual({ missing: [], duplicated: [] });
    });
    it('returns empty results for an exact partition', () => {
        expect(checkPartition([A, B], { l1: [A], l2: [B] })).toEqual({ missing: [], duplicated: [] });
    });
});

describe('parseLegs', () => {
    it('reads group/projects pairs of the e2e job only', () => {
        const yaml = [
            'jobs:', '  other:', '    - group: nope', '      projects: --x',
            '  e2e:', '    strategy:', '      matrix:', '        include:',
            '          - group: g1', '            projects: --project=user --shard=1/2',
            '          # comment', '          - group: g2', '            projects: --project=authed --grep @leg-x',
            '  deploy:', '    - group: late', '      projects: --y', '',
        ].join('\n');
        expect(parseLegs(yaml)).toEqual([
            { group: 'g1', args: ['--project=user', '--shard=1/2'] },
            { group: 'g2', args: ['--project=authed', '--grep', '@leg-x'] },
        ]);
    });

    it('reads another job by name (the Cloudflare matrix), not a job whose name starts the same', () => {
        const yaml = [
            'jobs:', '  e2e:', '    - group: dev', '      projects: --project=user',
            '  e2e-cf:', '    - group: cf', '      projects: --project=authed', '',
        ].join('\n');
        expect(parseLegs(yaml)).toEqual([{ group: 'dev', args: ['--project=user'] }]);
        expect(parseLegs(yaml, 'e2e-cf')).toEqual([{ group: 'cf', args: ['--project=authed'] }]);
    });
});

describe('diffMatrices', () => {
    const leg = (group: string, projects: string) => ({ group, args: projects.split(' ') });
    it('is empty when both matrices have the same legs in any order', () => {
        expect(diffMatrices([leg('a', '--project=user'), leg('b', '--project=authed')],
            [leg('b', '--project=authed'), leg('a', '--project=user')])).toEqual([]);
    });
    it('names a leg missing from either side and a leg whose args differ', () => {
        expect(diffMatrices(
            [leg('a', '--project=user --shard=1/3'), leg('b', '--project=authed')],
            [leg('a', '--project=user --shard=1/4'), leg('c', '--project=mobile')],
        )).toEqual([
            'leg a: --project=user --shard=1/3 vs --project=user --shard=1/4',
            'leg b: only in e2e',
            'leg c: only in e2e-cf',
        ]);
    });
});

describe('normalizeListOutput', () => {
    it('strips the column from test ids and drops non-test lines (dotenv banner, totals)', () => {
        const out = [
            '[dotenv@17.2.3] injecting env (5) from .env.local',
            'Listing tests:',
            '  [user] › households.user.spec.ts:60:5 › households › one',
            '  [authed] › a.spec.ts:12:9 › two',
            '  [setup] › auth.setup.ts:14:6 › authenticate as admin',
            'Total: 3 tests in 3 files',
            '',
        ].join('\n');
        expect(normalizeListOutput(out)).toEqual([
            '[user] › households.user.spec.ts:60 › households › one',
            '[authed] › a.spec.ts:12 › two',
            '[setup] › auth.setup.ts:14 › authenticate as admin',
        ]);
    });
});
