/**
 * Final review M6 (Q3) — «Es la misma persona» on an UNLINKED form (the 'link' op of
 * linkFormToExistingAdopter, no merge) dedupes the person's applications the way a merge does: the same
 * person ends with ONE open application per animal (the newest). Real SQL; the session is the only actor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, ADMIN } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isAdminAsyncStrict: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string) => e === ADMIN }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOrgMateStrict: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
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

import { linkFormToExistingAdopter } from './formSubmission';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('ana', 'Ana Pérez', '5', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'cat', ?, 1000, 1000)`).run(OWNER);
    // Her first form, on her profile; a second one for Luna whose profile auto-create failed (unlinked).
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, auto_adopter_id, created_at) VALUES
        ('s-1', ?, 'Ana Pérez', 'luna', 'ana', NULL, 1000), ('s-2', ?, 'Ana Pérez', 'luna', NULL, NULL, 5000)`).run(OWNER, OWNER);
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state, created_at) VALUES
        ('app-s-1', 's-1', 'luna', 'form', 'open', 1000), ('app-s-2', 's-2', 'luna', 'form', 'open', 5000)`).run();
    // The match recorded at submit (an unlinked form keeps those ids).
    sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, url, read, metadata, created_at) VALUES ('n-1', ?, 'form_submission', 't', 'b', '/x', 0, ?, 5000)`)
        .run(OWNER, JSON.stringify({ submissionId: 's-2', matchedAdopters: [{ id: 'ana' }] }));
});

describe("linkFormToExistingAdopter 'link' → one open application per animal", () => {
    it('two forms of one person for one animal, link the second → one open application (the newest), the older one replaced', async () => {
        expect(await linkFormToExistingAdopter('s-2', 'ana')).toMatchObject({ success: true });
        expect(sqlite.prepare(`SELECT linked_adopter_id FROM form_submissions WHERE id = 's-2'`).get()!.linked_adopter_id).toBe('ana');
        const rows = sqlite.prepare(`SELECT id, state, replaced_by_application_id FROM applications ORDER BY id`).all();
        expect(rows).toEqual([
            { id: 'app-s-1', state: 'replaced', replaced_by_application_id: 'app-s-2' },
            { id: 'app-s-2', state: 'open', replaced_by_application_id: null },
        ]);
    });
});
