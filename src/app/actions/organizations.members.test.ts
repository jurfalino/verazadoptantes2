/**
 * G1 (Jon, 2026-11-08): any member of a group can remove another member, and
 * «Generar un enlace nuevo» makes the old invite link stop working (links
 * never expire on their own). Invite links use the real domain, never the old
 * buenadoptante.com fallback. Real SQL; the session is the only actor.
 *
 * org-1 = { OWNER (created it), MATE }    org-2 = { OTHER }    STRANGER: no group
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER } = mocks;
const OTHER = 'other-group@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
// The notices' kill switch and email twin are not under test here (createNotification has its own tests).
vi.mock('@/config/features', () => ({ getFeatureFlag: vi.fn(async () => true) }));
vi.mock('@/lib/notificationEmail', () => ({ sendNotificationEmail: vi.fn(async () => 'skipped_local') }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { removeOrganizationMember, regenerateInviteLink, getInviteLink, joinOrganization, getInvitePreview } from './organizations';
import { logAudit } from '@/lib/audit';
import { runAfterResponse } from '@/lib/background';
import { logger } from '@/lib/logger';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const members = (orgId: string) => sqlite.prepare('SELECT user_email FROM org_members WHERE org_id = ? ORDER BY user_email').all(orgId).map(r => r.user_email);
const invites = (orgId: string) => sqlite.prepare('SELECT id FROM org_invites WHERE org_id = ?').all(orgId).map(r => r.id as string);
const token = (url: string) => url.split('/invite/')[1];
const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

const ENV_KEYS = ['AUTH_URL', 'NEXTAUTH_URL', 'APP_ENVIRONMENT'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    vi.mocked(logAudit).mockClear();
    sqlite.prepare(`INSERT INTO organizations (id, name, created_by) VALUES ('org-1', 'Michis', ?), ('org-2', 'Perris', ?)`).run(OWNER, OTHER);
    sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES
        ('m-owner', 'org-1', ?, 'owner'), ('m-mate', 'org-1', ?, 'member'), ('m-other', 'org-2', ?, 'owner')`).run(OWNER, MATE, OTHER);
    sqlite.prepare(`INSERT INTO org_invites (id, org_id, created_by) VALUES ('old-link', 'org-1', ?)`).run(OWNER);
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

describe('removeOrganizationMember — «Quitar del grupo»', () => {
    it('any member removes another — even whoever created the group; the removal is audited', async () => {
        expect(await as(MATE, () => removeOrganizationMember('org-1', 'm-owner'))).toEqual({ success: true });
        expect(members('org-1')).toEqual([MATE]);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            userEmail: MATE, action: 'org_member_removed', target: 'org-1',
            details: expect.objectContaining({ orgId: 'org-1', memberId: 'm-owner', removedEmail: OWNER }),
        }));
    });

    it('the removed person cannot rejoin with the link they had: removal replaces it', async () => {
        expect(await as(OWNER, () => removeOrganizationMember('org-1', 'm-mate'))).toEqual({ success: true });
        expect(await as(MATE, () => joinOrganization('old-link'))).toMatchObject({ success: false });
        expect(members('org-1')).toEqual([OWNER]);
        const [fresh] = invites('org-1');
        expect(fresh).toBeTruthy();
        expect(fresh).not.toBe('old-link');
    });

    it('a member of another group is refused; nobody is removed', async () => {
        expect(await as(OTHER, () => removeOrganizationMember('org-1', 'm-mate'))).toEqual({ success: false, error: 'not_member' });
        expect(members('org-1')).toEqual([MATE, OWNER].sort());
    });

    it('a member cannot reach into another group through their own group\'s id', async () => {
        expect(await as(OTHER, () => removeOrganizationMember('org-2', 'm-mate'))).toEqual({ success: false, error: 'member_not_found' });
        expect(members('org-1')).toEqual([MATE, OWNER].sort());
    });

    it('a signed-in user in no group is refused', async () => {
        expect(await as(STRANGER, () => removeOrganizationMember('org-1', 'm-mate'))).toEqual({ success: false, error: 'not_member' });
        expect(members('org-1')).toHaveLength(2);
    });

    it('anonymous is refused', async () => {
        expect(await as(null, () => removeOrganizationMember('org-1', 'm-mate'))).toEqual({ success: false, error: 'not_authenticated' });
        expect(members('org-1')).toHaveLength(2);
    });

    it('removing yourself is «Salir», not this', async () => {
        expect(await as(MATE, () => removeOrganizationMember('org-1', 'm-mate'))).toEqual({ success: false, error: 'cannot_remove_self' });
        expect(members('org-1')).toHaveLength(2);
    });

    it('someone already gone: says so, removes nothing else', async () => {
        expect(await as(MATE, () => removeOrganizationMember('org-1', 'm-nobody'))).toEqual({ success: false, error: 'member_not_found' });
        expect(members('org-1')).toHaveLength(2);
    });
});

describe('removeOrganizationMember — the removed person is told (F6)', () => {
    const notices = () => sqlite.prepare('SELECT user_id, type, title, body, url FROM notifications ORDER BY user_id').all();

    beforeEach(() => {
        // Run the after-response work, as it runs outside Cloudflare.
        vi.mocked(runAfterResponse).mockImplementation(async (_name, task) => { await task(); });
        vi.mocked(logger.warn).mockClear();
    });
    afterEach(() => { vi.mocked(runAfterResponse).mockImplementation(async () => undefined); });

    it('exactly one notice, to the removed person: the group, who removed them, a link to Grupos', async () => {
        sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-mate', ?, 'Marta Giménez')`).run(MATE);
        expect(await as(MATE, () => removeOrganizationMember('org-1', 'm-owner'))).toEqual({ success: true });
        expect(notices()).toEqual([{
            user_id: OWNER, type: 'member_removed', url: '/organizations',
            title: 'Ya no estás en «Michis»', body: 'Marta Giménez te quitó del grupo. Lo que cargaste sigue a tu nombre.',
        }]);
    });

    it('a remover with no name is their email handle, never the address', async () => {
        await as(OWNER, () => removeOrganizationMember('org-1', 'm-mate'));
        const [n] = notices();
        expect(n).toMatchObject({ user_id: MATE, body: 'owner te quitó del grupo. Lo que cargaste sigue a tu nombre.' });
    });

    it('a refused removal tells nobody', async () => {
        await as(OTHER, () => removeOrganizationMember('org-1', 'm-mate'));
        expect(notices()).toEqual([]);
    });

    it('the notice failing does not undo the removal: still success, logged at warn with context', async () => {
        sqlite.prepare('DROP TABLE notifications').run();
        expect(await as(MATE, () => removeOrganizationMember('org-1', 'm-owner'))).toEqual({ success: true });
        expect(members('org-1')).toEqual([MATE]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('removeOrganizationMember'),
            expect.objectContaining({ user: MATE, orgId: 'org-1', memberId: 'm-owner' }));
    });
});

/**
 * Notifications cleanup, Phase 1 (change 4): «Nuevo miembro» goes only to the group
 * joined. It used to reach every group the joiner belongs to (notifyOrgMembers fans out
 * by the actor's groups), so the joiner's other group read «X se unió a Michis».
 */
describe('joinOrganization — only the group joined is told', () => {
    const PERRIS_MATE = 'perris-mate@example.com';
    const told = () => sqlite.prepare("SELECT user_id, body, url FROM notifications WHERE type = 'member_joined' ORDER BY user_id").all();

    beforeEach(() => {
        vi.mocked(runAfterResponse).mockImplementation(async (_name, task) => { await task(); });
        vi.mocked(logger.warn).mockClear();
        // OTHER's own group, Perris, has a second member.
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m-perris-mate', 'org-2', ?, 'member')`).run(PERRIS_MATE);
        sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-other', ?, 'Olga Ortiz')`).run(OTHER);
    });
    afterEach(() => { vi.mocked(runAfterResponse).mockImplementation(async () => undefined); });

    it("OTHER joins Michis: Michis's members are told, never the joiner nor the joiner's other group", async () => {
        expect(await as(OTHER, () => joinOrganization('old-link'))).toEqual({ success: true, orgName: 'Michis' });
        expect(told()).toEqual([MATE, OWNER].sort().map(user_id => ({ user_id, body: 'Olga Ortiz se unió a Michis.', url: '/organizations' })));
    });

    it('a stranger in no group joins: the same, only the group joined', async () => {
        expect(await as(STRANGER, () => joinOrganization('old-link'))).toMatchObject({ success: true });
        expect(told().map(r => r.user_id)).toEqual([MATE, OWNER].sort());
    });

    it('joining again (already a member) tells nobody', async () => {
        expect(await as(MATE, () => joinOrganization('old-link'))).toMatchObject({ success: true });
        expect(told()).toEqual([]);
    });
});

describe('regenerateInviteLink — «Generar un enlace nuevo»', () => {
    it('a member gets a new link; the old one stops working (join and preview), the new one works', async () => {
        const res = await as(MATE, () => regenerateInviteLink('org-1'));
        expect(res.success).toBe(true);
        const fresh = token(res.url!);
        expect(fresh).toBeTruthy();
        expect(fresh).not.toBe('old-link');
        expect(invites('org-1')).toEqual([fresh]);

        expect(await as(STRANGER, () => joinOrganization('old-link'))).toMatchObject({ success: false });
        expect(await getInvitePreview('old-link')).toBeNull();
        expect(members('org-1')).not.toContain(STRANGER);

        expect(await as(STRANGER, () => joinOrganization(fresh))).toMatchObject({ success: true });
        expect(members('org-1')).toContain(STRANGER);
    });

    it('«Invitar» then hands out the new link, not a dead one', async () => {
        const res = await as(OWNER, () => regenerateInviteLink('org-1'));
        expect((await as(MATE, () => getInviteLink('org-1'))).url).toBe(res.url);
    });

    it('a member of another group is refused; the link keeps working', async () => {
        expect(await as(OTHER, () => regenerateInviteLink('org-1'))).toEqual({ success: false, error: 'not_member' });
        expect(invites('org-1')).toEqual(['old-link']);
    });

    it('a signed-in user in no group is refused', async () => {
        expect(await as(STRANGER, () => regenerateInviteLink('org-1'))).toEqual({ success: false, error: 'not_member' });
        expect(invites('org-1')).toEqual(['old-link']);
    });

    it('anonymous is refused', async () => {
        expect(await as(null, () => regenerateInviteLink('org-1'))).toEqual({ success: false, error: 'not_authenticated' });
        expect(invites('org-1')).toEqual(['old-link']);
    });

    it('a link never expires on its own: no expiry is set', async () => {
        await as(MATE, () => regenerateInviteLink('org-1'));
        expect(sqlite.prepare('SELECT expires_at FROM org_invites WHERE org_id = ?').get('org-1')!.expires_at).toBeNull();
    });
});

describe('invite link domain', () => {
    it('production without AUTH_URL: the real domain, buenadoptante.org — never .com', async () => {
        process.env.APP_ENVIRONMENT = 'production';
        const fresh = await as(MATE, () => regenerateInviteLink('org-1'));
        expect(fresh.url).toMatch(/^https:\/\/buenadoptante\.org\/invite\//);
        expect((await as(MATE, () => getInviteLink('org-1'))).url).toMatch(/^https:\/\/buenadoptante\.org\/invite\//);
    });

    it('staging without AUTH_URL: the staging domain', async () => {
        process.env.APP_ENVIRONMENT = 'staging';
        expect((await as(MATE, () => getInviteLink('org-1'))).url).toBe('https://staging.buenadoptante.org/invite/old-link');
    });

    it('AUTH_URL still wins when set', async () => {
        process.env.AUTH_URL = 'https://example.test';
        expect((await as(MATE, () => getInviteLink('org-1'))).url).toBe('https://example.test/invite/old-link');
    });
});
