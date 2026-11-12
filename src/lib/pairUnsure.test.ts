/**
 * «No sé» on a form's «¿Es la misma persona?» (Jon 2026-11-12), on a real migrated SQLite:
 * the answer unlocks the contract for the asker's group only, asks the other profile's people
 * once, and the asker hears when the other side says they are two people.
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

import { answerPairUnsure, clearPairUnsure, unsureAskersOf, tellUnsureAskers, sweepOrphanUnsure, recordSameAnswer, REASK_AFTER_MS } from './pairUnsure';
import { loadOpenPairs } from './openPairs';
import { unansweredForContract, unansweredForSubmission } from './samePersonGate';

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
function form(id: string, linked: string, auto: string, by = 'ana@norte.org') {
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, linked_adopter_id, auto_adopter_id) VALUES (?, ?, 'Laura Méndez', ?, ?)`).run(id, by, linked, auto);
}
function application(id: string, submissionId: string, animalId: string) {
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES (?, ?, ?, 'form', 'open')`).run(id, submissionId, animalId);
}
const formCreated = (adopterId: string, by?: string) => form(`sub-${adopterId}`, adopterId, adopterId, by);
const sub = (adopterId: string) => ({ linkedAdopterId: adopterId, autoAdopterId: adopterId });
const unsureRows = () => sqlite.prepare('SELECT pair_key, asker_email, withdrawn FROM pair_unsure ORDER BY asker_email').all() as Array<{ pair_key: string; asker_email: string; withdrawn: number }>;

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
    it('locks the form that created the profile while a pair has no answer; «No sé» unlocks it', async () => {
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(1);
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(0);
    });
    it('«Cambiar mi respuesta» locks it again', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(unsureRows()).toEqual([{ pair_key: 'laura|lmendez', asker_email: 'ana@norte.org', withdrawn: 1 }]);
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(1);
    });
    it('the contract locks only through an open application whose form created the profile', async () => {
        application('app-1', 'sub-laura', 'toto');
        expect(await unansweredForContract(db(), 'toto', 'laura', 'ana@norte.org')).toBe(1);
        expect(await unansweredForContract(db(), 'other-animal', 'laura', 'ana@norte.org')).toBe(0);
    });
    it('review C1: a form linked by «Sí» to a profile another form created never locks', async () => {
        // F1 created P (its own pair P–Q is open); F2 created N2, answered «Sí» → F2 now sits on P.
        adopter('p', 'Laura P.', 'ana@norte.org'); adopter('q', 'Laura Q.', 'sur@sur.org');
        form('f1', 'p', 'p'); pair('p-pq', 'p', 'q');
        form('f2', 'p', 'n2-merged-away'); application('app-2', 'f2', 'toto');
        expect(await unansweredForSubmission(db(), { linkedAdopterId: 'p', autoAdopterId: 'n2-merged-away' }, 'ana@norte.org')).toBe(0);
        expect(await unansweredForContract(db(), 'toto', 'p', 'ana@norte.org')).toBe(0);
    });
});

describe('«No sé» belongs to the asker\'s group (review I2)', () => {
    beforeEach(() => formCreated('lmendez', 'sur@sur.org')); // both profiles came from forms
    it('another group\'s «No sé» does not unlock mine', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(await unansweredForSubmission(db(), sub('lmendez'), 'sur@sur.org')).toBe(1);
        expect(await unansweredForSubmission(db(), sub('laura'), 'bea@norte.org')).toBe(0); // a teammate: unlocked
    });
    it('my «Cambiar mi respuesta» never withdraws another group\'s «No sé»', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await answerPairUnsure(db(), 'p-sur', 'sur@sur.org');
        await clearPairUnsure(db(), 'p-sur', 'sur@sur.org');
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(0);
        expect(await unansweredForSubmission(db(), sub('lmendez'), 'sur@sur.org')).toBe(1);
    });
});

describe('«No sé»', () => {
    it('asks the other profile\'s owner and their group, with the pair ids for auto-clear', async () => {
        const res = await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(res).toEqual({ ok: true, asked: 'outside' });
        expect(notify.mock.calls.map(c => c[0].userId).sort()).toEqual(['sol@sur.org', 'sur@sur.org']);
        const n = notify.mock.calls[0][0];
        expect(n.type).toBe('same_person_question');
        expect(n.title).toBe('Ana Gómez te pregunta si es la misma persona');
        expect(n.body).toBe('Evalúa el formulario de Laura Méndez, que pidió adoptar, y no sabe si es la misma persona que tu perfil «L. Méndez». Respondé en «Pendientes de revisar».');
        expect(n.metadata).toMatchObject({ primaryId: 'lmendez', secondaryId: 'laura' });
        // UX review: the link opens that pair in «Pendientes de revisar», not the top of the list.
        expect((n as { url?: string }).url).toBe('/my-adopters?pair=laura%7Clmendez#pendientes');
    });
    it('UX review: names the animal the form asks for', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name) VALUES ('toto', 'Toto')`).run();
        application('app-1', 'sub-laura', 'toto');
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(notify.mock.calls[0][0].body).toBe('Evalúa el formulario de Laura Méndez para adoptar a Toto y no sabe si es la misma persona que tu perfil «L. Méndez». Respondé en «Pendientes de revisar».');
    });
    it('EM review: on two of the group\'s own profiles, «No sé» answers for the one the form created, whatever the id order', async () => {
        adopter('aaa-mate', 'Laura M.', 'bea@norte.org'); // sorts before 'laura', so the form's profile is side b
        pair('p-rev', 'aaa-mate', 'laura');
        expect(await answerPairUnsure(db(), 'p-rev', 'ana@norte.org')).toEqual({ ok: true, asked: 'team' });
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(1); // p-sur is still open
    });
    it('review: undo then «No sé» again the same day puts the question back in the other side\'s bell (no second email)', async () => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES ('n-q', 'sur@sur.org', 'same_person_question', 't', 'b', 0, ?)`)
            .run(JSON.stringify({ primaryId: 'lmendez', secondaryId: 'laura' }));
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(notify).not.toHaveBeenCalled();
        expect((sqlite.prepare(`SELECT read FROM notifications WHERE id = 'n-q'`).get() as { read: number }).read).toBe(0);
    });
    it('review I3: a teammate\'s repeat or an off/on toggle does not ask again within a day', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await answerPairUnsure(db(), 'p-sur', 'bea@norte.org');
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(notify).not.toHaveBeenCalled();
        // A day later, answering again asks again.
        sqlite.prepare('UPDATE pair_unsure SET asked_at = ?').run(Math.floor((Date.now() - REASK_AFTER_MS - 60_000) / 1000));
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(notify).toHaveBeenCalled();
    });
    it('review I3: withdrawing the last «No sé» takes the question out of the other side\'s bell', async () => {
        sqlite.prepare(`INSERT INTO notifications (id, user_id, type, title, body, read, metadata) VALUES ('n-q', 'sur@sur.org', 'same_person_question', 't', 'b', 0, ?)`)
            .run(JSON.stringify({ primaryId: 'lmendez', secondaryId: 'laura' }));
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect((sqlite.prepare(`SELECT read FROM notifications WHERE id = 'n-q'`).get() as { read: number }).read).toBe(1);
    });
    it('asks nobody when the other profile is the group\'s own, or has no real owner', async () => {
        pair('p-mate', 'laura', 'lm-mate');
        pair('p-imp', 'laura', 'lm-import');
        expect(await answerPairUnsure(db(), 'p-mate', 'ana@norte.org')).toEqual({ ok: true, asked: 'team' });
        expect(await answerPairUnsure(db(), 'p-imp', 'ana@norte.org')).toEqual({ ok: true, asked: 'none' });
        expect(notify).not.toHaveBeenCalled();
    });
    it('review I4: refused outside both groups, on a settled or weak pair, and from a side no form created', async () => {
        expect(await answerPairUnsure(db(), 'p-sur', 'stranger@x.org')).toEqual({ ok: false, code: 'not_authorized' });
        expect(await answerPairUnsure(db(), 'p-sur', 'sur@sur.org')).toEqual({ ok: false, code: 'not_authorized' }); // L. Méndez: no form
        pair('p-done', 'laura', 'lm-import', 'dismissed');
        expect(await answerPairUnsure(db(), 'p-done', 'ana@norte.org')).toEqual({ ok: false, code: 'already_resolved' });
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status) VALUES ('p-weak', 'laura', 'lm-mate', '[]', 5, 'low', 'pending')`).run();
        expect(await answerPairUnsure(db(), 'p-weak', 'ana@norte.org')).toEqual({ ok: false, code: 'not_found' });
        expect(unsureRows()).toEqual([]);
        expect(notify).not.toHaveBeenCalled();
    });
});

describe('the answer reaches the asker', () => {
    it('tells the «No sé» asker when the other side says two people, then forgets the pair', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        const askers = await unsureAskersOf(db(), 'laura', 'lmendez');
        expect(askers).toEqual(['ana@norte.org']);
        await tellUnsureAskers(db(), askers, { a: 'laura', b: 'lmendez', actor: 'sur@sur.org', answer: 'different' });
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n).toMatchObject({ userId: 'ana@norte.org', type: 'same_person_answered', title: 'Patitas Sur respondió: es otra persona' });
        expect(n.body).toBe('El formulario de Laura Méndez no es de la persona de su perfil «L. Méndez». Los perfiles siguen separados.');
        expect(unsureRows()).toEqual([]);
        expect(await unsureAskersOf(db(), 'laura', 'lmendez')).toEqual([]); // a second settle tells nobody
    });
    it('Jon 2026-11-12: the other side\'s «Sí» informs, never blocks — her contract stays unlocked and her card names who answered', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await recordSameAnswer(db(), 'lmendez', 'laura', 'sur@sur.org');
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toMatchObject({ userId: 'ana@norte.org', type: 'same_person_answered', title: 'Patitas Sur respondió: es la misma persona' });
        expect(notify.mock.calls[0][0].body).toBe('El formulario de Laura Méndez es de la persona de su perfil «L. Méndez». Revisá ese perfil y, si ya enviaste el contrato o entregaste el animal, tenelo en cuenta.');
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(0);
        const [p] = await loadOpenPairs(db(), 'laura', 'ana@norte.org', { limit: 20 });
        expect(p).toMatchObject({ unsureBy: 'ana@norte.org', unsureSameBy: 'sur@sur.org' });
        notify.mockClear();
        await recordSameAnswer(db(), 'lmendez', 'laura', 'sol@sur.org'); // told once
        expect(notify).not.toHaveBeenCalled();
    });
    it('tells nobody when the asker\'s own group settled it', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await tellUnsureAskers(db(), ['ana@norte.org'], { a: 'laura', b: 'lmendez', actor: 'bea@norte.org', answer: 'different' });
        expect(notify).not.toHaveBeenCalled();
    });
    it('re-review: a pair dropped without an answer forgets its «No sé», so a re-detection starts unanswered', async () => {
        pair('p-mate', 'laura', 'lm-mate');
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await answerPairUnsure(db(), 'p-mate', 'ana@norte.org');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'p-sur'`).run(); // e.g. a Scan stopped pairing them
        await sweepOrphanUnsure(db());
        expect(unsureRows().map(r => r.pair_key)).toEqual(['laura|lm-mate']);
        pair('p-again', 'lmendez', 'laura');
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(1);
    });
    it('a failed ask does not hold the next one back', async () => {
        notify.mockRejectedValueOnce(new Error('bell down'));
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        notify.mockClear();
        await clearPairUnsure(db(), 'p-sur', 'ana@norte.org');
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        expect(notify).toHaveBeenCalled();
    });
    it('a rescan that rebuilds the pair row keeps the answer (it is keyed by the pair, not the row)', async () => {
        await answerPairUnsure(db(), 'p-sur', 'ana@norte.org');
        sqlite.prepare(`DELETE FROM duplicate_candidates WHERE id = 'p-sur'`).run();
        pair('p-rebuilt', 'lmendez', 'laura');
        expect(await unansweredForSubmission(db(), sub('laura'), 'ana@norte.org')).toBe(0);
    });
});
