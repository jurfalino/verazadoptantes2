/**
 * «Ya está en otro perfil» → the window's answers by ownership (Jon
 * 2026-10-29): what getDuplicateHintMatches offers per match (continue /
 * flag / review_admins / pending, with the confirmation's preview and who is
 * told), and the actions re-deciding it on the server: «Continuar con este
 * perfil» (continueWithMatchedProfile — MATCH survives, the foreign owner is
 * told, the typed value lands on MATCH), the dispute after a «no»
 * (askAdminsToReviewPair), and duplicate flags telling whoever added each
 * profile once (flagAdopter / flagAdopterAsDuplicate).
 *
 * Real SQL (every drizzle/*.sql replayed), the real duplicate engine and token
 * index, the real merge and merge requests; the session is the only actor.
 * OWNER (team: MATE) loaded María (CURRENT); OTHER loaded Jonatan (MATCH).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({ ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
    getTeamEmails: async (email: string) => mocks.getOrgMemberEmailsFor((email ?? '').trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({ ...(await orig()), getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING') }));
// The card enrichment chains D1-only calls the in-memory driver lacks; detection stays real (as households.test.ts).
vi.mock('./hydrateDuplicateMatches', () => ({
    hydrateDuplicateMatches: vi.fn(async (_db: unknown, matches: Array<{ adopterId: string; adopterName: string; relevancePercent: number }>) =>
        matches.map(m => ({ adopter: { id: m.adopterId, name: m.adopterName }, relevancePercent: m.relevancePercent }))),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// Side effects run (the notices are what is tested).
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/adopterMerge', async (orig) => {
    const actual = await orig<typeof import('@/lib/adopterMerge')>();
    return { ...actual, mergeAdopters: vi.fn(actual.mergeAdopters) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { getDuplicateHintMatches } from './households';
import { continueWithMatchedProfile, askAdminsToReviewPair } from './dupHintActions';
import { flagAdopterAsDuplicate } from './flagAdopterAsDuplicate';
import { flagAdopter } from './flags';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { isOpenDuplicateFlag } from '@/domain/dedupPair';
import { mergeAdopters } from '@/lib/adopterMerge';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const MATCH_PHONE = '+54 11 6585 1333';
const TYPED = '6585-1333';

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const deleted = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at !== null;
const contactsOf = (id: string) => deserializeContactEntries(sqlite.prepare('SELECT contact_entries FROM adopters WHERE id = ?').get(id)!.contact_entries as string | null);
const flagsOn = (id: string) => sqlite.prepare(`SELECT id, target_adopter_id AS t, details FROM adopter_flags WHERE adopter_id = ? AND reason = 'duplicate'`).all(id);
const hint = (currentId = 'maria') => getDuplicateHintMatches({ type: 'phone', value: TYPED, excludeAdopterId: currentId });
const windowFor = async (id: string, currentId = 'maria') => (await hint(currentId)).results.find(r => r.adopter.id === id);

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES (?, ?, '5', ?, ?, ?, ?)`);
    insert.run('maria', 'María García López', OWNER, 2000, 2000, JSON.stringify([
        { id: 'm1', type: 'phone', value: '555-1234', addedBy: OWNER },
        { id: 'm2', type: 'email', value: 'maria@example.com', addedBy: MATE },
    ]));
    insert.run('jonatan', 'Jonatan Urfalino', OTHER, 1000, 1000, JSON.stringify([{ id: 'j1', type: 'phone', value: MATCH_PHONE, addedBy: OTHER }]));
    const event = sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, recorded_by, created_at) VALUES (?, ?, 'observation', ?, ?, 1500)`);
    event.run('ev-m1', 'maria', 1, OWNER);
    event.run('ev-j1', 'jonatan', 4, OTHER);
    event.run('ev-j2', 'jonatan', 4, OTHER);
    await tokenizeAdopter('maria');
    await tokenizeAdopter('jonatan');
});

describe('getDuplicateHintMatches — what the window offers, per match', () => {
    it('case 1 (I loaded the profile being edited): continue, with what it adds, its records, the rating after, and the foreign owner named', async () => {
        const w = await windowFor('jonatan');
        expect(w).toMatchObject({ action: 'continue', alreadyPending: false, toldNames: ['other-rescuer'] });
        // The typed phone is not «added»: Jonatan already has it (+54 11 6585 1333), as the matcher compares phones.
        expect(w!.preview!.newContacts.map(c => c.value)).toEqual(['555-1234', 'maria@example.com']);
        // Never who added each contact.
        expect(JSON.stringify(w!.preview)).not.toContain('addedBy');
        expect(w!.preview).toMatchObject({ records: 1, ratingAfter: 3 });
    });

    it('a teammate of whoever loaded it: case 1 too', async () => {
        expect(await as(MATE, () => windowFor('jonatan'))).toMatchObject({ action: 'continue', toldNames: ['other-rescuer'] });
    });

    it('case 2 (someone else loaded it): flag, «Lo cargó otra persona», no preview, nobody named', async () => {
        const w = await as(STRANGER, () => windowFor('jonatan'));
        expect(w).toMatchObject({ action: 'flag', loadedByOther: true });
        expect(w!.preview).toBeUndefined();
        expect(w!.toldNames).toBeUndefined();
        // Also when the viewer loaded the match.
        expect(await as(OTHER, () => windowFor('jonatan'))).toMatchObject({ action: 'flag', loadedByOther: true });
    });

    it('case 3 (the match has no real owner): flag, even though the profile being edited is mine', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'anonymous' WHERE id = 'jonatan'`).run();
        expect(await windowFor('jonatan')).toMatchObject({ action: 'flag', loadedByOther: false });
    });

    it('case 4 (the other owner declined my team\'s request): review_admins', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'maria', 'jonatan', ?, ?, 'declined', 1)`).run(MATE, OTHER);
        expect(await windowFor('jonatan')).toMatchObject({ action: 'review_admins' });
    });

    it('case 5 (an open duplicate flag on the pair, either direction): pending — and an admin may still continue', async () => {
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('f1', 'jonatan', ?, 'duplicate', 'maria', 'x', 1)`).run(STRANGER);
        expect(await windowFor('jonatan')).toMatchObject({ action: 'pending', alreadyPending: true });
        expect(await as(ADMIN, () => windowFor('jonatan'))).toMatchObject({ action: 'continue', alreadyPending: true, toldNames: ['other-rescuer', 'owner'] });
    });

    it('without a saved profile being edited: no answer', async () => {
        const { results } = await getDuplicateHintMatches({ type: 'phone', value: TYPED });
        expect(results.find(r => r.adopter.id === 'jonatan')).toMatchObject({ action: null });
    });
});

describe('continueWithMatchedProfile — «Sí, continuar»', () => {
    it('MATCH survives with CURRENT\'s contacts and no second copy of the typed phone; the foreign owner hears it; the told names come back', async () => {
        const res = await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'phone', value: TYPED } });
        expect(res).toEqual({ ok: true, matchId: 'jonatan', currentName: 'María García López', told: ['other-rescuer'] });
        expect(deleted('maria')).toBe(true);
        expect(deleted('jonatan')).toBe(false);
        // (Her name stays as an alias, as every merge keeps it.)
        expect(contactsOf('jonatan').filter(c => c.type !== 'alias').map(c => c.value).sort()).toEqual([MATCH_PHONE, '555-1234', 'maria@example.com'].sort());
        // The records moved too: the rating is now over all three.
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopter_events WHERE adopter_id = 'jonatan'`).get()!.n).toBe(3);
        const merged = notify.create.filter(n => n.type === 'adopter_merged');
        expect(merged).toEqual([expect.objectContaining({ userId: OTHER, url: expect.stringMatching(/^\/adopter\/jonatan\?dispute=/) })]);
    });

    it('exactly «+54 9 11 6312-0851» on the match and «11 6312-0851» typed: neither in «Se agregará» nor saved twice (fix round 1)', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'jonatan'`).run(JSON.stringify([{ id: 'j1', type: 'phone', value: '+54 9 11 6312-0851', addedBy: OTHER }]));
        await tokenizeAdopter('jonatan');
        const { results } = await getDuplicateHintMatches({ type: 'phone', value: '11 6312-0851', excludeAdopterId: 'maria' });
        const w = results.find(r => r.adopter.id === 'jonatan');
        expect(w?.matchedEntryIndexes).toEqual([0]);
        expect(w!.preview!.newContacts.map(c => c.value)).not.toContain('11 6312-0851');
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'phone', value: '11 6312-0851' } })).toMatchObject({ ok: true });
        expect(contactsOf('jonatan').filter(c => c.type === 'phone').map(c => c.value).sort()).toEqual(['+54 9 11 6312-0851', '555-1234'].sort());
    });

    it('a typed value the match does not have yet is added through the composer\'s save', async () => {
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'email', value: 'nuevo@example.com' } })).toMatchObject({ ok: true });
        expect(contactsOf('jonatan').map(c => c.value)).toContain('nuevo@example.com');
    });

    it('a social handle with no network picked: refused before anything is saved (the composer asks for it)', async () => {
        const res = await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'social', value: 'maria.garcia' } });
        expect(res).toEqual({ ok: false, error: 'platform_required', errorId: 'gen12345' });
        expect(deleted('maria')).toBe(false);
        expect(contactsOf('maria').map(c => c.value)).not.toContain('maria.garcia');
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'social', value: 'maria.garcia', platform: 'instagram' } })).toMatchObject({ ok: true });
        expect(contactsOf('jonatan').find(c => c.type === 'social')).toMatchObject({ value: 'maria.garcia', platform: 'instagram' });
    });

    it('the merge fails after the typed value was saved: says so (typedSaved), so the composer clears it', async () => {
        vi.mocked(mergeAdopters).mockResolvedValueOnce({ success: false, error: 'boom' });
        const res = await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'email', value: 'nuevo@example.com' } });
        expect(res).toEqual({ ok: false, error: 'merge_failed', errorId: 'err12345', typedSaved: true });
        expect(contactsOf('maria').map(c => c.value)).toContain('nuevo@example.com');
        expect(deleted('maria')).toBe(false);
    });

    it('both profiles the team\'s: merged, nobody told', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = ? WHERE id = 'jonatan'`).run(MATE);
        const res = await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' });
        expect(res).toMatchObject({ ok: true, told: [] });
        expect(notify.create.filter(n => n.type === 'adopter_merged')).toEqual([]);
    });

    it('an admin on a pair already up for review: merged, the flag closed, both owners told', async () => {
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('f1', 'maria', ?, 'duplicate', 'jonatan', 'x', 1)`).run(STRANGER);
        const res = await as(ADMIN, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' }));
        expect(res).toMatchObject({ ok: true, told: ['other-rescuer', 'owner'] });
        expect(deleted('maria')).toBe(true);
        // The flag (moved onto the survivor, now pointing at itself) is settled: no longer an open question.
        const flag = sqlite.prepare(`SELECT adopter_id AS a, target_adopter_id AS t, reason, details FROM adopter_flags WHERE id = 'f1'`).get()!;
        expect(isOpenDuplicateFlag({ adopterId: flag.a as string, targetAdopterId: flag.t as string, reason: flag.reason as string, details: flag.details as string })).toBe(false);
        expect(notify.create.filter(n => n.type === 'adopter_merged').map(n => n.userId).sort()).toEqual([OTHER, OWNER].sort());
    });

    it.each([
        ['case 2: someone else loaded it', async () => as(STRANGER, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' })), 'not_allowed:flag'],
        ['case 3: the match has no owner', async () => {
            sqlite.prepare(`UPDATE adopters SET added_by = 'anonymous' WHERE id = 'jonatan'`).run();
            return continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' });
        }, 'not_allowed:flag'],
        ['case 4: they said no', async () => {
            sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'jonatan', 'maria', ?, ?, 'declined', 1)`).run(OWNER, OTHER);
            return continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' });
        }, 'not_allowed:review_admins'],
        ['case 5: already up for review', async () => {
            sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'jonatan', 'maria', ?, NULL, 'pending', 1)`).run(STRANGER);
            return continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'phone', value: TYPED } });
        }, 'not_allowed:pending'],
    ] as const)('refused on the server — %s', async (_label, run, error) => {
        const res = await run();
        expect(res).toEqual({ ok: false, error, errorId: 'gen12345' });
        expect(deleted('maria')).toBe(false);
        // Nothing typed was saved anywhere either.
        expect(contactsOf('maria').map(c => c.value)).not.toContain(TYPED);
        expect(notify.create).toEqual([]);
    });

    it('no session, the same id twice, or a profile that is gone: refused', async () => {
        expect(await as(null, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' }))).toMatchObject({ ok: false, error: 'unauthenticated' });
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'maria' })).toMatchObject({ ok: false, error: 'invalid' });
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'nobody' })).toMatchObject({ ok: false, error: 'not_found' });
    });
});

describe('askAdminsToReviewPair — after a «no», ask the admins', () => {
    it('files the dispute as «Pendientes» does: to the admins, MATCH kept; a second time is «already»', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'maria', 'jonatan', ?, ?, 'declined', 1)`).run(OWNER, OTHER);
        expect(await askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' })).toEqual({ ok: true, already: false });
        const filed = sqlite.prepare(`SELECT primary_id AS p, secondary_id AS s, owner_email AS o, dispute, status FROM merge_requests WHERE id != 'mr1'`).all();
        expect(filed).toEqual([{ p: 'jonatan', s: 'maria', o: null, dispute: 1, status: 'pending' }]);
        expect(notify.admins).toEqual([expect.objectContaining({ type: 'merge_request' })]);
        expect(await askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' })).toEqual({ ok: true, already: true });
        expect(notify.admins).toHaveLength(1);
    });

    it('refused when nobody said no (the window offers «Continuar» there)', async () => {
        expect(await askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' })).toMatchObject({ ok: false, error: 'not_allowed:continue' });
    });
});

describe('duplicate flags tell the owners (flagAdopter / flagAdopterAsDuplicate)', () => {
    const flagged = () => notify.create.filter(n => n.type === 'duplicate_flagged');

    it('whoever added each profile — not their org members — once each, never the flagger; «Revisar» opens Pendientes at the pair; the admins are told too', async () => {
        const res = await as(STRANGER, () => flagAdopterAsDuplicate({ currentAdopterId: 'maria', matchedAdopterId: 'jonatan', matchedAdopterName: 'Jonatan Urfalino' }));
        expect(res).toMatchObject({ ok: true });
        expect(flagged().map(n => n.userId).sort()).toEqual([OTHER, OWNER].sort());
        expect(flagged()[0]).toMatchObject({
            url: `/my-adopters?pair=${encodeURIComponent('jonatan|maria')}#pendientes`,
            title: 'Posible duplicado en tu perfil',
            body: 'stranger cree que María García López y Jonatan Urfalino son la misma persona.',
        });
        expect(notify.admins).toEqual([expect.objectContaining({ type: 'adopter_flagged' })]);
    });

    it('a flagger who is an owner is not told; an owner who is an admin gets only the owner notice', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = ? WHERE id = 'jonatan'`).run(ADMIN);
        await as(OWNER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'));
        expect(flagged().map(n => n.userId)).toEqual([ADMIN]);
        expect(notify.admins).toHaveLength(1);
        expect(notify.admins[0].skip).toEqual(expect.arrayContaining([ADMIN]));
    });

    it('the profile menu «Reportar → Duplicado» (flagAdopter with a target) tells them the same way; other reasons tell only the admins', async () => {
        await as(STRANGER, () => flagAdopter('jonatan', 'duplicate', 'x', 'maria'));
        expect(flagged().map(n => n.userId).sort()).toEqual([OTHER, OWNER].sort());
        notify.create.length = 0;
        await as(STRANGER, () => flagAdopter('jonatan', 'inaccurate', 'x'));
        expect(flagged()).toEqual([]);
    });

    it('flagging the same pair twice (either direction): no second row, no second notice', async () => {
        const first = await as(STRANGER, () => flagAdopterAsDuplicate({ currentAdopterId: 'maria', matchedAdopterId: 'jonatan', matchedAdopterName: 'J' }));
        const before = { owners: flagged().length, admins: notify.admins.length };
        const again = await as(MATE, () => flagAdopterAsDuplicate({ currentAdopterId: 'jonatan', matchedAdopterId: 'maria', matchedAdopterName: 'M' }));
        expect(again).toEqual({ ok: true, flagId: first.ok ? first.flagId : '', already: true });
        expect(flagsOn('maria')).toHaveLength(1);
        expect(flagsOn('jonatan')).toHaveLength(0);
        expect({ owners: flagged().length, admins: notify.admins.length }).toEqual(before);
    });
});
