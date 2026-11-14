/**
 * Final review I3 — «Enviar contrato» from a stale panel: an applicant the team turned down («No avanzar»)
 * for this animal, with no open application left, gets no contract, and nothing is written — not even the retirement of
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
import { contractInvitations as contractInvitationsTable } from '@/db/schema';

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

    it('a candidate closed by an adoption (the animal came back later) can still be sent a contract — only «No avanzar» refuses', async () => {
        sqlite.prepare(`UPDATE applications SET state = 'closed', close_reason = 'adopted_other', closed_at = ? WHERE id = 'app-s-luna'`).run(NOW);
        expect(await createContractInvitation('luna', 'ana')).toMatchObject({ success: true });
        expect(invitesFor('ana')).toHaveLength(1);
    });

    it('sent from a candidacy that «Quitar» removed meanwhile → removed, nothing written (review I1, Jon 2026-11-13)', async () => {
        const before = snapshot(sqlite);
        const res = await createContractInvitation('luna', 'ana', 'es', 'app-quitada');
        expect(res).toMatchObject({ success: false, error: 'removed' });
        expect(snapshot(sqlite)).toEqual(before); // Carla's live link is untouched
    });

    it('«Quitar» lands while «Enviar contrato» is running (after its first check): nothing sent, Carla\'s link lives (review I-1)', async () => {
        // A teammate's withdraw lands between this call's checks and its write.
        const real = (state.db as { update: (t: unknown) => unknown }).update.bind(state.db);
        let raced = false;
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'update') return (table: unknown) => {
                    if (!raced && table === contractInvitationsTable) { raced = true; sqlite.prepare("DELETE FROM applications WHERE id = 'app-s-luna'").run(); }
                    return real(table);
                };
                return Reflect.get(t, p, r);
            },
        });
        const res = await createContractInvitation('luna', 'ana', 'es', 'app-s-luna');
        expect(res).toMatchObject({ success: false, error: 'removed' });
        expect(invitesFor('ana')).toHaveLength(0);
        expect((invitesFor('carla')[0].expires_at as number)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('sent from a candidacy that is still there → the contract goes out', async () => {
        expect(await createContractInvitation('luna', 'ana', 'es', 'app-s-luna')).toMatchObject({ success: true });
    });

    it('a profile with no application at all keeps the full-access path', async () => {
        adopter(sqlite, 'dora', 'Dora', OWNER);
        expect(await createContractInvitation('luna', 'dora')).toMatchObject({ success: true });
        expect(invitesFor('dora')).toHaveLength(1);
    });
});

describe('createContractInvitation waits for «¿Es la misma persona?» (Jon 2026-11-12; EM review)', () => {
    const openPair = (id: string, other: string, owner = 'stranger@example.com') => {
        adopter(sqlite, other, 'Ana P.', owner);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status) VALUES (?, 'ana', ?, '["phone"]', 80, 'high', 'pending')`).run(id, other);
    };

    it('an unanswered pair on the profile this form created → refused, nothing written, Carla\'s link survives', async () => {
        openPair('p-1', 'ana-elsewhere');
        const before = snapshot(sqlite);
        const res = await createContractInvitation('luna', 'ana');
        expect(res).toMatchObject({ success: false, error: 'same_person_unanswered' });
        expect(invitesFor('ana')).toHaveLength(0);
        expect(snapshot(sqlite)).toEqual(before);
    });

    it('«No sé» from the sender\'s group unlocks it', async () => {
        openPair('p-1', 'ana-elsewhere');
        sqlite.prepare(`INSERT INTO pair_unsure (pair_key, asker_email, withdrawn) VALUES ('ana|ana-elsewhere', ?, 0)`).run(OWNER);
        expect(await createContractInvitation('luna', 'ana')).toMatchObject({ success: true });
    });

    it('a pair that is no longer pending never locks', async () => {
        openPair('p-1', 'ana-elsewhere');
        sqlite.prepare(`UPDATE duplicate_candidates SET status = 'dismissed' WHERE id = 'p-1'`).run();
        expect(await createContractInvitation('luna', 'ana')).toMatchObject({ success: true });
    });
});
