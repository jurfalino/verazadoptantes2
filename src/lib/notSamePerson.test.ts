/**
 * The consistency rule (spec 2026-11-06): any «no, it's not this person» about an
 * existing profile is saved the same way. The person who loaded either profile (or
 * an admin) settles it; anyone else opens the pair for the owners and is told who.
 * Only ids the server's own search offered count. Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));
vi.mock('@/config/admins', () => ({ isAdminAsync: vi.fn(async (e: string) => e === 'admin@x.org') }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()),
    pickAttributionOrg: vi.fn(async (email: string) => (email === 'north@x.org' ? { id: 'o1', name: 'Rescate Norte' } : null)),
}));
vi.mock('@/app/actions/notifications', () => ({ resolveDisplayName: vi.fn(async (e: string) => e.split('@')[0]) }));

import { settleNotSamePerson } from './notSamePerson';

type Sqlite = { prepare: (s: string) => { all: (...a: unknown[]) => Array<Record<string, unknown>>; run: (...a: unknown[]) => unknown } };
let db: unknown;
let sqlite: Sqlite;
const rows = () => sqlite.prepare('SELECT adopter1_id AS a, adopter2_id AS b, status, confidence FROM duplicate_candidates ORDER BY a, b').all();

beforeEach(() => {
    const m = migratedDb();
    db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    const ins = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    ins.run('new', 'Rosa Nueva', 'north@x.org');   // the profile being answered for (Rescate Norte's)
    ins.run('old', 'Rosa Díaz', 'east@x.org');     // the rejected one (another rescuer's)
});

const offered = [{ adopterId: 'old', matchTypes: ['phone'] }];
const run = (actor: string, rejectedIds: string[]) => settleNotSamePerson(db as never, { actor, adopterId: 'new', rejectedIds, offered, ctx: {} });

describe('settleNotSamePerson', () => {
    it('the person who loaded a profile settles the pair: dismissed, nobody asked', async () => {
        const r = await run('north@x.org', ['old']);
        expect(r).toMatchObject({ recorded: ['old'], asked: [], dropped: 0 });
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'dismissed', confidence: 'low' }]);
    });

    it('an admin settles it too', async () => {
        expect((await run('admin@x.org', ['old'])).recorded).toEqual(['old']);
    });

    it('someone who loaded neither: never dismissed — a pending pair for the owners, and who was asked', async () => {
        const r = await run('helper@x.org', ['old']);
        expect(r.recorded).toEqual([]);
        expect(r.asked).toEqual([{ otherId: 'old', otherName: 'Rosa Díaz', ownerLabels: ['Rescate Norte', 'east'] }]);
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'pending', confidence: 'medium' }]);
    });

    it('an id the search never offered is dropped: nothing written', async () => {
        const r = await settleNotSamePerson(db as never, { actor: 'north@x.org', adopterId: 'new', rejectedIds: ['zzz'], offered, ctx: {} });
        expect(r).toMatchObject({ recorded: [], asked: [], dropped: 1 });
        expect(rows()).toEqual([]);
    });

    it('a pair already settled is left alone, whoever answers', async () => {
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status) VALUES ('d', 'new', 'old', '[]', 0, 'low', 'merged')`).run();
        const r = await run('helper@x.org', ['old']);
        expect(r.asked).toEqual([]);
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'merged', confidence: 'low' }]);
    });

    it('a failed write is reported with an error id, never counted as saved', async () => {
        sqlite.prepare('DROP TABLE duplicate_candidates').run();
        const r = await run('north@x.org', ['old']);
        expect(r.recorded).toEqual([]);
        expect(r.failed).toEqual(['old']);
        expect(r.errorId).toBeTruthy();
    });

    it('the contact being typed: only who loaded THIS profile (or an admin) settles; the other side\'s owner only asks', async () => {
        const r = await settleNotSamePerson(db as never, { actor: 'east@x.org', adopterId: 'new', rejectedIds: ['old'], offered, ctx: {}, settleBy: 'subject' });
        expect(r.recorded).toEqual([]);
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'pending', confidence: 'medium' }]);
    });
});
