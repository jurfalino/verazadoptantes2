/**
 * Identity verdict, Task 3 — matchImportRow over real SQL (every drizzle/*.sql replayed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, user: 'rescuer@example.com', getDbCalls: 0 } }));

vi.mock('@/app/actions/_db', () => ({
    getDb: async () => { state.getDbCalls++; return state.db; },
    getUser: async () => { if (!state.user) throw new Error('no session'); return state.user; },
}));
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
import { judgeCandidates } from '@/lib/identityCandidates';
import { ownerCountry } from '@/lib/api/profiles';
import { clearActorCountryCache } from '@/lib/actorCountry';
import { logger } from '@/lib/logger';
import { matchImportRow, type ImportRowIdentity } from './importIdentityMatches';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', 'rescuer@example.com', 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}
const e = (type: ContactEntry['type'], value: string, platform?: string): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, ...(platform ? { platform } : {}), addedBy: 'rescuer@example.com' } as ContactEntry);

const row = (over: Partial<ImportRowIdentity>): ImportRowIdentity => ({ name: '', phones: [], emails: [], socials: [], documentIds: [], ...over });

beforeEach(async () => {
    vi.clearAllMocks();
    state.user = 'rescuer@example.com';
    state.getDbCalls = 0;
    clearActorCountryCache();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [
        e('phone', '+54 9 11 6585 1333'), e('email', 'maria.perez@gmail.com'), e('id', '30123456'),
    ]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
    await seed('jg', 'Juan Gómez', [e('phone', '+54 9 11 7777 8888')]);
});

describe('matchImportRow', () => {
    it('refuses a signed-out caller before any DB read', async () => {
        state.user = '';
        const r = await matchImportRow(row({ name: 'María Pérez' }));
        expect(r).toEqual({ ok: false, errorId: 'unauth' });
        expect(state.getDbCalls).toBe(0);
    });

    it('same person first, then the possible one', async () => {
        const r = await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.matches[0]).toMatchObject({ adopterId: 'mj', adopterName: 'María José Pérez', verdict: 'same' });
        expect(r.matches[1]).toMatchObject({ adopterId: 'mp', verdict: 'possible' });
        expect(r.matches.length).toBeLessThanOrEqual(3);
    });

    it('trims and caps the inputs', async () => {
        await matchImportRow(row({
            name: `  ${'x'.repeat(300)}  `,
            phones: Array.from({ length: 9 }, (_, i) => ` 11 000${i} `),
            emails: [`${'a'.repeat(300)}@x.com`],
        }));
        const facts = vi.mocked(judgeCandidates).mock.calls[0][1];
        expect(facts.name).toHaveLength(200);
        expect(facts.phones).toHaveLength(5);
        expect(facts.phones[0]).toBe('11 0000');
        expect(facts.emails[0]).toHaveLength(200);
    });

    it('a thrown retrieval returns an errorId logged with actor context only', async () => {
        vi.mocked(judgeCandidates).mockRejectedValueOnce(new Error('boom'));
        const r = await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        expect(r).toEqual({ ok: false, errorId: 'err12345' });
        expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { actor: 'rescuer@example.com' });
    });

    const leaky = () => Object.assign(new Error('Failed query: select 1 where "token_value" = ?\nparams: phone,1165851333'), {
        cause: new Error('D1_ERROR: boom\nparams: 1165851333'),
    });
    it('a thrown retrieval logs no bound values (Drizzle "params:")', async () => {
        vi.mocked(judgeCandidates).mockRejectedValueOnce(leaky());
        const r = await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        expect(r).toEqual({ ok: false, errorId: 'err12345' });
        const [, err] = vi.mocked(logger.error).mock.calls[0] as unknown as [string, Error];
        expect(`${err.message} ${JSON.stringify(err)} ${String((err as { cause?: unknown }).cause ?? '')}`).not.toMatch(/65851333/);
        expect(err.message).toContain('Failed query');
    });
    it("the actor's country is looked up once for many rows", async () => {
        await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        await matchImportRow(row({ name: 'Juan Gómez', phones: ['11 7777-8888'] }));
        expect(ownerCountry).toHaveBeenCalledTimes(1);
    });
    it('concurrent first rows each look up (an in-flight lookup is never shared across requests)', async () => {
        await Promise.all([1, 2, 3].map(() => matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }))));
        expect(ownerCountry).toHaveBeenCalledTimes(3);
    });
    it('once a lookup has resolved, later rows within the TTL make no new lookup', async () => {
        await Promise.all([1, 2].map(() => matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }))));
        vi.mocked(ownerCountry).mockClear();
        await matchImportRow(row({ name: 'Juan Gómez', phones: ['11 7777-8888'] }));
        expect(ownerCountry).not.toHaveBeenCalled();
    });
    it('a failed country lookup is not cached', async () => {
        vi.mocked(ownerCountry).mockRejectedValueOnce(new Error('boom'));
        await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        expect(ownerCountry).toHaveBeenCalledTimes(2);
    });
    it('the cached country expires after 10 minutes', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        try {
            await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
            now.mockReturnValue(1_000_000 + 9 * 60_000);
            await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
            expect(ownerCountry).toHaveBeenCalledTimes(1);
            now.mockReturnValue(1_000_000 + 10 * 60_000 + 1);
            await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
            expect(ownerCountry).toHaveBeenCalledTimes(2);
        } finally { now.mockRestore(); }
    });
    it('a failed country lookup logs no bound values', async () => {
        vi.mocked(ownerCountry).mockRejectedValueOnce(leaky());
        const r = await matchImportRow(row({ name: 'María Pérez', phones: ['11 6585-1333'] }));
        expect(r.ok).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('country lookup failed'), expect.anything());
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/65851333/);
    });
});
