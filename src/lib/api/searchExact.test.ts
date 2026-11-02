/**
 * POST /api/v1/search exact mode on the identity verdict (spec 2026-11-02 decisions 1–4):
 * a social account is an identifier, a DNI alone is the same person, junk links nobody.
 * Real SQL (every drizzle/*.sql replayed), the real token index, the real save path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', async (orig) => ({
    ...(await orig<typeof import('@/lib/logger')>()),
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));
// Idempotency and caps are not what this file tests: no replay, no cap, no claim.
vi.mock('./handler', async (orig) => ({
    ...(await orig<typeof import('./handler')>()),
    replayIdempotent: vi.fn(async () => null),
    enforceDailyCap: vi.fn(async () => undefined),
    claimIdempotencyKey: vi.fn(async () => undefined),
}));

import { fuzzyIdentityOf, runSearch } from './search';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, deserializeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { apiSocialHandle, apiSocialHandles, checkSearchRules, searchRequestSchema } from './schemas';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[]; get: (...a: unknown[]) => Row | undefined } };
const OWNER = 'rescuer@example.com';

// migratedDb is the SYNC better-sqlite3 driver; D1 returns promises and the reads chain .catch on them.
function asyncDb<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                if (p === 'get' || p === 'all' || p === 'run') return Promise.resolve(out);
                return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
            };
        },
    });
}

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
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [
        e('phone', '+54 9 11 6585 1333'), e('email', 'maria.perez@gmail.com'), e('id', '30123456'), e('social', 'mariajose.p', 'instagram'),
    ]);
    await seed('jg', 'Juan Gómez', [e('phone', '+54 9 11 7777 8888'), e('id', '00000000')]);
});

let n = 0;
async function exact(person: Record<string, unknown>, opts: { dryRun?: boolean } = {}) {
    const body = { mode: 'exact', person, activity: { activityType: 'adoption_request', externalId: `ext-${++n}` } };
    const ctx = {
        db: state.db, key: { id: 'k1', name: 'Partner', ownerEmail: OWNER, importMode: null },
        scopes: ['search', 'search:fuzzy', 'record:write'], requestId: `req-${n}`, origin: 'https://staging.buenadoptante.org',
        bodyText: JSON.stringify(body), bodyBytes: null, idempotencyKey: null, log: {}, rowClaimed: false, dryRun: opts.dryRun === true,
        query: new URLSearchParams(), limited: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await runSearch(ctx as never)).body as any;
}

describe('API exact on the identity verdict', () => {
    it('name + Instagram handle is a valid exact call; a compatible name is found on the social', async () => {
        const r = await exact({ fullName: 'María Pérez', socials: [{ platform: 'instagram', handle: '@mariajose.p' }] });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['social'], nameMatchedAs: 'profile' });
        expect(r.saved).toMatchObject({ action: 'added_to_profile', profileId: 'mj' });
    });

    it('«Majo Pérez» + MJ\'s DNI: found, matched as document, and no contact is added', async () => {
        const r = await exact({ fullName: 'Majo Pérez', documentId: { value: '30.123.456' }, email: 'majo.nueva@example.com' });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['documentId'], nameMatchedAs: 'document' });
        expect(r.saved).toMatchObject({ action: 'added_to_profile', profileId: 'mj', contactsAdded: [] });
        const entries = deserializeContactEntries(sqlite.prepare(`SELECT contact_entries AS c FROM adopters WHERE id = 'mj'`).get()!.c as string);
        expect(entries.some(x => x.value === 'majo.nueva@example.com')).toBe(false);
    });

    it('a placeholder DNI (00000000) links nobody: a new profile, never found', async () => {
        const r = await exact({ fullName: 'Ana Ruiz', documentId: { value: '00000000' } });
        expect(r.match).not.toBe('found');
        expect(r.saved.action).toBe('created_profile_for_review');
        expect(r.saved.profileId).not.toBe('jg');
    });

    it('a visible-name social is no identifier, and on a create it is saved as text with its platform', async () => {
        const rules = checkSearchRules(searchRequestSchema.parse({
            mode: 'exact', person: { fullName: 'Sofía Medina', socials: [{ platform: 'facebook', handle: 'Sofia Medina' }] },
            activity: { activityType: 'adoption_request', externalId: 'x' },
        }));
        expect(rules.map(p => p.code)).toEqual(['exact_requires_name_and_identifier']);
        expect(rules[0].message).toMatch(/person\.socials/);

        const r = await exact({ fullName: 'Sofía Medina', email: 'sofia.medina@example.com', socials: [{ platform: 'facebook', handle: 'Sofia Medina' }] });
        expect(r.saved.action).toBe('created_profile');
        const entries = deserializeContactEntries(sqlite.prepare(`SELECT contact_entries AS c FROM adopters WHERE id = ?`).get(r.saved.profileId)!.c as string);
        expect(entries.find(x => x.type === 'social')).toMatchObject({ value: 'Sofia Medina', platform: 'facebook' });
    });

    it('dry run on the DNI-only path: says found / document / added_to_profile and writes nothing', async () => {
        const r = await exact({ fullName: 'Majo Pérez', documentId: { value: '30.123.456' } }, { dryRun: true });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', nameMatchedAs: 'document' });
        expect(r.saved).toEqual({ action: 'added_to_profile', dryRun: true });
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adoptions`).get()!.n).toBe(0);
    });
});

// Ruling R10: a DNI written only in a free-text note (the index reads labeled ids there too)
// is not the profile's DNI field: it identifies like an email or a phone, never «any name».
describe('a DNI held only in a note', () => {
    beforeEach(async () => {
        await seed('lg', 'Laura Gómez', [e('phone', '+54 9 11 2020 3030'), e('other', 'Garante DNI 22333444')]);
    });

    it('«Marta Ruiz» + 22.333.444: not found as document, a new profile for review', async () => {
        const r = await exact({ fullName: 'Marta Ruiz', documentId: { value: '22.333.444' } });
        expect(r.match).not.toBe('found');
        expect(r.profile?.nameMatchedAs).not.toBe('document');
        expect(r.saved.action).toBe('created_profile_for_review');
        expect(r.saved.profileId).not.toBe('lg');
    });

    it('«Laura Gómez» + 22.333.444: found on her profile by name', async () => {
        const r = await exact({ fullName: 'Laura Gómez', documentId: { value: '22.333.444' } });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'lg', matchedOn: ['documentId'], nameMatchedAs: 'profile' });
    });
});

/** Payloads that already sent socials alongside an email (the docs' «Completo» example, Catpuccino). */
describe('email + socials: the social now counts', () => {
    const person = { fullName: 'María José Pérez', email: 'maria.perez@gmail.com', phone: '11 4000-1234', socials: [{ platform: 'instagram', handle: '@mariajose.p' }] };

    it('(a) the social is also on a compatible-name duplicate: ambiguous, best match on MJ, both in the risk, no contacts added', async () => {
        await seed('mj2', 'María Pérez', [e('social', 'mariajose.p', 'instagram')]);
        const r = await exact(person);
        expect(r.match).toBe('ambiguous');
        expect(r.reason).toBe('multiple_profiles');
        expect(r.candidates).toEqual([
            { profileId: 'mj', url: expect.any(String), nameMatchedAs: 'profile' },
            { profileId: 'mj2', url: expect.any(String), nameMatchedAs: 'profile' },
        ]);
        expect(r.otherMatches).toBeUndefined();
        expect(r.risk.profilesMatched).toBe(2);
        expect(r.saved).toMatchObject({ action: 'added_to_best_match', profileId: 'mj', contactsAdded: [] });
    });

    it('(b) the social is also on a different-name profile: found MJ, the other in otherMatches and the risk, the new phone added', async () => {
        await seed('pg', 'Pedro Gil', [e('social', 'mariajose.p', 'instagram')]);
        const r = await exact(person);
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['email', 'social'], nameMatchedAs: 'profile' });
        expect(r.otherMatches).toEqual([{ profileId: 'pg', url: expect.any(String) }]);
        expect(r.risk.profilesMatched).toBe(2);
        expect(r.saved).toMatchObject({ action: 'added_to_profile', profileId: 'mj', contactsAdded: ['phone'] });
    });

    it('a social held by more than 3 names (the rescue\'s own account) is nobody: those profiles are left out entirely', async () => {
        for (const [id, n] of [['r1', 'Beto Sosa'], ['r2', 'Carla Díaz'], ['r3', 'Darío Vega'], ['r4', 'Elsa Ortiz']]) {
            await seed(id, n, [e('social', 'refugio.oficial', 'instagram')]);
        }
        const r = await exact({ ...person, socials: [{ platform: 'instagram', handle: '@refugio.oficial' }] });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['email'] });
        expect(r.otherMatches).toBeUndefined();
        expect(r.risk.profilesMatched).toBe(1);
    });

    it('a Facebook handle below 3 characters or in the stoplist is no account («no», «-», «x», «photo»)', () => {
        for (const handle of ['no', '-', 'x', '@x', 'photo', 'share']) {
            expect(apiSocialHandle({ platform: 'facebook', handle })).toBeNull();
        }
        expect(apiSocialHandle({ platform: 'facebook', handle: 'ana.perez' })).toBe('ana.perez');
        expect(apiSocialHandle({ platform: 'facebook', handle: 'facebook.com/profile.php?id=100012345' })).toBe('id:100012345');
        const rules = checkSearchRules(searchRequestSchema.parse({
            mode: 'exact', person: { fullName: 'Sofía Medina', socials: [{ platform: 'facebook', handle: 'no' }, { platform: 'facebook', handle: '-' }] },
            activity: { activityType: 'adoption_request', externalId: 'x' },
        }));
        expect(rules.map(p => p.code)).toEqual(['exact_requires_name_and_identifier']);
    });

    // Each hit profile is one read; a placeholder handle typed by hundreds used to cost 50 per handle.
    const profileReads = (sqls: string[]) => sqls.filter(q => /^select "id", "name", "contact_entries", "is_demo" from "adopters"/.test(q)).length;
    function recordSql(): string[] {
        const seen: string[] = [];
        const real = sqlite.prepare.bind(sqlite);
        vi.spyOn(sqlite, 'prepare').mockImplementation((q: string) => { seen.push(q); return real(q); });
        return seen;
    }

    it('a handle shared by 60 profiles with many names reads none of them, and still links nobody', async () => {
        for (let i = 0; i < 60; i++) await seed(`w${i}`, `Persona${'abcdefgh'[i % 8]} Apellido${'abcdefgh'[i % 8]}`, [e('social', 'refugio.oficial', 'instagram')]);
        const seen = recordSql();
        const r = await exact({ ...person, socials: [{ platform: 'instagram', handle: '@refugio.oficial' }] });
        expect(r.match).toBe('found');
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['email'] });
        expect(r.risk.profilesMatched).toBe(1);
        expect(profileReads(seen)).toBe(1);
    });

    it('a handle whose first 50 holders share one name but which more names hold is still junk', async () => {
        for (let i = 0; i < 50; i++) await seed(`g${i}`, 'Ana Gil', [e('social', 'casi.junk', 'instagram')]);
        for (const [id, n] of [['b1', 'Beto Sosa'], ['b2', 'Carla Díaz'], ['b3', 'Darío Vega']]) await seed(id, n, [e('social', 'casi.junk', 'instagram')]);
        const seen = recordSql();
        const r = await exact({ ...person, socials: [{ platform: 'instagram', handle: '@casi.junk' }] });
        expect(seen.some(q => /^select distinct /.test(q))).toBe(true); // the name probe beyond the sample ran
        expect(r.profile).toMatchObject({ profileId: 'mj', matchedOn: ['email'] });
        expect(r.risk.profilesMatched).toBe(1);
        expect(profileReads(seen)).toBe(1);
    });

    it('a handle on many profiles of one name is no junk: every holder is read and in the risk', async () => {
        for (let i = 0; i < 15; i++) await seed(`d${i}`, 'María Pérez', [e('social', 'mariajose.p', 'instagram')]);
        const seen = recordSql();
        const r = await exact(person);
        expect(r.match).toBe('ambiguous');
        expect(r.saved).toMatchObject({ action: 'added_to_best_match', profileId: 'mj' });
        expect(r.risk.profilesMatched).toBe(16); // MJ + all 15 holders of the handle
        expect(profileReads(seen)).toBe(16);
    });

    it('looks up at most the first 3 accounts that are accounts', () => {
        expect(apiSocialHandles([
            { platform: 'facebook', handle: 'Ana Perez' }, { platform: 'instagram', handle: '@a.one' }, { platform: 'instagram', handle: 'a.one' },
            { platform: 'tiktok', handle: '@a.two' }, { platform: 'x', handle: 'a.three' }, { platform: 'threads', handle: 'a.four' },
        ])).toEqual(['a.one', 'a.two', 'a.three']);
    });
});

describe('fuzzy: the identity verdict sees the same accounts as exact', () => {
    it('socials go through apiSocialHandles: display names, short / placeholder handles and extras beyond 3 are left out', () => {
        const id = fuzzyIdentityOf({
            fullName: 'Ana Pérez',
            socials: [
                { platform: 'facebook', handle: 'Ana Perez' }, { platform: 'facebook', handle: 'no' }, { platform: 'facebook', handle: '-' },
                { platform: 'instagram', handle: '@a.one' }, { platform: 'facebook', handle: 'facebook.com/profile.php?id=100012345' },
                { platform: 'tiktok', handle: '@a.two' }, { platform: 'x', handle: 'a.three' },
            ],
        } as never);
        expect(id.socials).toEqual(['a.one', 'id:100012345', 'a.two']);
    });

    it('no account at all: no socials key', () => {
        expect(fuzzyIdentityOf({ fullName: 'Ana Pérez', socials: [{ platform: 'facebook', handle: 'no' }] } as never)).not.toHaveProperty('socials');
    });
});
