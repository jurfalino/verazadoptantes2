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

import { runSearch } from './search';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, deserializeContactEntries, type ContactEntry } from '@/lib/contactEntries';
import { checkSearchRules, searchRequestSchema } from './schemas';

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
async function exact(person: Record<string, unknown>) {
    const body = { mode: 'exact', person, activity: { activityType: 'adoption_request', externalId: `ext-${++n}` } };
    const ctx = {
        db: state.db, key: { id: 'k1', name: 'Partner', ownerEmail: OWNER, importMode: null },
        scopes: ['search', 'search:fuzzy', 'record:write'], requestId: `req-${n}`, origin: 'https://staging.buenadoptante.org',
        bodyText: JSON.stringify(body), bodyBytes: null, idempotencyKey: null, log: {}, rowClaimed: false, dryRun: false,
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
});
