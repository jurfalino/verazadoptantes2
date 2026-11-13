/**
 * Final review I2 — the admin «Papelera» soft delete (a resolved deletion request) unlinks the person's
 * forms, as the rescuer's own delete does (adopters.ts deleteOwnAdopter): an application on a deleted
 * profile must not stay a to-do nobody can act on. Real SQL (every drizzle/*.sql).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdmin: (e: string) => e === mocks.ADMIN, checkIsAdminAsync: async (e: string) => e === mocks.ADMIN }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: mocks.ADMIN } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { resolveDataRequest } from './admin';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('pedro', 'Pedro Paez', '5', ?, 1000, 1000), ('otra', 'Otra', '5', ?, 1000, 1000)`).run(OWNER, OWNER);
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, created_at) VALUES ('f-pedro', ?, 'Pedro Paez', 'pedro', 1000), ('f-otra', ?, 'Otra', 'otra', 1000)`).run(OWNER, OWNER);
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES ('app-f-pedro', 'f-pedro', NULL, 'form', 'open')`).run();
    sqlite.prepare(`INSERT INTO data_requests (id, adopter_id, requester_name, request_type, status) VALUES ('dr1', 'pedro', 'Pedro Paez', 'deletion', 'pending')`).run();
});

describe('resolveDataRequest (deletion) → softDeleteAdopter', () => {
    it("soft-deletes the profile and unlinks its forms (like the rescuer's own delete); other forms keep their link", async () => {
        expect(await resolveDataRequest('dr1', 'resolved')).toMatchObject({ success: true, deletedAdopter: true });
        expect(sqlite.prepare(`SELECT deleted_at FROM adopters WHERE id = 'pedro'`).get()!.deleted_at).not.toBeNull();
        expect(sqlite.prepare(`SELECT linked_adopter_id FROM form_submissions WHERE id = 'f-pedro'`).get()!.linked_adopter_id).toBeNull();
        expect(sqlite.prepare(`SELECT linked_adopter_id FROM form_submissions WHERE id = 'f-otra'`).get()!.linked_adopter_id).toBe('otra');
    });
});
