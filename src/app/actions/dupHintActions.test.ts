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
import { addContactEntry } from './addContactEntry';
import { appendToExistingAdopter } from './adopters';
import { hashEntryValue } from '@/lib/piiAccess';
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
        expect(w).toMatchObject({ action: 'flag', cantJoin: 'other_owner' });
        expect(w!.saidNo).toBeUndefined();
        expect(w!.preview).toBeUndefined();
        expect(w!.toldNames).toBeUndefined();
        // Also when the viewer loaded the match.
        expect(await as(OTHER, () => windowFor('jonatan'))).toMatchObject({ action: 'flag', cantJoin: 'other_owner' });
    });

    it('case 3 (the match has no real owner): flag, even though the profile being edited is mine', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'anonymous' WHERE id = 'jonatan'`).run();
        const w = await windowFor('jonatan');
        expect(w).toMatchObject({ action: 'flag' });
        expect(w!.cantJoin).toBeUndefined();
    });

    it('nobody is responsible for the profile being edited (an import): flag, «Este perfil no tiene un responsable…» (N7)', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'anonymous' WHERE id = 'maria'`).run();
        expect(await windowFor('jonatan')).toMatchObject({ action: 'flag', cantJoin: 'no_owner' });
    });

    it('a said-no pair, seen by someone who loaded neither profile: flag with «Ya dijeron que no…», never review_admins (F1)', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'maria', 'jonatan', ?, NULL, 'admin_declined', 1)`).run(OWNER);
        expect(await as(STRANGER, () => windowFor('jonatan'))).toMatchObject({ action: 'flag', saidNo: true, cantJoin: 'other_owner' });
        // The owner of the match may still ask.
        expect(await as(OTHER, () => windowFor('jonatan'))).toMatchObject({ action: 'review_admins' });
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

    it('the typed value saved on the way is not announced as «agregó un dato» (F2) — the composer\'s own save still is', async () => {
        await as(MATE, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'email', value: 'nuevo@example.com' } }));
        expect(contactsOf('jonatan').map(c => c.value)).toContain('nuevo@example.com');
        expect(notify.create.filter(n => n.type === 'contact_entry_added')).toEqual([]);
        // The normal composer save (the browser door) keeps notifying the owner.
        await as(MATE, () => addContactEntry({ adopterId: 'jonatan', type: 'email', value: 'otro@example.com' }));
        expect(notify.create.filter(n => n.type === 'contact_entry_added').map(n => n.userId)).toEqual([OTHER]);
    });

    it('an admin folding their own profile into another rescuer\'s: an admin\'s merge is a consented fold (D40) — all_contact, as in «Pendientes»', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = ? WHERE id = 'maria'`).run(ADMIN);
        expect(await as(ADMIN, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' }))).toMatchObject({ ok: true, told: ['other-rescuer'] });
        expect(sqlite.prepare(`SELECT grantee_email AS email, scope FROM pii_access_grants WHERE adopter_id = 'jonatan' AND origin = 'merge' AND revoked_at IS NULL`).all())
            .toEqual([{ email: ADMIN, scope: 'all_contact' }]);
    });

    it('an admin merging two other rescuers\' profiles: the absorbed owner gets all_contact', async () => {
        sqlite.prepare(`UPDATE adopters SET added_by = 'gatitos@example.com' WHERE id = 'maria'`).run();
        expect(await as(ADMIN, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' }))).toMatchObject({ ok: true });
        expect(sqlite.prepare(`SELECT grantee_email AS email, scope FROM pii_access_grants WHERE adopter_id = 'jonatan' AND origin = 'merge' AND revoked_at IS NULL`).all())
            .toEqual([{ email: 'gatitos@example.com', scope: 'all_contact' }]);
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

    it('refused for someone who loaded neither profile (F1): not_yours, no request, no admin told', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'maria', 'jonatan', ?, NULL, 'admin_declined', 1)`).run(OWNER);
        expect(await as(STRANGER, () => askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' }))).toEqual({ ok: false, error: 'not_yours', errorId: 'gen12345' });
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM merge_requests`).get()!.n).toBe(1);
        expect(notify.admins).toEqual([]);
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

    it('«Reportar → Duplicado» twice on the same pair: the open flag comes back, no second row, no second notice (N1)', async () => {
        const first = await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'));
        const told = flagged().length;
        const again = await as(MATE, () => flagAdopter('jonatan', 'duplicate', 'y', 'maria'));
        expect(again).toEqual({ success: true, id: first.success ? first.id : '', already: true });
        expect(flagsOn('maria')).toHaveLength(1);
        expect(flagsOn('jonatan')).toHaveLength(0);
        expect(flagged()).toHaveLength(told);
        expect(notify.admins).toHaveLength(1);
    });

    it('«Reportar → Duplicado» on a pair with a pending merge request: no flag, no notices (round 5)', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'jonatan', 'maria', ?, ?, 'pending', 1)`).run(OWNER, OTHER);
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toEqual({ success: true, id: '', already: true });
        expect(flagsOn('maria')).toEqual([]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('a duplicate flag on itself, or on a profile that does not exist or was merged away: refused, nothing written or sent', async () => {
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'maria'))).toEqual({ success: false, error: 'invalid_target', errorId: 'gen12345' });
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'nobody'))).toMatchObject({ success: false, error: 'invalid_target' });
        sqlite.prepare(`UPDATE adopters SET deleted_at = 1 WHERE id = 'jonatan'`).run();
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toMatchObject({ success: false, error: 'invalid_target' });
        expect(flagsOn('maria')).toEqual([]);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('a pair someone already said are two people: refused with the window\'s reason (N2), via the menu and the window; admins may still flag', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'maria', 'jonatan', ?, NULL, 'admin_declined', 1)`).run(OWNER);
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toMatchObject({ success: false, error: 'said_no' });
        expect(await as(STRANGER, () => flagAdopterAsDuplicate({ currentAdopterId: 'maria', matchedAdopterId: 'jonatan', matchedAdopterName: 'J' }))).toEqual({ ok: false, error: 'said_no:gen12345' });
        expect(flagsOn('maria')).toEqual([]);
        expect(notify.create).toEqual([]);
        expect(await as(ADMIN, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toMatchObject({ success: true });
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

describe('already recorded as two people (F3 option a): «Ya figuran como personas distintas.»', () => {
    const shareHome = (giftRecipient = 0) => {
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES ('hh1', ?, 1)`).run(OWNER);
        sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, gift_recipient, added_by, added_at) VALUES ('m-a', 'hh1', 'maria', 'unknown', 0, ?, 1), ('m-b', 'hh1', 'jonatan', 'unknown', ?, ?, 1)`).run(OWNER, giftRecipient, OWNER);
    };
    const sources: Array<[string, () => void]> = [
        ['they share a home', () => shareHome()],
        ['«Mantener separados» by a rescuer in Pendientes (a candidate they dismissed)', () => sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at, resolved_by) VALUES ('c1', 'maria', 'jonatan', '["phone"]', 60, 'medium', 'dismissed', 1, ?)`).run(OTHER)],
        ['«Viven juntos» (the kept-separate household marker on a flag)', () => sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('f1', 'jonatan', ?, 'duplicate', 'maria', 'Kept separate: household', 1)`).run(STRANGER)],
    ];

    it.each(sources)('%s: the window says so — for the owner and an admin alike — and every action refuses it', async (_label, seed) => {
        seed();
        expect(await windowFor('jonatan')).toMatchObject({ action: 'settled' });
        expect(await as(ADMIN, () => windowFor('jonatan'))).toMatchObject({ action: 'settled' });
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan', typed: { type: 'email', value: 'nuevo@example.com' } })).toEqual({ ok: false, error: 'settled_separate', errorId: 'gen12345' });
        expect(await as(ADMIN, () => continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' }))).toMatchObject({ ok: false, error: 'settled_separate' });
        expect(await askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' })).toMatchObject({ ok: false, error: 'settled_separate' });
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toMatchObject({ success: false, error: 'settled_separate' });
        expect(await as(ADMIN, () => flagAdopter('jonatan', 'duplicate', 'x', 'maria'))).toMatchObject({ success: false, error: 'settled_separate' });
        expect(await as(STRANGER, () => flagAdopterAsDuplicate({ currentAdopterId: 'maria', matchedAdopterId: 'jonatan', matchedAdopterName: 'J' }))).toEqual({ ok: false, error: 'settled_separate:gen12345' });
        expect(deleted('maria')).toBe(false);
        expect(contactsOf('maria').map(c => c.value)).not.toContain('nuevo@example.com');
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopter_flags WHERE details IS NULL OR details NOT LIKE 'Kept separate:%'`).get()!.n).toBe(0);
        expect(notify.create).toEqual([]);
        expect(notify.admins).toEqual([]);
    });

    it('housemates who share an email are NOT settled (as «Pendientes» never hides them); a gift household never settles', async () => {
        shareHome();
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'jonatan'`).run(JSON.stringify([{ id: 'j1', type: 'phone', value: MATCH_PHONE }, { id: 'j2', type: 'email', value: 'MARIA@example.com' }]));
        expect(await windowFor('jonatan')).toMatchObject({ action: 'continue' });
    });

    it('an ADMIN ruling (a declined request, its markers and the candidate it dismissed) is not settled: still askable — case 4 (round 5)', async () => {
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'jonatan', 'maria', ?, NULL, 'admin_declined', 1)`).run(OWNER);
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at, resolved_by) VALUES ('c1', 'maria', 'jonatan', '["phone"]', 60, 'medium', 'dismissed', 1, ?)`).run(ADMIN);
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES ('f1', 'jonatan', ?, 'duplicate', 'maria', 'Kept separate: mr1', 1)`).run(STRANGER);
        expect(await windowFor('jonatan')).toMatchObject({ action: 'review_admins' });
        // A flag on it is refused for having been said no to — not as settled.
        expect(await as(STRANGER, () => flagAdopter('maria', 'duplicate', 'x', 'jonatan'))).toMatchObject({ success: false, error: 'said_no' });
        expect(await askAdminsToReviewPair({ currentId: 'maria', matchId: 'jonatan' })).toEqual({ ok: true, already: false });
    });

    it('an admin pressing «Mantener separados» with no ruling recorded: not settled either (the pair is open as before)', async () => {
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at, resolved_by) VALUES ('c1', 'maria', 'jonatan', '["phone"]', 60, 'medium', 'dismissed', 1, ?)`).run(ADMIN);
        expect(await windowFor('jonatan')).toMatchObject({ action: 'continue' });
    });

    it('a gift household does not count', async () => {
        shareHome(1);
        expect(await windowFor('jonatan')).toMatchObject({ action: 'continue' });
    });
});

describe('the same phone saved twice in the existing paths (round 4)', () => {
    it('the general merge: «11 6312-0851» on the absorbed profile and «+54 9 11 6312-0851» on the kept one → one entry, the kept one\'s, with both apps', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'jonatan'`).run(JSON.stringify([{ id: 'j1', type: 'phone', value: '+54 9 11 6312-0851', apps: ['telegram'], addedBy: OTHER }]));
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'maria'`).run(JSON.stringify([{ id: 'm1', type: 'phone', value: '11 6312-0851', apps: ['whatsapp'], addedBy: OWNER }]));
        await tokenizeAdopter('maria');
        await tokenizeAdopter('jonatan');
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' })).toMatchObject({ ok: true });
        expect(contactsOf('jonatan').filter(c => c.type === 'phone')).toEqual([expect.objectContaining({ id: 'j1', value: '+54 9 11 6312-0851', apps: ['telegram', 'whatsapp'] })]);
    });

    it('the grant follows: after a rescuer merge the absorbed team may still see that number, on the kept entry', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'jonatan'`).run(JSON.stringify([{ id: 'j1', type: 'phone', value: '+54 9 11 6312-0851', addedBy: OTHER }, { id: 'j2', type: 'email', value: 'secreto@example.com', addedBy: OTHER }]));
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'maria'`).run(JSON.stringify([{ id: 'm1', type: 'phone', value: '11 6312-0851', addedBy: OWNER }]));
        expect(await continueWithMatchedProfile({ currentId: 'maria', matchId: 'jonatan' })).toMatchObject({ ok: true });
        const refs = sqlite.prepare(`SELECT entry_ref AS r FROM pii_access_grants WHERE adopter_id = 'jonatan' AND grantee_email = ? AND scope = 'entry' AND revoked_at IS NULL`).all(OWNER).map(g => g.r);
        expect(refs).toContain(hashEntryValue('phone', '+54 9 11 6312-0851'));
        // Never the survivor's other contacts (final review C1).
        expect(refs).not.toContain(hashEntryValue('email', 'secreto@example.com'));
    });

    it('the new-profile form\'s «Continuar con este perfil» (appendToExistingAdopter): «11 6312-0851» typed against «+54 9 11 6312-0851» is not stored twice', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'maria'`).run(JSON.stringify([{ id: 'p1', type: 'phone', value: '+54 9 11 6312-0851' }]));
        const res = await appendToExistingAdopter('maria', { contactEntries: JSON.stringify([{ type: 'phone', value: '11 6312-0851', apps: ['whatsapp'] }, { type: 'email', value: 'otra@example.com' }]) });
        expect(res).toMatchObject({ success: true });
        const phones = contactsOf('maria').filter(c => c.type === 'phone');
        expect(phones).toEqual([expect.objectContaining({ id: 'p1', value: '+54 9 11 6312-0851', apps: ['whatsapp'] })]);
        expect(contactsOf('maria').map(c => c.value)).toContain('otra@example.com');
    });
});
