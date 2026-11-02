import { describe, it, expect } from 'vitest';
import {
    judgeIdentity, rankJudged, isPlaceholderDocument, countsAsShared,
    type IdentityCandidate, type PersonFacts, type SharedIdentifier, type Judged,
} from './identityVerdict';

const facts = (o: Partial<PersonFacts> = {}): PersonFacts => ({
    name: 'Majo Pérez', aliases: [], phones: [], emails: [], socials: [], documentIds: [], ...o,
});
const cand = (o: Partial<IdentityCandidate> = {}): IdentityCandidate => ({
    adopterId: 'a1', name: 'María José Pérez', aliases: [], shared: [], relevancePercent: 50,
    matchTypes: [], matchValues: [], source: 'token', ...o,
});
const sh = (kind: SharedIdentifier['kind'], namesHolding: number | null = 1, value = 'x'): SharedIdentifier => ({ kind, value, namesHolding });

describe('judgeIdentity', () => {
    it('shared DNI is same even when the name differs a lot', () => {
        const r = judgeIdentity(facts({ name: 'Majo Pérez' }), cand({ shared: [sh('document', 1, '30123456')] }));
        expect(r).toMatchObject({ verdict: 'same', reason: 'shared_document' });
        const r2 = judgeIdentity(facts({ name: 'Juan Ruiz' }), cand({ shared: [sh('document', 1, '30123456')] }));
        expect(r2).toMatchObject({ verdict: 'same', reason: 'shared_document' });
    });
    it('phone + compatible name is same', () => {
        expect(judgeIdentity(facts({ name: 'María Pérez' }), cand({ shared: [sh('phone')] })))
            .toMatchObject({ verdict: 'same', reason: 'shared_contact_name_compatible' });
    });
    it('phone + name matching an alias only is same', () => {
        expect(judgeIdentity(facts({ name: 'Majo Pérez' }), cand({ name: 'Juan Ruiz', aliases: ['Majo Pérez'], shared: [sh('phone')] })))
            .toMatchObject({ verdict: 'same', reason: 'shared_contact_name_compatible' });
    });
    it('phone + incompatible name is possible', () => {
        expect(judgeIdentity(facts({ name: 'Juan Carlos Ruiz' }), cand({ shared: [sh('phone')] })))
            .toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    it('social account + incompatible name is possible', () => {
        expect(judgeIdentity(facts({ name: 'Majo Pérez' }), cand({ shared: [sh('social')] })))
            .toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    it('social account + compatible name is same (decision 3)', () => {
        expect(judgeIdentity(facts({ name: 'María Pérez' }), cand({ shared: [sh('social')] })))
            .toMatchObject({ verdict: 'same', reason: 'shared_contact_name_compatible' });
    });
    it('same full name with nothing shared is possible', () => {
        expect(judgeIdentity(facts({ name: 'María José Pérez' }), cand()))
            .toMatchObject({ verdict: 'possible', reason: 'same_full_name' });
        expect(judgeIdentity(facts({ name: 'María Pérez' }), cand()))
            .toMatchObject({ verdict: 'possible', reason: 'same_full_name' });
    });
    it('one-word or different names with nothing shared are no', () => {
        expect(judgeIdentity(facts({ name: 'Ana' }), cand({ name: 'Ana Gómez' }))).toMatchObject({ verdict: 'no', reason: null });
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand())).toMatchObject({ verdict: 'no', reason: null });
    });
    // Controller ruling (final review item 7): a contact found only by the contact-text LIKE
    // fallback is evidence — possible, never same. Supersedes the Task 1 'no' expectation.
    it('a contact LIKE hit with nothing shared and incompatible names is possible', () => {
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ matchTypes: ['like_fallback_contact'], shared: [] })))
            .toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    it('a contact LIKE hit with a one-word name is possible, shared_contact_name_differs', () => {
        expect(judgeIdentity(facts({ name: 'María' }), cand({ matchTypes: ['like_fallback_contact'], shared: [] })))
            .toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    it('a contact LIKE hit with a compatible full name is possible via rule 4, never same', () => {
        expect(judgeIdentity(facts({ name: 'María Pérez' }), cand({ matchTypes: ['like_fallback_contact'], shared: [] })))
            .toMatchObject({ verdict: 'possible', reason: 'same_full_name' });
    });
    it('a name-only LIKE hit is not evidence', () => {
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ matchTypes: ['like_fallback_name'], shared: [] })))
            .toMatchObject({ verdict: 'no' });
    });
    it('a contact LIKE hit next to a junk identifier stays no (the junk guard wins)', () => {
        expect(judgeIdentity(facts({ name: 'Luis Paz' }), cand({ matchTypes: ['email', 'like_fallback_contact'], shared: [sh('email', 4)] })))
            .toMatchObject({ verdict: 'no' });
    });
    it('placeholder DNIs are recognised and do not count', () => {
        for (const p of ['00000000', '11111111', '12345678', '123456789', '1234567', '87654321']) expect(isPlaceholderDocument(p)).toBe(true);
        expect(isPlaceholderDocument('30123456')).toBe(false);
        expect(countsAsShared(sh('document', 1, '00000000'))).toBe(false);
        expect(countsAsShared(sh('document', 1, '30.123.456'))).toBe(true);
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ shared: [sh('document', 1, '00000000')] })))
            .toMatchObject({ verdict: 'no' });
    });
    it('an identifier held by more than 3 names is junk; exactly 3 counts', () => {
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ shared: [sh('email', 4)] }))).toMatchObject({ verdict: 'no' });
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ shared: [sh('email', 3)] })))
            .toMatchObject({ verdict: 'possible', reason: 'shared_contact_name_differs' });
    });
    it('unknown holder count on the only shared identifier is possible, details_unavailable', () => {
        expect(judgeIdentity(facts({ name: 'Juan Gómez' }), cand({ shared: [sh('phone', null)] })))
            .toMatchObject({ verdict: 'possible', reason: 'details_unavailable' });
    });
    it('a degraded candidate is never same', () => {
        expect(judgeIdentity(facts(), cand({ degraded: true, shared: [sh('document', 1, '30123456')] })))
            .toMatchObject({ verdict: 'possible', reason: 'details_unavailable' });
    });
});

describe('rankJudged', () => {
    const j = (id: string, verdict: Judged['verdict'], shared: SharedIdentifier[], rel: number, nameMatchedAs?: 'profile' | 'alias'): Judged => ({
        candidate: cand({ adopterId: id, shared, relevancePercent: rel }), verdict, reason: null, ...(nameMatchedAs ? { nameMatchedAs } : {}),
    });
    it('puts same before possible and drops no', () => {
        const out = rankJudged([j('p', 'possible', [], 99), j('n', 'no', [], 100), j('s', 'same', [], 1)]);
        expect(out.map(x => x.candidate.adopterId)).toEqual(['s', 'p']);
    });
    it('ranks same by distinct shared kinds, then own-name match, then relevance', () => {
        const out = rankJudged([
            j('low', 'same', [sh('phone')], 10, 'alias'),
            j('hi', 'same', [sh('phone')], 90, 'alias'),
            j('own', 'same', [sh('phone')], 5, 'profile'),
            j('two', 'same', [sh('phone'), sh('email')], 1, 'alias'),
        ]);
        expect(out.map(x => x.candidate.adopterId)).toEqual(['two', 'own', 'hi', 'low']);
    });
    it('ranks possible by relevance desc', () => {
        const out = rankJudged([j('a', 'possible', [], 20), j('b', 'possible', [], 80)]);
        expect(out.map(x => x.candidate.adopterId)).toEqual(['b', 'a']);
    });
});
