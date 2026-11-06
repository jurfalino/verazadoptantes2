/**
 * Step 2 (Jon 2026-11-05: teammates answer both ways): a pair a teammate loaded a
 * side of is on the viewer's list — the profile bar offers «Revisar», the form and
 * contract screens offer «No es esta persona». Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()),
    // Rescate Norte: north@x.org and its member mate@x.org; everyone else is solo.
    getTeamEmails: vi.fn(async (email: string) => (['north@x.org', 'mate@x.org'].includes(email.toLowerCase()) ? ['north@x.org', 'mate@x.org'] : [email.toLowerCase()])),
}));

import { loadOpenPairs, pendingDuplicatesByAdopter } from './openPairs';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let db: unknown;
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    const ins = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    ins.run('a', 'Rosa Nueva', 'North@X.org'); // Rescate Norte's, stored with capitals
    ins.run('b', 'Rosa Díaz', 'east@x.org');   // another rescuer's
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status) VALUES ('c1', 'a', 'b', '["phone"]', 60, 'medium', 'pending')`).run();
});

describe('loadOpenPairs — on the viewer list', () => {
    it('a teammate of the loader: yes (the bar offers «Revisar»)', async () => {
        const [p] = await loadOpenPairs(db as never, 'a', 'mate@x.org');
        expect(p).toMatchObject({ otherAdopterId: 'b', onViewerList: true });
    });
    it('the loader, whose added_by has capitals: yes', async () => {
        expect((await loadOpenPairs(db as never, 'a', 'north@x.org'))[0].onViewerList).toBe(true);
    });
    it('the other side’s loader: yes', async () => {
        expect((await loadOpenPairs(db as never, 'a', 'east@x.org'))[0].onViewerList).toBe(true);
    });
    it('a stranger: the pair shows, but not on their list', async () => {
        expect((await loadOpenPairs(db as never, 'a', 'stranger@x.org'))[0].onViewerList).toBe(false);
    });
});

describe('pendingDuplicatesByAdopter — the /my-adopters card', () => {
    const pairs = [{ a1: 'a', a2: 'b', score: 60, detectedAt: 1000 }];
    const ownerOf = new Map<string, string | null>([['a', 'North@X.org']]);
    it('a teammate: on their list', async () => {
        const m = await pendingDuplicatesByAdopter(db as never, pairs, ownerOf, 'mate@x.org');
        expect(m.get('a')).toEqual([{ otherAdopterId: 'b', otherAdopterName: 'Rosa Díaz', onViewerList: true }]);
    });
    it('a stranger: not', async () => {
        const m = await pendingDuplicatesByAdopter(db as never, pairs, ownerOf, 'stranger@x.org');
        expect(m.get('a')?.[0].onViewerList).toBe(false);
    });
});
