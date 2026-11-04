/**
 * A contact the viewer already has is never hidden on the other profile of a
 * "same person?" comparison (2026-11-04: Jon's «Mili» +54 9 11 4438-7944 showed
 * as «1144••••••» on the Catpuccino profile it matched). Only the EQUAL value is
 * revealed; the profile's other contacts stay masked.
 *
 * Covers the two ways in: the «Pendientes de revisar» pair (the other side's
 * values the viewer sees in full) and hydrateDuplicateMatches' `revealValues`
 * (what the rescuer typed: the create form, housemates, the typing hint).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, STRANGER } = mocks;

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, failFor: null as string | null } }));

// Owner-aware: a viewer sees their own profiles in full and nothing else.
const visibilityFor = (viewer: string | null | undefined, addedBy: string | null) => addedBy && addedBy === viewer
    ? { tier: 'full', privileged: true, nothingMasked: true, hasAllContactGrant: false, unlockedEntryHashes: new Set<string>(), unlockedNameTokenHashes: new Set<string>() }
    : { tier: 'none', privileged: false, nothingMasked: false, hasAllContactGrant: false, unlockedEntryHashes: new Set<string>(), unlockedNameTokenHashes: new Set<string>() };

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, isOwnerOrOrgMate: mocks.isOwnerOrOrgMate,
    getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor, getTeamEmails: mocks.getOrgMemberEmailsFor,
}));
vi.mock('@/lib/piiAccessServer', () => ({
    resolveAdopterVisibility: async (viewer: string, a: { id: string; addedBy: string | null }) => {
        if (a.id === state.failFor) throw new Error('D1 down');
        return visibilityFor(viewer, a.addedBy);
    },
    resolveAdoptersVisibility: async (viewer: string, rows: Array<{ id: string; addedBy: string | null }>) =>
        new Map(rows.map(r => [r.id, visibilityFor(viewer, r.addedBy)])),
    isPiiGatingEnabled: async () => true,
    isPublicProfilesEnabled: async () => false,
    maskOptionsFor: () => ({}),
}));
vi.mock('./enrichAdopters', () => ({ enrichAdopters: async () => new Map() }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { getPendingDuplicatesForUser, type PendingDedupSide } from './duplicates';
import { hydrateDuplicateMatches } from './hydrateDuplicateMatches';
import { deserializeContactEntries } from '@/lib/contactEntries';
import type { DuplicateMatch } from './types';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

// The production pair: the Catpuccino profile keeps two phones on one line.
const THEIRS = 'Email: milee@example.com\nTel: 1144102609/ 1144387944';
const MINE = 'Tel: +5491144387944';

beforeEach(() => {
    state.failFor = null;
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, contact_info, added_by, created_at, updated_at) VALUES
        ('mine', 'Mili', '5', ?, ?, 1000, 1000), ('theirs', 'Barbara Milagros Bruscella', '5', ?, ?, 2000, 2000)`)
        .run(MINE, OWNER, THEIRS, STRANGER);
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
        VALUES ('cand', 'theirs', 'mine', '["phone"]', '{"phone":["541144387944","44387944"]}', 50, 'high', 'pending', 1)`).run();
});

const shown = (side: PendingDedupSide) => deserializeContactEntries(side.contactEntries).map(e => [e.type, e.masked ? 'masked' : e.value]);

async function pairAs(viewer: string) {
    session.user = viewer;
    const { pairs } = await getPendingDuplicatesForUser(1, 10);
    const p = pairs.find(x => x.candidateId === 'cand');
    if (!p) throw new Error('pair not in feed');
    return p;
}

describe('«Pendientes de revisar» — the matched contact shows on the other profile', () => {
    it("the other rescuer's profile reveals the phone the viewer has, and only that one", async () => {
        const p = await pairAs(OWNER);
        expect(p.newAdopter.id).toBe('theirs');
        expect(shown(p.newAdopter)).toEqual([['email', 'masked'], ['phone', 'masked'], ['phone', '1144387944']]);
        // Something is still hidden, so «Pedir acceso a quien lo cargó» stays.
        expect(p.newAdopter.canSeeContact).toBe(false);
        expect(p.existingAdopter).toMatchObject({ id: 'mine', canSeeContact: true, contactInfo: MINE });
    });

    it('the same from the other owner: their view of «Mili» reveals the shared number', async () => {
        const p = await pairAs(STRANGER);
        expect(p.existingAdopter.id).toBe('mine');
        expect(shown(p.existingAdopter)).toEqual([['phone', '+5491144387944']]);
        expect(p.existingAdopter.canSeeContact).toBe(true);
    });

    it('a side whose own visibility cannot be read reveals nothing, and lends nothing to the other side', async () => {
        state.failFor = 'mine';
        const p = await pairAs(OWNER);
        expect(p.existingAdopter).toMatchObject({ id: 'mine', contactInfo: null, canSeeContact: false });
        expect(shown(p.newAdopter).every(([, v]) => v === 'masked')).toBe(true);
    });
});

describe('hydrateDuplicateMatches — revealValues (what the rescuer typed)', () => {
    const match: DuplicateMatch = { adopterId: 'theirs', adopterName: 'Barbara', relevancePercent: 80, matchTypes: ['phone'], matchValues: [], source: 'token' } as DuplicateMatch;
    const contactOf = async (opts: Parameters<typeof hydrateDuplicateMatches>[2]) =>
        (await hydrateDuplicateMatches(state.db, [match], opts))[0].adopter.contactInfo;

    it('a typed phone equal to one on the profile shows in full; the rest stays masked', async () => {
        const text = await contactOf({ viewer: OWNER, isUnauthenticated: false, revealValues: ['+54 9 11 4438-7944'] });
        expect(text).toContain('1144387944');
        expect(text).not.toContain('1144102609');
        expect(text).not.toContain('milee@');
    });

    it('nothing typed, or a different number: everything masked', async () => {
        for (const revealValues of [undefined, [], ['1199998888']]) {
            const text = await contactOf({ viewer: OWNER, isUnauthenticated: false, revealValues });
            expect(text).not.toContain('1144387944');
            expect(text).not.toContain('1144102609');
        }
    });

    it('one stored entry holding two numbers is revealed only when the rescuer typed both (review 2026-11-04)', async () => {
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'theirs'`).run(JSON.stringify([
            { id: 'p1', type: 'phone', value: '1144102609 / 1144387944', addedBy: STRANGER },
        ]));
        const one = await contactOf({ viewer: OWNER, isUnauthenticated: false, revealValues: ['1144387944'] });
        expect(one).not.toContain('1144102609');
        const both = await contactOf({ viewer: OWNER, isUnauthenticated: false, revealValues: ['1144387944', '1144102609'] });
        expect(both).toContain('1144102609');
        expect(both).toContain('1144387944');
    });

    it('a logged-out viewer never gets a reveal', async () => {
        const text = await contactOf({ viewer: 'unknown', isUnauthenticated: true, revealValues: ['1144387944'] });
        expect(text).not.toContain('1144387944');
    });
});
