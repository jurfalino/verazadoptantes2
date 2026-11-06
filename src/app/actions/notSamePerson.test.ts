/**
 * The consistency rule's server action (spec 2026-11-06). Real SQL and the real
 * duplicate search: only a profile the search offers can be answered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, ADMIN, STRANGER } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.user ? { user: { email: session.user, name: 'R' } } : null)) }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()),
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: mocks.isAdmin,
    isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING' || flag === 'ENABLE_GUEST_NAME_MASK' || flag === 'ENABLE_HOUSEHOLD_MEMBERS'),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    notifyOrgMembers: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
// Wrapped, not replaced: counts the gift-form reads of the scan (audit A5) and still reads them.
vi.mock('@/lib/giftRecipients', async (orig) => {
    const real = await orig<typeof import('@/lib/giftRecipients')>();
    return { ...real, giftPhoneEntriesByGiver: vi.fn(real.giftPhoneEntriesByGiver) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { answerNotSamePerson } from './notSamePerson';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const PHONE = '+54 9 11 7777 8888';
const pair = (x: string, y: string) => sqlite.prepare(
    `SELECT status FROM duplicate_candidates WHERE (adopter1_id = ? AND adopter2_id = ?) OR (adopter1_id = ? AND adopter2_id = ?)`).all(x, y, y, x).map(r => r.status);

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, deleted_at) VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`);
    const phone = (id: string, by: string) => JSON.stringify([{ id: `${id}-p`, type: 'phone', value: PHONE, addedBy: by }]);
    insert.run('mine', 'Rosa Diaz', OWNER, phone('mine', OWNER), null);   // the rescuer's new profile
    insert.run('r1', 'Rosa Diaz', OTHER, phone('r1', OTHER), null);       // another rescuer's look-alike
    insert.run('bare', 'Rosa Diaz', OWNER, '[]', null);                    // a profile whose phone is only being typed
    insert.run('gone', 'Rosa Diaz', OWNER, phone('gone', OWNER), 2000);    // merged away
    for (const id of ['mine', 'r1', 'bare']) await tokenizeAdopter(id);
});

describe('answerNotSamePerson — one «no es esta persona» for the contact window, the import and the new-profile form', () => {
    it('the rescuer who loaded the profile saves it: a dismissed pair', async () => {
        expect(await answerNotSamePerson({ adopterId: 'mine', rejectedIds: ['r1'] })).toEqual({ ok: true, recorded: 1, asked: [] });
        expect(pair('mine', 'r1')).toEqual(['dismissed']);
    });

    it('a profile the search would never offer is ignored', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('stranger-profile', 'Juan Perez', '5', ?, 1000, 1000)`).run(OTHER);
        expect(await answerNotSamePerson({ adopterId: 'mine', rejectedIds: ['stranger-profile'] })).toEqual({ ok: true, recorded: 0, asked: [] });
        expect(pair('mine', 'stranger-profile')).toEqual([]);
    });

    it('someone who loaded neither opens the pair for the owners and learns who', async () => {
        session.user = STRANGER;
        const res = await answerNotSamePerson({ adopterId: 'mine', rejectedIds: ['r1'] });
        expect(res).toMatchObject({ ok: true, recorded: 0, asked: [expect.objectContaining({ otherName: 'Rosa Diaz' })] });
        expect(pair('mine', 'r1')).toEqual(['pending']);
    });

    it('the contact being typed is the search input when the profile does not carry it yet', async () => {
        expect(await answerNotSamePerson({ adopterId: 'bare', rejectedIds: ['r1'], typed: { type: 'phone', value: PHONE } })).toMatchObject({ ok: true, recorded: 1 });
        expect(pair('bare', 'r1')).toEqual(['dismissed']);
    });

    it('refuses a merged-away profile, junk input and a signed-out caller', async () => {
        expect(await answerNotSamePerson({ adopterId: 'gone', rejectedIds: ['r1'] })).toEqual({ ok: false, error: 'not_found' });
        expect(await answerNotSamePerson({ adopterId: '', rejectedIds: ['r1'] })).toEqual({ ok: false, error: 'invalid' });
        expect(await answerNotSamePerson({ adopterId: 'mine', rejectedIds: 'r1' as never })).toEqual({ ok: false, error: 'invalid' });
        session.user = null;
        expect(await answerNotSamePerson({ adopterId: 'mine', rejectedIds: ['r1'] })).toEqual({ ok: false, error: 'not_authenticated' });
        expect(pair('mine', 'r1')).toEqual([]);
    });

    it('the typed contact proves nothing about the profile: the other side\'s owner only asks, never settles', async () => {
        session.user = OTHER; // loaded r1, not «bare»
        const res = await answerNotSamePerson({ adopterId: 'bare', rejectedIds: ['r1'], typed: { type: 'phone', value: PHONE } });
        expect(res).toMatchObject({ ok: true, recorded: 0 });
        expect(pair('bare', 'r1')).toEqual(['pending']);
    });

    it('a failed write is an error with its id — never a silent success', async () => {
        sqlite.prepare('DROP TABLE duplicate_candidates').run();
        const res = await answerNotSamePerson({ adopterId: 'mine', rejectedIds: ['r1'] });
        expect(res).toMatchObject({ ok: false, error: 'failed' });
        expect((res as { errorId?: string }).errorId).toBeTruthy();
    });
});

describe('spreadsheet import — a row answered «No, es otra persona» (step 3 review: the label promises an answer)', () => {
    const row = (index: number, rejectedAdopterId?: string) => ({
        index, action: 'create' as const, name: 'Rosa Diaz',
        contactEntries: JSON.stringify([{ id: `x${index}`, type: 'phone', value: PHONE }]),
        adoption: { animalName: null, species: null, recordType: 'observation', rating: null, date: null, details: 'nota', onBehalfOf: null },
        ...(rejectedAdopterId ? { rejectedAdopterId } : {}),
    });
    it('the new profile and the rejected one are saved as two people', async () => {
        const { importAdoptersBatch } = await import('./importBatch');
        const [res] = await importAdoptersBatch([row(0, 'r1')], 'run-nsp-1');
        expect(res.status).toBe('created');
        expect(pair(res.id!, 'r1')).toEqual(['dismissed']);
    });
    it('a row created without that answer (bulk «Crear todas como nuevas», a default) records nothing', async () => {
        const { importAdoptersBatch } = await import('./importBatch');
        const [res] = await importAdoptersBatch([row(1)], 'run-nsp-2');
        expect(res.status).toBe('created');
        expect(pair(res.id!, 'r1')).toEqual([]);
    });
});
