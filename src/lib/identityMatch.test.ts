/**
 * findPersonMatches — the one verdict call every surface uses, over real SQL
 * (every drizzle/*.sql replayed) and the real token index.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/api/profiles', async (orig) => {
    const real = await orig<typeof import('@/lib/api/profiles')>();
    return { ...real, ownerCountry: vi.fn(real.ownerCountry) };
});
vi.mock('@/lib/identityCandidates', async (orig) => {
    const real = await orig<typeof import('@/lib/identityCandidates')>();
    return { ...real, judgeCandidates: vi.fn(real.judgeCandidates) };
});

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { ownerCountry } from '@/lib/api/profiles';
import { judgeCandidates } from '@/lib/identityCandidates';
import { clearActorCountryCache } from '@/lib/actorCountry';
import { logger } from '@/lib/logger';
import { findPersonMatches } from './identityMatch';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const OWNER = 'rescuer@example.com';
const e = (type: ContactEntry['type'], value: string, platform?: string): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, ...(platform ? { platform } : {}), addedBy: OWNER } as ContactEntry);

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, OWNER, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}

beforeEach(async () => {
    vi.clearAllMocks();
    clearActorCountryCache();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [
        e('phone', '+54 9 11 6585 1333'), e('email', 'maria.perez@gmail.com'), e('id', '30123456'), e('social', 'mariajose.p', 'instagram'),
    ]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
});

const db = () => state.db as Parameters<typeof findPersonMatches>[0];
const brief = (r: Array<{ adopterId: string; verdict: string }>) => r.map(x => ({ adopterId: x.adopterId, verdict: x.verdict }));

describe('findPersonMatches', () => {
    it('same phone, different name -> possible', async () => {
        const r = await findPersonMatches(db(), { name: 'Juan Carlos Ruiz', phones: ['11 6585-1333'] }, { actor: OWNER, country: 'AR' });
        expect(brief(r)).toEqual([{ adopterId: 'mj', verdict: 'possible' }]);
    });

    it('compatible name + DNI -> same', async () => {
        const r = await findPersonMatches(db(), { name: 'María Pérez', documentIds: ['30.123.456'] }, { actor: OWNER, country: 'AR' });
        // 'mp' («María Pérez», no DNI) is the same full name: possible.
        expect(brief(r)).toEqual([{ adopterId: 'mj', verdict: 'same' }, { adopterId: 'mp', verdict: 'possible' }]);
        expect(r[0]).toMatchObject({ adopterName: 'María José Pérez', source: expect.any(String) });
    });

    it('another name + DNI -> possible, like a phone (Jon 2026-11-02)', async () => {
        const r = await findPersonMatches(db(), { name: 'Majo Pérez', documentIds: ['30.123.456'] }, { actor: OWNER, country: 'AR' });
        expect(brief(r)).toEqual([{ adopterId: 'mj', verdict: 'possible' }]);
    });

    it('excludeAdopterId removes the profile', async () => {
        const r = await findPersonMatches(db(), { name: 'Juan Carlos Ruiz', phones: ['11 6585-1333'] }, { actor: OWNER, country: 'AR', excludeAdopterId: 'mj' });
        expect(r).toEqual([]);
    });

    it('excludeAdopterId is applied before the limit', async () => {
        const base = { name: 'María José Pérez', documentIds: ['30123456'], phones: ['11 4444 5555'] };
        const all = await findPersonMatches(db(), base, { actor: OWNER, country: 'AR', limit: 1 });
        expect(all).toHaveLength(1);
        const first = all[0].adopterId;
        const rest = await findPersonMatches(db(), base, { actor: OWNER, country: 'AR', limit: 1, excludeAdopterId: first });
        expect(rest.map(x => x.adopterId)).not.toContain(first);
        expect(rest).toHaveLength(1);
    });

    it('a visible-name social is not an account: no match, no throw, passed through untouched', async () => {
        const r = await findPersonMatches(db(), { name: 'Zoe Quiroga', socials: ['Lau Benítez Rescate'] }, { actor: OWNER, country: 'AR' });
        expect(r).toEqual([]);
        expect(vi.mocked(judgeCandidates).mock.calls[0][1].socials).toEqual(['Lau Benítez Rescate']);
        expect(vi.mocked(judgeCandidates).mock.calls[0][1].aliases).toEqual([]);
    });

    it('reads the country once (cached) when actor is given and phones are present; not without phones', async () => {
        await findPersonMatches(db(), { name: 'A B', phones: ['11 6585-1333'] }, { actor: OWNER });
        await findPersonMatches(db(), { name: 'C D', phones: ['11 6585-1333'] }, { actor: OWNER });
        expect(ownerCountry).toHaveBeenCalledTimes(1);
        vi.mocked(ownerCountry).mockClear();
        clearActorCountryCache();
        await findPersonMatches(db(), { name: 'María José Pérez', emails: ['maria.perez@gmail.com'] }, { actor: OWNER });
        expect(ownerCountry).not.toHaveBeenCalled();
    });

    it('an explicit country (even null) is used without a lookup', async () => {
        await findPersonMatches(db(), { name: 'A B', phones: ['11 6585-1333'] }, { actor: OWNER, country: null });
        expect(ownerCountry).not.toHaveBeenCalled();
        expect(vi.mocked(judgeCandidates).mock.calls[0][1].country).toBeNull();
    });

    it('a failed country lookup warns (redacted) and continues with null', async () => {
        vi.mocked(ownerCountry).mockRejectedValueOnce(new Error('boom\nparams: 1165851333'));
        const r = await findPersonMatches(db(), { name: 'A B', phones: ['11 6585-1333'] }, { actor: OWNER });
        expect(Array.isArray(r)).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('country lookup failed'), expect.anything());
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/65851333/);
    });

    it('returns only same/possible, same before possible', async () => {
        const r = await findPersonMatches(db(), { name: 'María José Pérez', phones: ['11 4444 5555'], documentIds: ['30123456'] }, { actor: OWNER, country: 'AR' });
        expect(r.length).toBeGreaterThan(0);
        for (const x of r) expect(['same', 'possible']).toContain(x.verdict);
        const firstPossible = r.findIndex(x => x.verdict === 'possible');
        if (firstPossible !== -1) expect(r.slice(firstPossible).every(x => x.verdict === 'possible')).toBe(true);
        expect(r[0].verdict).toBe('same');
    });

    it('limit is honored', async () => {
        const input = { name: 'María José Pérez', phones: ['11 4444 5555'], documentIds: ['30123456'] };
        const r = await findPersonMatches(db(), input, { actor: OWNER, country: 'AR', limit: 1 });
        expect(r).toHaveLength(1);
    });

    it('throws on retrieval failure (callers own fallback)', async () => {
        vi.mocked(judgeCandidates).mockRejectedValueOnce(new Error('boom'));
        await expect(findPersonMatches(db(), { name: 'A B' }, { actor: OWNER })).rejects.toThrow('boom');
    });

    it('trims and drops empty values', async () => {
        await findPersonMatches(db(), { name: '  Ana  ', phones: ['  ', ' 11 1 '], emails: [''] }, { country: 'AR' });
        const f = vi.mocked(judgeCandidates).mock.calls[0][1];
        expect(f.name).toBe('Ana');
        expect(f.phones).toEqual(['11 1']);
        expect(f.emails).toEqual([]);
    });
});
