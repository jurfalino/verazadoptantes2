/**
 * D40: after a profile folds into another rescuer's, its owner (and their
 * team) keep seeing the surviving profile's contact — an `all_contact` grant
 * with origin 'merge'. Real SQL (migrated in-memory SQLite).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;

const { logs } = vi.hoisted(() => ({ logs: { warn: [] as Array<[string, Record<string, unknown>]> } }));

vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('@/lib/logger', () => ({
    logger: {
        warn: vi.fn((m: string, ctx: Record<string, unknown>) => { logs.warn.push([m, ctx]); }),
        info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345'),
    },
    generateErrorId: () => 'gen12345',
}));

import { grantAccessAfterFold } from './mergeAccess';
import { hashEntryValue } from './piiAccess';

const ALL = { scope: 'all_contact' } as const;

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the drizzle handle under test
let db: any;
const grants = () => sqlite.prepare('SELECT adopter_id, grantee_email, scope, origin, granted_by_email, entry_ref, revoked_at FROM pii_access_grants ORDER BY grantee_email').all();

beforeEach(() => {
    const m = migratedDb();
    db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    logs.warn.length = 0;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('s-stranger', 'Carla', '5', ?, 1000, 1000), ('s-mate', 'Carla', '5', ?, 1000, 1000), ('s-anon', 'Carla', '5', 'anonymous', 1000, 1000)`)
        .run(STRANGER, MATE);
});

describe('grantAccessAfterFold', () => {
    it("the absorbed profile's owner and each teammate get an all_contact grant on the survivor", async () => {
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(2);
        expect(grants()).toEqual([MATE, OWNER].sort().map(email => ({
            adopter_id: 's-stranger', grantee_email: email, scope: 'all_contact', origin: 'merge',
            granted_by_email: STRANGER, entry_ref: null, revoked_at: null,
        })));
    });

    it('owner email in any case is normalized', async () => {
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: 'Owner@Example.com', actor: STRANGER })).toBe(2);
        expect(grants().map(g => g.grantee_email)).toEqual([MATE, OWNER].sort());
    });

    it('nothing to grant: same owner, the same team, or no real absorbed owner', async () => {
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: STRANGER, actor: STRANGER })).toBe(0);
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-mate', absorbedOwnerEmail: OWNER, actor: OWNER })).toBe(0);
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: null, actor: STRANGER })).toBe(0);
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: 'anonymous', actor: STRANGER })).toBe(0);
        expect(grants()).toEqual([]);
    });

    it('a survivor with no real owner (an admin kept it): the absorbed team still gets access', async () => {
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-anon', absorbedOwnerEmail: STRANGER, actor: ADMIN })).toBe(1);
        expect(grants()).toEqual([expect.objectContaining({ adopter_id: 's-anon', grantee_email: STRANGER, granted_by_email: ADMIN })]);
    });

    it('a live all_contact grant is not duplicated; a revoked one is replaced by a new grant', async () => {
        const ins = sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, origin, granted_by_email, created_at, revoked_at)
            VALUES (?, 's-stranger', ?, 'all_contact', 'request', ?, 1, ?)`);
        ins.run('live', OWNER, STRANGER, null);
        ins.run('revoked', MATE, STRANGER, 5);
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(1);
        const rows = sqlite.prepare(`SELECT grantee_email, origin FROM pii_access_grants WHERE revoked_at IS NULL ORDER BY grantee_email`).all();
        expect(rows).toEqual([{ grantee_email: MATE, origin: 'merge' }, { grantee_email: OWNER, origin: 'request' }]);
    });

    it("with the merge's audit id, the grant ids are recorded on that row (for undo), after any already there", async () => {
        sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-1', ?, ?, 'adopter_merge', 's-stranger', ?, 1)`)
            .run(STRANGER, STRANGER, JSON.stringify({ primaryId: 's-stranger', grantIds: ['older'] }));
        expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER, mergeAuditId: 'audit-1' })).toBe(2);
        const details = JSON.parse(sqlite.prepare(`SELECT details FROM audit_log WHERE id = 'audit-1'`).get()!.details as string);
        const ids = sqlite.prepare(`SELECT id FROM pii_access_grants WHERE origin = 'merge'`).all().map(r => r.id);
        expect(details.primaryId).toBe('s-stranger');
        expect(details.grantIds).toHaveLength(3);
        expect(details.grantIds[0]).toBe('older');
        expect(new Set(details.grantIds.slice(1))).toEqual(new Set(ids));
    });

    it('best-effort: a DB failure is logged with context and returns 0, never throws', async () => {
        sqlite.prepare('DROP TABLE pii_access_grants').run();
        await expect(grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).resolves.toBe(0);
        expect(logs.warn).toContainEqual(['grantAccessAfterFold: access not granted', expect.objectContaining({
            survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER,
        })]);
    });
    describe("absorbed_entries (a fold the survivor's owner never agreed to, final review C1)", () => {
        const ABS = (absorbedId: string) => ({ scope: 'absorbed_entries', absorbedId }) as const;
        beforeEach(() => {
            sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, contact_entries, contact_info) VALUES
                ('abs', 'Carla', '5', ?, 1, 1, 2, ?, NULL), ('abs-blob', 'Carla', '5', ?, 1, 1, 2, NULL, ?)`)
                .run(OWNER, JSON.stringify([
                    { id: 'a', type: 'phone', value: '+54 11 5555 0001' },
                    { id: 'b', type: 'email', value: 'carla@example.org' },
                    { id: 'c', type: 'alias', value: 'Carlita' },
                    { id: 'd', type: 'other', value: 'llamar de tarde' },
                    { id: 'e', type: 'social', value: '@carla', isPublic: true },
                ]), OWNER, 'Tel: +54 11 5555 0009');
        });

        it('one entry grant per maskable value the absorbed profile held, for the owner and each teammate — never all_contact', async () => {
            expect(await grantAccessAfterFold(db, { access: ABS('abs'), survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(4);
            const refs = [hashEntryValue('phone', '+54 11 5555 0001'), hashEntryValue('email', 'carla@example.org')];
            expect(grants().map(g => [g.grantee_email, g.scope, g.entry_ref, g.origin])).toEqual(expect.arrayContaining(
                [MATE, OWNER].flatMap(email => refs.map(ref => [email, 'entry', ref, 'merge'])),
            ));
            expect(grants().filter(g => g.scope === 'all_contact')).toEqual([]);
        });

        it('a legacy profile with only the contact blob: its parsed values', async () => {
            expect(await grantAccessAfterFold(db, { access: ABS('abs-blob'), survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(2);
            expect(new Set(grants().map(g => g.entry_ref))).toEqual(new Set([hashEntryValue('phone', '+54 11 5555 0009')]));
        });

        it('someone already holding all_contact or that same entry gets nothing new', async () => {
            const ins = sqlite.prepare(`INSERT INTO pii_access_grants (id, adopter_id, grantee_email, scope, entry_ref, origin, granted_by_email, created_at)
                VALUES (?, 's-stranger', ?, ?, ?, 'request', ?, 1)`);
            ins.run('full', OWNER, 'all_contact', null, STRANGER);
            ins.run('one', MATE, 'entry', hashEntryValue('phone', '+54 11 5555 0001'), STRANGER);
            expect(await grantAccessAfterFold(db, { access: ABS('abs'), survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(1);
            expect(sqlite.prepare(`SELECT grantee_email, entry_ref FROM pii_access_grants WHERE origin = 'merge'`).all())
                .toEqual([{ grantee_email: MATE, entry_ref: hashEntryValue('email', 'carla@example.org') }]);
        });
    });

    describe('a failure part-way never leaves a live grant undo cannot find (final review I2)', () => {
        beforeEach(() => {
            // The second grantee's insert fails; OWNER's (written first, sorted) succeeds.
            sqlite.prepare(`CREATE TRIGGER boom BEFORE INSERT ON pii_access_grants WHEN NEW.grantee_email = '${MATE}' BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();
        });
        const live = () => sqlite.prepare(`SELECT id, grantee_email FROM pii_access_grants WHERE revoked_at IS NULL`).all();

        it('with the merge audit row: the grants written so far are recorded on it for undo', async () => {
            sqlite.prepare(`INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at) VALUES ('audit-1', ?, ?, 'adopter_merge', 's-stranger', '{}', 1)`)
                .run(STRANGER, STRANGER);
            const n = await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER, mergeAuditId: 'audit-1' });
            const written = live();
            expect(n).toBe(1);
            expect(written.length).toBe(1);
            const details = JSON.parse(sqlite.prepare(`SELECT details FROM audit_log WHERE id = 'audit-1'`).get()!.details as string);
            expect(new Set(details.grantIds)).toEqual(new Set(written.map(r => r.id)));
            expect(logs.warn).toContainEqual(['grantAccessAfterFold: access not granted', expect.objectContaining({ survivorId: 's-stranger', error: expect.stringContaining('boom') })]);
        });

        it('when they cannot be recorded (no audit row): they are revoked', async () => {
            expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER, mergeAuditId: 'missing' })).toBe(0);
            expect(live()).toEqual([]);
            expect(sqlite.prepare(`SELECT revoked_by_email FROM pii_access_grants`).all()).toEqual([{ revoked_by_email: STRANGER }]);
        });

        it('with no merge audit id at all: revoked too', async () => {
            expect(await grantAccessAfterFold(db, { access: ALL, survivorId: 's-stranger', absorbedOwnerEmail: OWNER, actor: STRANGER })).toBe(0);
            expect(live()).toEqual([]);
        });
    });
});
