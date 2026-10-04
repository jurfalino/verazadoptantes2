/**
 * Two teammates editing the same group's adoption docs: per-item revisions,
 * conflicts, pulled-in changes, attribution, and the compare-and-swap.
 * Real SQL on the real schema (src/test-utils/migratedDb.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser } from '@/test-utils/actionMocks';

const { state, auditSpy } = vi.hoisted(() => ({ state: { db: null as unknown, sqlite: null as unknown, tick: 0 }, auditSpy: vi.fn() }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => true }));
// logAudit writes a real audit_log row (attribution of form toggles reads it back).
vi.mock('@/lib/audit', () => ({
    logAudit: async (e: { userEmail?: string; action: string; target?: string; details?: unknown }) => {
        auditSpy(e);
        (state.sqlite as { prepare: (s: string) => { run: (...a: unknown[]) => unknown } })
            .prepare('INSERT INTO audit_log (id, user_email, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), e.userEmail ?? null, e.action, e.target ?? null, JSON.stringify(e.details ?? {}), 1_000 + state.tick++);
    },
}));

import { getAdoptionDocs, saveContractSections, saveFormSteps } from './adoptionDocs';
import { saveContract } from '@/lib/adoptionDocsRepo';
import type { RichDoc } from '@/domain/adoptionDocs';

const ANA = 'ana@example.com';       // has a display name
const BETO = 'beto.rescates@example.com'; // no name → handle "beto.rescates"
const ORG = { type: 'org' as const, orgId: 'org-1' };
const doc = (text: string): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ text }] }] });
const textOf = (d: RichDoc | null | undefined) => d?.content.map(b => b.type === 'paragraph' ? b.content.map(i => i.text).join('') : '').join('\n') ?? null;

type Sql = { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => Record<string, unknown> | undefined; all: (...a: unknown[]) => Array<Record<string, unknown>> } };
let sqlite: Sql;

async function loadAs(email: string) {
    session.user = email;
    const res = await getAdoptionDocs(ORG);
    if (!res.success || !res.data) throw new Error('load failed');
    return res.data;
}

describe('collaborative contract editing', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db; state.sqlite = m.sqlite; sqlite = m.sqlite as unknown as Sql; state.tick = 0;
        auditSpy.mockReset();
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-ana', 'Ana Pérez', ?), ('u-beto', NULL, ?)`).run(ANA, BETO);
        sqlite.prepare(`INSERT INTO organizations (id, name, created_by) VALUES ('org-1', 'Patitas', ?)`).run(ANA);
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m1', 'org-1', ?, 'owner'), ('m2', 'org-1', ?, 'member')`).run(ANA, BETO);
    });

    it('a fresh owner loads every section at the standard revision', async () => {
        const d = await loadAs(ANA);
        expect(d.revisions.sections).toEqual({ '2': 'std', '3': 'std', '4': 'std' });
    });

    it('different sections: both saves land, nothing is lost, the second editor gets the first one\'s text', async () => {
        const ana = await loadAs(ANA);
        const beto = await loadAs(BETO);
        session.user = ANA;
        const r1 = await saveContractSections(ORG, { loaded: ana.revisions.sections, changes: [{ key: '2', doc: doc('Sección 2 de Ana'), expectedRev: ana.revisions.sections['2'] }] });
        expect(r1.success && r1.data.saved).toEqual(['2']);
        session.user = BETO;
        const r2 = await saveContractSections(ORG, { loaded: beto.revisions.sections, changes: [{ key: '3', doc: doc('Sección 3 de Beto'), expectedRev: beto.revisions.sections['3'] }] });
        if (!r2.success) throw new Error('save failed');
        expect(r2.data.saved).toEqual(['3']);
        expect(r2.data.updatedByOthers).toEqual([{ key: '2', by: 'Ana Pérez' }]);
        expect(textOf(r2.data.sections['2'])).toBe('Sección 2 de Ana');
        expect(textOf(r2.data.sections['3'])).toBe('Sección 3 de Beto');
        const after = await loadAs(ANA);
        expect(textOf(after.sections['2'])).toBe('Sección 2 de Ana');
        expect(textOf(after.sections['3'])).toBe('Sección 3 de Beto');
    });

    it('same section: the second save is refused for that section, with their text and name; no audit row', async () => {
        const ana = await loadAs(ANA);
        const beto = await loadAs(BETO);
        session.user = ANA;
        await saveContractSections(ORG, { loaded: ana.revisions.sections, changes: [{ key: '2', doc: doc('Ana'), expectedRev: ana.revisions.sections['2'] }] });
        auditSpy.mockClear();
        session.user = BETO;
        const r = await saveContractSections(ORG, { loaded: beto.revisions.sections, changes: [{ key: '2', doc: doc('Beto'), expectedRev: beto.revisions.sections['2'] }] });
        if (!r.success) throw new Error('save failed');
        expect(r.data.saved).toEqual([]);
        expect(r.data.conflicts).toHaveLength(1);
        expect(r.data.conflicts[0]).toMatchObject({ key: '2', by: 'Ana Pérez' });
        expect(textOf(r.data.conflicts[0].doc)).toBe('Ana');
        expect(auditSpy).not.toHaveBeenCalled();
        expect(textOf((await loadAs(ANA)).sections['2'])).toBe('Ana');

        // «Guardar la mía igual»: overwrite THAT section, checked against their revision.
        session.user = BETO;
        const r2 = await saveContractSections(ORG, { loaded: {}, changes: [{ key: '2', doc: doc('Beto'), expectedRev: r.data.conflicts[0].theirRev }] });
        expect(r2.success && r2.data.saved).toEqual(['2']);
        expect(textOf((await loadAs(ANA)).sections['2'])).toBe('Beto');
    });

    it('a stale "their revision" (a third save in between) conflicts again', async () => {
        const ana = await loadAs(ANA);
        session.user = ANA;
        const first = await saveContractSections(ORG, { loaded: ana.revisions.sections, changes: [{ key: '4', doc: doc('uno'), expectedRev: 'std' }] });
        if (!first.success) throw new Error('x');
        const revAfterFirst = first.data.revisions['4'];
        await saveContractSections(ORG, { loaded: {}, changes: [{ key: '4', doc: doc('dos'), expectedRev: revAfterFirst }] });
        session.user = BETO;
        const r = await saveContractSections(ORG, { loaded: {}, changes: [{ key: '4', doc: doc('tres'), expectedRev: revAfterFirst }] });
        expect(r.success && r.data.conflicts.map(c => c.key)).toEqual(['4']);
        expect(textOf((await loadAs(ANA)).sections['4'])).toBe('dos');
    });

    it('a name-less teammate is named by their email handle — never the full email', async () => {
        const ana = await loadAs(ANA);
        session.user = BETO;
        await saveContractSections(ORG, { loaded: {}, changes: [{ key: '3', doc: doc('Beto'), expectedRev: 'std' }] });
        session.user = ANA;
        const r = await saveContractSections(ORG, { loaded: ana.revisions.sections, changes: [{ key: '3', doc: doc('Ana'), expectedRev: 'std' }] });
        if (!r.success) throw new Error('x');
        expect(r.data.conflicts[0].by).toBe('beto.rescates');
        expect(JSON.stringify(r.data)).not.toContain('@');
    });

    it('resetting a section to the standard text is a change like any other (and setting it back is not a conflict)', async () => {
        session.user = ANA;
        const s1 = await saveContractSections(ORG, { loaded: {}, changes: [{ key: '2', doc: doc('custom'), expectedRev: 'std' }] });
        if (!s1.success) throw new Error('x');
        const s2 = await saveContractSections(ORG, { loaded: {}, changes: [{ key: '2', doc: null, expectedRev: s1.data.revisions['2'] }] });
        expect(s2.success && s2.data).toMatchObject({ saved: ['2'], standard: true });
        expect((await loadAs(BETO)).revisions.sections['2']).toBe('std');
    });

    it('invalid input is refused with an errorId', async () => {
        session.user = ANA;
        const r = await saveContractSections(ORG, { loaded: {}, changes: [{ key: '9' as never, doc: null, expectedRev: 'std' }] });
        expect(r).toMatchObject({ success: false, error: 'invalid' });
        expect((r as { errorId?: string }).errorId).toBeTruthy();
    });

    it('compare-and-swap: a save against a version that is no longer current never becomes current', async () => {
        session.user = ANA;
        const owner = { ownerType: 'org' as const, ownerId: 'org-1' };
        const a = await saveContract(state.db as never, owner, { '2': doc('A') }, ANA, null);
        expect(a.action).toBe('insert');
        // A stale writer still believes the owner is on the standard text.
        const stale = await saveContract(state.db as never, owner, { '2': doc('B') }, BETO, null);
        expect(stale.raced).toBe(true);
        const settings = sqlite.prepare("SELECT contract_version_id FROM adoption_doc_settings WHERE owner_id = 'org-1'").get()!;
        expect(settings.contract_version_id).toBe(a.versionId);
        const current = sqlite.prepare('SELECT COUNT(*) AS n FROM contract_versions WHERE owner_id = ? AND replaced_at IS NULL').get('org-1')!;
        expect(current.n).toBe(1);
    });
});

describe('collaborative form editing', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db; state.sqlite = m.sqlite; sqlite = m.sqlite as unknown as Sql; state.tick = 0;
        auditSpy.mockReset();
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-ana', 'Ana Pérez', ?), ('u-beto', NULL, ?)`).run(ANA, BETO);
        sqlite.prepare(`INSERT INTO organizations (id, name, created_by) VALUES ('org-1', 'Patitas', ?)`).run(ANA);
        sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email, role) VALUES ('m1', 'org-1', ?, 'owner'), ('m2', 'org-1', ?, 'member')`).run(ANA, BETO);
    });

    it('different questions: both land; same question: refused with who and their state', async () => {
        const ana = await loadAs(ANA);
        const beto = await loadAs(BETO);
        const [q1, q2] = Object.keys(ana.revisions.steps);
        session.user = ANA;
        const a = await saveFormSteps(ORG, { loaded: ana.revisions.steps, changes: [{ key: q1, hidden: true, expected: 'shown' }] });
        expect(a.success && a.data.saved).toEqual([q1]);
        session.user = BETO;
        const b = await saveFormSteps(ORG, { loaded: beto.revisions.steps, changes: [{ key: q2, hidden: true, expected: 'shown' }] });
        if (!b.success) throw new Error('x');
        expect(b.data.saved).toEqual([q2]);
        expect(b.data.updatedByOthers).toEqual([{ key: q1, by: 'Ana Pérez' }]);
        expect(b.data.hiddenSteps).toEqual(expect.arrayContaining([q1, q2]));

        auditSpy.mockClear();
        const c = await saveFormSteps(ORG, { loaded: {}, changes: [{ key: q1, hidden: false, expected: 'shown' }] });
        if (!c.success) throw new Error('x');
        expect(c.data.conflicts).toEqual([{ key: q1, by: 'Ana Pérez', theirs: 'hidden' }]);
        expect(auditSpy).not.toHaveBeenCalled();
    });

    it('a contract save in between does not make a form save conflict (separate columns)', async () => {
        const beto = await loadAs(BETO);
        session.user = ANA;
        await saveContractSections(ORG, { loaded: {}, changes: [{ key: '2', doc: doc('Ana'), expectedRev: 'std' }] });
        session.user = BETO;
        const q = Object.keys(beto.revisions.steps)[0];
        const r = await saveFormSteps(ORG, { loaded: beto.revisions.steps, changes: [{ key: q, hidden: true, expected: 'shown' }] });
        expect(r.success && r.data.saved).toEqual([q]);
        expect(r.success && r.data.conflicts).toEqual([]);
    });
});
