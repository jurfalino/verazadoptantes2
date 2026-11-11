/**
 * Final review I3 — «Enviar contrato» from a stale panel: an applicant whose applications for this animal
 * are all decided (declined, closed…) gets no contract, and nothing is written — not even the retirement of
 * another applicant's live link. A profile with no application keeps today's full-access path.
 * Real SQL on the real schema (migratedDb).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';
import { adopter, form, application, invitation, seedEvaluation, snapshot, NOW, DAY, type Sqlite } from '@/test-utils/applicationFixtures';

const { session, OWNER } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()),
    isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor((e ?? '').trim().toLowerCase()),
}));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/contractUrl', () => ({ getContractBaseUrl: async () => 'https://contract.example' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'errid') },
    generateErrorId: () => 'errid',
}));

import { createContractInvitation } from './contract';

let sqlite: Sqlite;
const invitesFor = (adopterId: string) => sqlite.prepare('SELECT * FROM contract_invitations WHERE adopter_id = ?').all(adopterId);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    session.user = OWNER;
    seedEvaluation(sqlite);
    // Another applicant of Luna holds a live link.
    adopter(sqlite, 'carla', 'Carla', OWNER);
    form(sqlite, 's-carla', { adopter: 'carla', animal: 'luna' });
    application(sqlite, 'app-s-carla', 's-carla', 'luna');
    invitation(sqlite, 't-carla', 'luna', 'carla', NOW + 20 * DAY);
});

describe('createContractInvitation on an applicant already decided', () => {
    it('a declined applicant → already_decided, no invitation row, nothing retired', async () => {
        sqlite.prepare(`UPDATE applications SET state = 'declined', closed_at = ?, closed_by = ? WHERE id = 'app-s-luna'`).run(NOW, OWNER);
        const before = snapshot(sqlite);
        const res = await createContractInvitation('luna', 'ana');
        expect(res).toMatchObject({ success: false, error: 'already_decided' });
        expect(invitesFor('ana')).toHaveLength(0);
        expect(snapshot(sqlite)).toEqual(before); // Carla's live link is untouched
    });

    it('a still-open applicant gets the contract (and the previous link of the animal is retired, as before)', async () => {
        const res = await createContractInvitation('luna', 'ana');
        expect(res).toMatchObject({ success: true });
        expect(invitesFor('ana')).toHaveLength(1);
        expect((invitesFor('carla')[0].expires_at as number)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });

    it('one decided and one open application of the same person for this animal → still sendable', async () => {
        sqlite.prepare(`UPDATE applications SET state = 'declined' WHERE id = 'app-s-luna'`).run();
        form(sqlite, 's-luna-2', { adopter: 'ana', animal: 'luna' });
        application(sqlite, 'app-s-luna-2', 's-luna-2', 'luna');
        expect(await createContractInvitation('luna', 'ana')).toMatchObject({ success: true });
    });

    it('a profile with no application at all keeps the full-access path', async () => {
        adopter(sqlite, 'dora', 'Dora', OWNER);
        expect(await createContractInvitation('luna', 'dora')).toMatchObject({ success: true });
        expect(invitesFor('dora')).toHaveLength(1);
    });
});
