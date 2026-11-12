/**
 * «No sé» on a form's «¿Es la misma persona?» (Jon 2026-11-12), on a real migrated SQLite:
 * the answer unlocks the contract, asks the other profile's people once, survives a rescan,
 * and the asker hears when the other side says they are two people.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: vi.fn(async (_n: { userId: string; type: string; title: string; body: string; metadata?: Record<string, unknown> }) => 'n1'),
}));

vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));
// Groups: Ana and her mate Bea (Patitas Norte); Sur is another rescue with mate Sol. The test DB answers
// synchronously, so the real org lookups are covered by orgMembership's own tests.
const TEAMS = [['ana@norte.org', 'bea@norte.org'], ['sur@sur.org', 'sol@sur.org']];
const teamOf = (e: string | null | undefined) => TEAMS.find(t => t.includes((e ?? '').trim().toLowerCase())) ?? [(e ?? '').trim().toLowerCase()];
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig<typeof import('@/lib/orgMembership')>()),
    isOwnerOrOrgMate: vi.fn(async (v: string | null | undefined, o: string | null | undefined) => !!v && !!o && teamOf(v).includes(o.trim().toLowerCase())),
    getOrgMemberEmailsFor: vi.fn(async (e: string) => teamOf(e)),
    getTeamEmails: vi.fn(async (e: string) => teamOf(e)),
}));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: notify,
    resolveDisplayName: async (e: string) => (e.startsWith('ana') ? 'Ana Gómez' : e.startsWith('sur') ? 'Patitas Sur' : e),
}));

import { answerPairUnsure, clearPairUnsure, carryUnsureAnswers, unsureAskersOf, tellUnsureAskers } from './pairUnsure';
import { unansweredSamePersonPairs } from './samePersonGate';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] } };
let sqlite: Sqlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => state.db as any;

function adopter(id: string, name: string, addedBy: string | null) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`).run(id, name, addedBy);
}
function pair(id: string, a: string, b: string, status = 'pending') {
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status) VALUES (?, ?, ?, '["phone"]', 80, 'high', ?)`).run(id, a, b, status);
}
function formCreated(adopterId: string) {
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, auto_adopter_id) VALUES (?, 'ana@norte.org', 'Laura Méndez', ?, ?)`).run(`sub-${adopterId}`, adopterId, adopterId);
}
const unsureOf = (id: string) => (sqlite.prepare('SELECT unsure_by FROM duplicate_candidates WHERE id = ?').get(id) as { unsure_by: string | null }).unsure_by;

beforeEach(() => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    adopter('laura', 'Laura Méndez', 'ana@norte.org'); // the profile Ana's form created
    adopter('lmendez', 'L. Méndez', 'sur@sur.org');     // the other rescue's 1★ profile
    adopter('lm-mate', 'Laura M.', 'bea@norte.org');    // one of Ana's group
    adopter('lm-import', 'Laura Mendez', 'anonymous');  // no real owner
    formCreated('laura');
    pair('p-sur', 'laura', 'lmendez');
});

describe('the lock', () => {
    it('locks a profile the form created while a pair has no answer, and «No sé» unlocks it', async () => {
        expect(await unansweredSamePersonPairs(db(), 'laura', 'ana@norte.org')).toBe(1);
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(await unansweredSamePersonPairs(db(), 'laura', 'ana@norte.org')).toBe(0);
    });
    it('«Cambiar mi respuesta» locks it again', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(unsureOf('p-sur')).toBeNull();
        expect(await unansweredSamePersonPairs(db(), 'laura', 'ana@norte.org')).toBe(1);
    });
    it('never locks a profile no form created', async () => {
        expect(await unansweredSamePersonPairs(db(), 'lmendez', 'sur@sur.org')).toBe(0);
    });
});

describe('«No sé»', () => {
    it('asks the other profile\'s owner and their group, once, with the pair ids for auto-clear', async () => {
        const res = await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(res).toEqual({ ok: true, asked: 'outside' });
        expect(notify.mock.calls.map(c => c[0].userId).sort()).toEqual(['sol@sur.org', 'sur@sur.org']);
        const n = notify.mock.calls[0][0];
        expect(n.type).toBe('same_person_question');
        expect(n.title).toBe('¿Laura Méndez es L. Méndez?');
        expect(n.body).toContain('Ana Gómez');
        expect(n.metadata).toMatchObject({ primaryId: 'lmendez', secondaryId: 'laura' });
        notify.mockClear();
        await answerPairUnsure(db(), 'p-sur', 'bea@norte.org'); // a teammate taps it again
        expect(notify).not.toHaveBeenCalled();
        expect(unsureOf('p-sur')).toBe('ana@norte.org');
    });
    it('asks nobody when the other profile is the group\'s own', async () => {
        pair('p-mate', 'laura', 'lm-mate');
        expect(await answerPairUnsure(db(), 'p-mate', 'ana@norte.org')).toEqual({ ok: true, asked: 'team' });
        expect(notify).not.toHaveBeenCalled();
    });
    it('asks nobody when the other profile has no real owner', async () => {
        pair('p-imp', 'laura', 'lm-import');
        expect(await answerPairUnsure(db(), 'p-imp', 'ana@norte.org')).toEqual({ ok: true, asked: 'none' });
        expect(notify).not.toHaveBeenCalled();
    });
    it('refuses someone outside both groups, and a settled pair', async () => {
        expect(await answerPairUnsure(db(), 'p-sur', 'stranger@x.org')).toEqual({ ok: false, code: 'not_authorized' });
        pair('p-done', 'laura', 'lm-import', 'dismissed');
        expect(await answerPairUnsure(db(), 'p-done', 'ana@norte.org')).toEqual({ ok: false, code: 'already_resolved' });
        expect(unsureOf('p-sur')).toBeNull();
    });
});

describe('the answer reaches the asker', () => {
    it('tells the «No sé» asker when the other side says two people', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        const askers = await unsureAskersOf(db(), 'laura', 'lmendez');
        expect(askers).toEqual(['ana@norte.org']);
        await tellUnsureAskers(db(), askers, { a: 'laura', b: 'lmendez', actor: 'sur@sur.org', answer: 'different' });
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n).toMatchObject({ userId: 'ana@norte.org', type: 'same_person_answered', title: 'Patitas Sur respondió: es otra persona' });
        expect(n.body).toBe('Laura Méndez no es L. Méndez. Los perfiles siguen separados.');
    });
    it('tells nobody when the asker\'s own group settled it', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await tellUnsureAskers(db(), ['ana@norte.org'], { a: 'laura', b: 'lmendez', actor: 'bea@norte.org', answer: 'different' });
        expect(notify).not.toHaveBeenCalled();
    });
});

describe('the admin Scan', () => {
    it('carries a «No sé» onto the rebuilt row of the same pair, in either orientation', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        pair('p-new', 'lmendez', 'laura', 'rebuilding'); // reversed orientation
        pair('p-other', 'laura', 'lm-import', 'rebuilding');
        await carryUnsureAnswers(db(), 'rebuilding');
        expect(unsureOf('p-new')).toBe('ana@norte.org');
        expect(unsureOf('p-other')).toBeNull();
    });
});
