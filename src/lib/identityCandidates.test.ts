/**
 * Identity verdict, Task 2 — candidate retrieval over real SQL (every drizzle/*.sql
 * replayed) and the real token index / duplicate engine.
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

import { tokenizeAdopter } from './adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from './contactEntries';
import { findIdentityCandidates, judgeCandidates } from './identityCandidates';
import { logger } from '@/lib/logger';
import type { PersonFacts } from '@/domain/identityVerdict';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof findIdentityCandidates>[0];

const facts = (over: Partial<PersonFacts>): PersonFacts => ({
    name: '', aliases: [], phones: [], emails: [], socials: [], documentIds: [], country: 'AR', ...over,
});

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', 'rescuer@example.com', 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}
const e = (type: ContactEntry['type'], value: string, platform?: string): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, ...(platform ? { platform } : {}), addedBy: 'rescuer@example.com' } as ContactEntry);

beforeEach(async () => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [
        e('phone', '+54 9 11 6585 1333'), e('email', 'maria.perez@gmail.com'), e('id', '30123456'), e('social', 'mariajose.p', 'instagram'),
    ]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
    await seed('jg', 'Juan Gómez', [e('phone', '+54 9 11 7777 8888')]);
});

const byId = (list: Awaited<ReturnType<typeof findIdentityCandidates>>, id: string) => list.find(c => c.adopterId === id);

describe('findIdentityCandidates', () => {
    it('keeps a same-name candidate that shares nothing with the input phone (suppression off)', async () => {
        const list = await findIdentityCandidates(db(), facts({ name: 'María José Pérez', phones: ['11 2222-3333'] }), {});
        expect(byId(list, 'mj')).toMatchObject({ shared: [], source: expect.any(String) });
    });

    it('a shared phone is reported once, held by one name', async () => {
        const list = await findIdentityCandidates(db(), facts({ name: 'María Pérez', phones: ['11 6585-1333'] }), {});
        const mj = byId(list, 'mj')!;
        expect(mj.shared).toHaveLength(1);
        expect(mj.shared[0]).toMatchObject({ kind: 'phone', namesHolding: 1 });
    });

    it('a shared document id is reported as kind document, normalized', async () => {
        const list = await findIdentityCandidates(db(), facts({ name: 'Majo Pérez', documentIds: ['30.123.456'] }), {});
        expect(byId(list, 'mj')!.shared).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'document', value: '30123456' })]));
    });

    it('a shared social handle is reported once as kind social', async () => {
        const list = await findIdentityCandidates(db(), facts({ name: 'Majo Pérez', socials: ['instagram.com/mariajose.p'] }), {});
        const social = byId(list, 'mj')!.shared.filter(s => s.kind === 'social');
        expect(social).toHaveLength(1);
        expect(social[0].namesHolding).toBe(1);
    });

    it("returns the candidate's alias entries in aliases", async () => {
        await seed('al', 'Lucía Torres', [e('alias', 'Lu Torres'), e('phone', '+54 9 11 3030 4040')]);
        const list = await findIdentityCandidates(db(), facts({ name: 'Lucía Torres' }), {});
        expect(byId(list, 'al')!.aliases).toEqual(['Lu Torres']);
    });

    it('an email held by four differently named profiles counts four names', async () => {
        for (const [id, n] of [['x1', 'Ana Ruiz'], ['x2', 'Beto Sosa'], ['x3', 'Carla Díaz'], ['x4', 'Darío Vega']]) {
            await seed(id, n, [e('email', 'shared@example.com')]);
        }
        const list = await findIdentityCandidates(db(), facts({ name: 'Ana Ruiz', emails: ['shared@example.com'] }), {});
        const ana = byId(list, 'x1')!;
        expect(ana.shared.find(s => s.kind === 'email')!.namesHolding).toBe(4);
    });

    it('a soft-deleted profile sharing the phone is absent', async () => {
        await seed('gone', 'Pepe Gone', [e('phone', '+54 9 11 6585 1333')]);
        sqlite.prepare(`UPDATE adopters SET deleted_at = 1000 WHERE id = 'gone'`).run();
        const list = await findIdentityCandidates(db(), facts({ name: 'María Pérez', phones: ['11 6585-1333'] }), {});
        expect(byId(list, 'gone')).toBeUndefined();
        // and does not inflate the count of names holding the phone
        expect(byId(list, 'mj')!.shared[0].namesHolding).toBe(1);
    });

    it('a failed detail read still returns the candidate, degraded, with a warn carrying the adopter id', async () => {
        const real = db();
        const failing = new Proxy(real as object, {
            get(t, prop, r) {
                const v = Reflect.get(t, prop, r);
                if (prop !== 'select') return typeof v === 'function' ? v.bind(t) : v;
                return (fields: Record<string, unknown>) => {
                    if (fields && 'contactEntries' in fields) {
                        return { from: () => ({ where: () => ({ limit: () => Promise.reject(new Error('boom')) }) }) };
                    }
                    return (v as (f: unknown) => unknown).call(t, fields);
                };
            },
        }) as ReturnType<typeof db>;
        const list = await findIdentityCandidates(failing, facts({ name: 'María Pérez', phones: ['11 6585-1333'] }), { op: 'test' });
        const mj = byId(list, 'mj')!;
        expect(mj.degraded).toBe(true);
        expect(mj.name).toBe('María José Pérez');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('D1 fallback hit'), expect.objectContaining({ adopterId: 'mj', op: 'test' }));
        const judged = await judgeCandidates(failing, facts({ name: 'María Pérez', phones: ['11 6585-1333'] }), { op: 'test' });
        expect(judged.find(j => j.candidate.adopterId === 'mj')).toMatchObject({ verdict: 'possible', reason: 'details_unavailable' });
        expect(judged.find(j => j.candidate.adopterId === 'mj')!.verdict).not.toBe('same');
    });

    it('a failed name-count leaves namesHolding null, logged, and the verdict is never same', async () => {
        const real = db();
        const failing = new Proxy(real as object, {
            get(t, prop, r) {
                const v = Reflect.get(t, prop, r);
                if (prop !== 'select') return typeof v === 'function' ? v.bind(t) : v;
                return (fields: Record<string, unknown>) => {
                    if (fields && Object.keys(fields).length === 1 && 'name' in fields) {
                        return { from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.reject(new Error('boom')) }) }) }) };
                    }
                    return (v as (f: unknown) => unknown).call(t, fields);
                };
            },
        }) as ReturnType<typeof db>;
        const list = await findIdentityCandidates(failing, facts({ name: 'María José Pérez', phones: ['11 6585-1333'] }), {});
        expect(byId(list, 'mj')!.shared[0].namesHolding).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('D1 fallback hit'), expect.anything());
        const judged = await judgeCandidates(failing, facts({ name: 'María José Pérez', phones: ['11 6585-1333'] }), {});
        expect(judged.find(j => j.candidate.adopterId === 'mj')).toMatchObject({ verdict: 'possible', reason: 'details_unavailable' });
        expect(judged.some(j => j.verdict === 'same')).toBe(false);
    });
});

describe('failure logs never carry the bound values', () => {
    // Drizzle's DrizzleQueryError message ends with "params: <bound values>" — a phone, an email, a DNI.
    const leaky = () => Object.assign(new Error('Failed query: select "name" from "duplicate_tokens" where "token_value" = ?\nparams: phone,1165851333'), {
        cause: new Error('D1_ERROR: bad thing\nparams: 1165851333'),
    });
    const failingWhere = (pick: (fields: Record<string, unknown>) => boolean, join: boolean) => new Proxy(db() as object, {
        get(t, prop, r) {
            const v = Reflect.get(t, prop, r);
            if (prop !== 'select') return typeof v === 'function' ? v.bind(t) : v;
            return (fields: Record<string, unknown>) => {
                if (fields && pick(fields)) {
                    const tail = { where: () => ({ limit: () => Promise.reject(leaky()) }) };
                    return { from: () => (join ? { innerJoin: () => tail } : tail) };
                }
                return (v as (f: unknown) => unknown).call(t, fields);
            };
        },
    }) as ReturnType<typeof db>;

    it('a failed name count logs no digits of the phone', async () => {
        const failing = failingWhere(f => Object.keys(f).length === 1 && 'name' in f, true);
        await findIdentityCandidates(failing, facts({ name: 'María José Pérez', phones: ['11 6585-1333'] }), {});
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('name count'), expect.anything());
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/65851333|1165851333/);
    });
    it('a failed detail read logs no digits of the phone', async () => {
        const failing = failingWhere(f => 'contactEntries' in f, false);
        await findIdentityCandidates(failing, facts({ name: 'María José Pérez', phones: ['11 6585-1333'] }), {});
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('details'), expect.objectContaining({ adopterId: 'mj' }));
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/65851333|1165851333/);
    });
});

describe('judgeCandidates', () => {
    it('a placeholder phone is no evidence, even when its digits sit in another profile\'s contacts', async () => {
        await seed('ph', 'Pedro Sosa', [e('id', '00000000'), e('phone', '+54 9 11 3131 3131')]);
        const out = await judgeCandidates(db(), facts({ name: 'Ana Ruiz', phones: ['0000 0000'] }), {});
        expect(out.find(j => j.candidate.adopterId === 'ph')).toBeUndefined();
    });
    it('a real number whose last digits repeat is still matched by its token (same)', async () => {
        await seed('rep', 'Rosa Luna', [e('phone', '+54 9 11 4444 4444')]);
        const out = await judgeCandidates(db(), facts({ name: 'Rosa Luna', phones: ['11 4444-4444'] }), {});
        expect(out.find(j => j.candidate.adopterId === 'rep')).toMatchObject({ verdict: 'same', reason: 'shared_contact_name_compatible' });
    });
    it('an untokenized contact found by the LIKE fallback is possible, never same', async () => {
        // A legacy profile: free-text contact_info holds the phone; no contact entries, no tokens.
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
            VALUES ('legacy', 'Rosa Luna', '5', 'rescuer@example.com', 'AR', 1000, 1000, '[]', 'Tel 1124242525')`).run();
        const out = await judgeCandidates(db(), facts({ name: 'Rosa Luna', phones: ['11 2424-2525'] }), {});
        expect(out.find(j => j.candidate.adopterId === 'legacy')).toMatchObject({ verdict: 'possible' });
        const other = await judgeCandidates(db(), facts({ name: 'Juan Paz', phones: ['11 2424-2525'] }), {});
        expect(other.find(j => j.candidate.adopterId === 'legacy')).toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    async function seedNamesakes() {
        for (let i = 1; i <= 5; i++) await seed(`lf${i}`, 'Lucía Fernández', [e('phone', `+54 9 11 5000 000${i}`)]);
    }
    it('five namesakes do not crowd out the profile holding the DNI (judged possible, like a phone)', async () => {
        await seedNamesakes();
        await seed('dni', 'Paola Ríos', [e('id', '27999888')]);
        const out = await judgeCandidates(db(), facts({ name: 'Lucía Fernández', documentIds: ['27.999.888'] }), {});
        expect(out.find(j => j.candidate.adopterId === 'dni')).toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
        expect(out.length).toBeLessThanOrEqual(5);
    });
    it('five namesakes do not crowd out the profile holding the email (judged possible)', async () => {
        await seedNamesakes();
        await seed('em', 'Paola Ríos', [e('email', 'lucia.f@example.com')]);
        const out = await judgeCandidates(db(), facts({ name: 'Lucía Fernández', emails: ['lucia.f@example.com'] }), {});
        expect(out.find(j => j.candidate.adopterId === 'em')).toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
        expect(out.length).toBeLessThanOrEqual(5);
    });
    it('a different name on a shared phone is possible, not same', async () => {
        const out = await judgeCandidates(db(), facts({ name: 'Juan Carlos Ruiz', phones: ['11 6585-1333'] }), {});
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ verdict: 'possible', candidate: { adopterId: 'mj' } });
    });
});
