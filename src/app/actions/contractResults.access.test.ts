/**
 * T1: «Resultados del contrato» is the team's, like form results — the
 * recipient's teammates (and admins) answer «¿Es la misma persona?» from it.
 * attachContractToExistingAdopter: recipient, teammate and admin allowed;
 * a member of another group, a user in no group and anonymous refused.
 * Real SQL; the session is the only source of the actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
/** In a group of their own, not OWNER's. */
const OTHER_GROUP = 'other-group@example.com';
const THIRD = 'third@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === ADMIN }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { attachContractToExistingAdopter } from './duplicates';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    // OWNER sent the contract link; the signed contract made OWNER's new profile, which matched THIRD's.
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES
        ('o-match', 'Carla Gómez', '5', ?, 1000, 1000), ('s-orphan', 'Carla Gomez', '5', ?, 2000, 2000)`).run(THIRD, OWNER);
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('n-contract', ?, 'contract_result', 't', 'b', ?, 1)`)
        .run(OWNER, JSON.stringify({ adopterId: 's-orphan', matchedAdopters: [{ id: 'o-match' }] }));
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
        VALUES ('dc-1', 's-orphan', 'o-match', '["name_full"]', '{}', 30, 'medium', 'pending', 1)`).run();
});

describe('attachContractToExistingAdopter — who may answer a contract result', () => {
    it('the recipient: folds in', async () => {
        session.user = OWNER;
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: true });
        expect(deleted('s-orphan')).toBe(true);
    });

    it('a teammate of the recipient: folds in, as the recipient would', async () => {
        session.user = MATE;
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: true });
        expect(deleted('s-orphan')).toBe(true);
    });

    it('an admin: folds in', async () => {
        session.user = ADMIN;
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: true });
    });

    it('a member of another group, or a user in no group: refused, nothing merged', async () => {
        for (const u of [OTHER_GROUP, STRANGER]) {
            session.user = u;
            expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toEqual({ success: false, error: 'Not authorized for this notification' });
        }
        expect(deleted('s-orphan') || deleted('o-match')).toBe(false);
    });

    it('anonymous: refused', async () => {
        session.user = null;
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: false });
        expect(deleted('s-orphan')).toBe(false);
    });

    it('a teammate\'s notification of another type is not a contract result', async () => {
        sqlite.prepare(`UPDATE notifications SET type = 'form_submission' WHERE id = 'n-contract'`).run();
        session.user = MATE;
        expect(await attachContractToExistingAdopter('n-contract', 'o-match')).toMatchObject({ success: false });
        expect(deleted('s-orphan')).toBe(false);
    });
});
