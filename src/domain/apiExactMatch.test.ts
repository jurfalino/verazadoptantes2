import { describe, it, expect } from 'vitest';
import {
    isFullName, namesCompatible, decideExactOutcome, pickBestMatch,
    normalizeDocumentId, isUsableDocumentId, type CandidateNames,
} from './apiExactMatch';
import { judgeIdentity, type PersonFacts, type SharedIdentifier } from './identityVerdict';

const cand = (profileId: string, name: string, extra: Partial<CandidateNames> = {}): CandidateNames =>
    ({ profileId, name, aliases: [], ...extra });

describe('isFullName', () => {
    it('needs two real words', () => {
        expect(isFullName('María Pérez')).toBe(true);
        expect(isFullName('María')).toBe(false);
        expect(isFullName('María P')).toBe(false);
        expect(isFullName('  ')).toBe(false);
    });
});

describe('namesCompatible', () => {
    it('ignores accents, case and order', () => {
        expect(namesCompatible('maria PEREZ', 'Pérez, María')).toBe(true);
    });
    it('accepts a missing middle name or second surname either way', () => {
        expect(namesCompatible('María Pérez', 'María José Pérez Gómez')).toBe(true);
        expect(namesCompatible('María José Pérez Gómez', 'María Pérez')).toBe(true);
    });
    it('accepts one typo per long word, not on short words', () => {
        expect(namesCompatible('Maria Peres', 'María Pérez')).toBe(true);
        expect(namesCompatible('Ana Paz', 'Ama Paz')).toBe(false);
    });
    it('rejects a different surname', () => {
        expect(namesCompatible('María Gómez', 'María Pérez')).toBe(false);
    });
    it('uses each stored word once', () => {
        expect(namesCompatible('Juan Juan', 'Juan Pérez')).toBe(false);
    });
});

describe('decideExactOutcome', () => {
    it('no identifier hit → not_found', () => {
        expect(decideExactOutcome('María Pérez', [])).toEqual({ result: 'not_found' });
    });
    it('one profile, consistent name → found', () => {
        expect(decideExactOutcome('María Pérez', [cand('a', 'María José Pérez')]))
            .toEqual({ result: 'found', profileId: 'a', nameMatchedAs: 'profile', otherProfileIds: [] });
    });
    it('one profile, the name is an alias → found, says which', () => {
        expect(decideExactOutcome('Mery Pérez', [cand('a', 'María Pérez', { aliases: ['Mery Pérez'] })]))
            .toMatchObject({ result: 'found', nameMatchedAs: 'alias' });
    });
    it('a housemate\'s name is never a match on the host (households as profiles: no household_member)', () => {
        // The housemate is a profile of its own; the identifier finds THEM, as `profile`.
        const housemateOnHost = { ...cand('a', 'María Pérez'), householdNames: ['Carlos Pérez'] } as Parameters<typeof decideExactOutcome>[1][number];
        expect(decideExactOutcome('Carlos Pérez', [housemateOnHost]))
            .toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['a'], compatible: [] });
    });
    it('one profile, unrelated name (shared family phone) → ambiguous name_mismatch', () => {
        expect(decideExactOutcome('Laura Gómez', [cand('a', 'María Pérez')]))
            .toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['a'], compatible: [] });
    });
    it('several profiles, exactly one consistent → found that one', () => {
        // ...and still reports the other hit, so a flagged profile under another name can't hide.
        expect(decideExactOutcome('María Pérez', [cand('a', 'Laura Gómez'), cand('b', 'María Pérez')]))
            .toMatchObject({ result: 'found', profileId: 'b', otherProfileIds: ['a'] });
    });
    it('several profiles, none or several consistent → ambiguous multiple_profiles', () => {
        expect(decideExactOutcome('María Pérez', [cand('a', 'María Pérez'), cand('b', 'María Pérez López')]))
            .toEqual({ result: 'ambiguous', reason: 'multiple_profiles', profileIds: ['a', 'b'], compatible: [{ profileId: 'a', as: 'profile' }, { profileId: 'b', as: 'profile' }] });
        expect(decideExactOutcome('Ana Ruiz', [cand('a', 'María Pérez'), cand('b', 'Laura Gómez')]))
            .toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles', compatible: [] });
    });
});

describe('pickBestMatch (ambiguous, several names fit)', () => {
    const fit = (profileId: string, as: 'profile' | 'alias' | 'household_member' = 'profile') => ({ profileId, as });
    it('no name fits → null (a new profile is created instead)', () => {
        expect(pickBestMatch([], new Map(), new Map())).toBeNull();
    });
    it('most identifiers matched wins', () => {
        expect(pickBestMatch([fit('a'), fit('b')], new Map([['a', ['phone']], ['b', ['phone', 'email']]]), new Map())).toBe('b');
    });
    it('then the closest name: the profile\'s own over an alias over a household member', () => {
        const on = new Map([['a', ['phone']], ['b', ['phone']], ['c', ['phone']]]);
        expect(pickBestMatch([fit('a', 'household_member'), fit('b', 'alias'), fit('c')], on, new Map())).toBe('c');
        expect(pickBestMatch([fit('a', 'household_member'), fit('b', 'alias')], on, new Map())).toBe('b');
    });
    it('then the most recent activity; undated loses', () => {
        const on = new Map([['a', ['phone']], ['b', ['phone']]]);
        expect(pickBestMatch([fit('a'), fit('b')], on, new Map([['a', '2025-01-01T00:00:00Z'], ['b', '2026-01-01T00:00:00Z']]))).toBe('b');
        expect(pickBestMatch([fit('a'), fit('b')], on, new Map([['a', '2025-01-01T00:00:00Z'], ['b', null]]))).toBe('a');
    });
    it('a full tie is still deterministic', () => {
        expect(pickBestMatch([fit('b'), fit('a')], new Map(), new Map())).toBe('a');
    });
});

describe('document id', () => {
    it('normalizes like the tokenizer', () => {
        expect(normalizeDocumentId('30.123.456')).toBe('30123456');
        expect(normalizeDocumentId('V-12345678')).toBe('v12345678');
    });
    it('rejects ids the index never stores', () => {
        expect(isUsableDocumentId('30.123.456')).toBe(true);
        expect(isUsableDocumentId('AB12')).toBe(false);
    });
});

describe('decideExactOutcome on the identity verdict (verdicts given)', () => {
    const cand = (profileId: string, name: string, shared: SharedIdentifier[]) => ({
        names: { profileId, name, aliases: [] as string[] },
        identity: { adopterId: profileId, name, aliases: [], shared, relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token' as const },
    });
    const facts = (name: string): PersonFacts => ({ name, aliases: [], phones: [], emails: [], socials: [], documentIds: [] });
    const decide = (name: string, cs: Array<ReturnType<typeof cand>>) =>
        decideExactOutcome(name, cs.map(c => c.names), new Map(cs.map(c => [c.names.profileId, judgeIdentity(facts(name), c.identity).verdict])));
    const dni = (value: string, namesHolding = 1): SharedIdentifier => ({ kind: 'document', value, namesHolding });

    it('a DNI alone is enough: an incompatible name is found, matched as document', () => {
        expect(decide('Majo Pérez', [cand('mj', 'María José Pérez', [dni('30123456')])]))
            .toEqual({ result: 'found', profileId: 'mj', nameMatchedAs: 'document', otherProfileIds: [] });
    });

    it('a DNI on two differently-named profiles, no name fits: two different people → ambiguous, nobody takes it (new profile)', () => {
        const o = decide('Majo Pérez', [cand('a', 'Ana Gómez', [dni('30123456', 2)]), cand('b', 'Juan Ruiz', [dni('30123456', 2)])]);
        expect(o).toEqual({ result: 'ambiguous', reason: 'multiple_profiles', profileIds: ['a', 'b'], compatible: [] });
    });

    it('a DNI on two profiles whose names agree (likely duplicates), no name fits: both eligible → best match', () => {
        const o = decide('Majo Pérez', [cand('a', 'Ana Gómez', [dni('30123456', 1)]), cand('b', 'Ana María Gómez', [dni('30123456', 1)])]);
        expect(o).toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles', profileIds: ['a', 'b'] });
        expect(o.result === 'ambiguous' && o.compatible).toEqual([{ profileId: 'a', as: 'document' }, { profileId: 'b', as: 'document' }]);
    });

    it('a DNI on two profiles, the name fits one: found on it (the DNI-only holder is another match)', () => {
        expect(decide('María Pérez', [
            cand('dniOnly', 'Juan Ruiz', [dni('30123456', 2)]),
            cand('named', 'María Pérez', [dni('30123456', 2)]),
        ])).toEqual({ result: 'found', profileId: 'named', nameMatchedAs: 'profile', otherProfileIds: ['dniOnly'] });
    });

    it('several «same» whose names fit: today\'s multiple_profiles + best match', () => {
        const o = decide('María Pérez', [cand('a', 'María Pérez', [dni('30123456', 1)]), cand('b', 'María José Pérez', [dni('30123456', 1)])]);
        expect(o).toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles', compatible: [{ profileId: 'a', as: 'profile' }, { profileId: 'b', as: 'profile' }] });
    });

    it('a placeholder DNI links nobody: not found', () => {
        const o = decide('Ana Ruiz', [cand('jg', 'Juan Gómez', [dni('00000000')])]);
        expect(o).toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['jg'], compatible: [] });
    });

    it('«Beto Sosa» + an email held by 4 names: the email is junk → not found', () => {
        const email: SharedIdentifier = { kind: 'email', value: 'luis@x.com', namesHolding: 4 };
        const o = decide('Beto Sosa', [
            cand('lu1', 'Beto Sosa', [email]), cand('lu2', 'Carla Díaz', [email]), cand('lu3', 'Darío Vega', [email]), cand('lu4', 'Elsa Ortiz', [email]),
        ]);
        expect(o.result).not.toBe('found');
        expect(o).toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles', compatible: [] });
    });

    it('an incompatible name with a shared phone or social stays name_mismatch (new profile + pair)', () => {
        const social: SharedIdentifier = { kind: 'social', value: 'mariajose.p', namesHolding: 1 };
        expect(decide('Majo Pérez', [cand('mj', 'María José Pérez', [social])]))
            .toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['mj'], compatible: [] });
    });

    it('a compatible name with a shared social is found, matched as profile', () => {
        const social: SharedIdentifier = { kind: 'social', value: 'mariajose.p', namesHolding: 1 };
        expect(decide('María Pérez', [cand('mj', 'María José Pérez', [social])]))
            .toEqual({ result: 'found', profileId: 'mj', nameMatchedAs: 'profile', otherProfileIds: [] });
    });
});
