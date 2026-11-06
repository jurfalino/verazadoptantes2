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
    // Step 2: mate@x.org is north@x.org's teammate (the team acts as one).
    isOwnerOrOrgMate: vi.fn(async (viewer: string, owner: string | null) => {
        const v = (viewer ?? '').toLowerCase(), o = (owner ?? '').toLowerCase();
        return !!v && !!o && (v === o || (['north@x.org', 'mate@x.org'].includes(v) && ['north@x.org', 'mate@x.org'].includes(o)));
    }),
    // Rescate Norte: north@x.org and its member mate@x.org.
    getOrgsForEmail: vi.fn(async (email: string) => (['north@x.org', 'mate@x.org'].includes(email) ? [{ id: 'o1', name: 'Rescate Norte' }] : [])),
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
        // The owner's group is named only to its members (the byline's rule, v2.18.15): a helper sees names.
        expect(r.asked).toEqual([{ otherId: 'old', otherName: 'Rosa Díaz', ownerLabels: ['north', 'east'] }]);
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

    it('a member of the owner\'s group sees the group\'s name', async () => {
        // Since step 2 a teammate settles instead of asking; they are asked only on the contact
        // window ('subject') when their team loaded the OTHER side.
        sqlite.prepare(`UPDATE adopters SET added_by = CASE id WHEN 'new' THEN 'east@x.org' ELSE 'north@x.org' END`).run();
        const r = await settleNotSamePerson(db as never, { actor: 'mate@x.org', adopterId: 'new', rejectedIds: ['old'], offered, ctx: {}, settleBy: 'subject' });
        expect(r.asked[0].ownerLabels).toEqual(['east', 'Rescate Norte']);
    });

    it('profiles with no owner: no label (the screen says «los administradores»)', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'anonymous'`).run();
        const r = await run('helper@x.org', ['old']);
        expect(r.asked).toEqual([{ otherId: 'old', otherName: 'Rosa Díaz', ownerLabels: [] }]);
    });
});

describe('step 2 — a teammate answers like the one who loaded it', () => {
    it("a teammate of the profile's loader settles: dismissed, nobody asked", async () => {
        const r = await run('mate@x.org', ['old']);
        expect(r).toMatchObject({ recorded: ['old'], asked: [] });
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'dismissed', confidence: 'low' }]);
    });

    it("an owner stored with capitals still counts for their team", async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'North@X.org' WHERE id = 'new'`).run();
        expect((await run('mate@x.org', ['old'])).recorded).toEqual(['old']);
    });

    it("'subject': a teammate of only the OTHER side's loader asks, never settles", async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'east@x.org' WHERE id = 'new'`).run();
        sqlite.prepare(`UPDATE adopters SET added_by = 'north@x.org' WHERE id = 'old'`).run();
        const r = await settleNotSamePerson(db as never, { actor: 'mate@x.org', adopterId: 'new', rejectedIds: ['old'], offered, ctx: {}, settleBy: 'subject' });
        expect(r.recorded).toEqual([]);
        expect(r.asked).toHaveLength(1);
        expect(rows()).toEqual([{ a: 'new', b: 'old', status: 'pending', confidence: 'medium' }]);
    });
});

