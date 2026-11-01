import { describe, it, expect } from 'vitest';
import { NO_DISMISSED, decideDupHintAction, dismissDupHintMatch, dupHintMergePlan, dupHintPairMatches, dupHintSearchInput, entryMatchesTyped, typedIsNewFor, visibleDupHintMatches, type DupHintFacts } from './dupHint';
import { decideDedupAction, mergeOwnersToTell } from './dedupPair';
import { ratingAfterMerge } from './ratings';

describe('dupHintSearchInput — what the engine is asked for one typed identifier', () => {
    it('one list per strong type (emails and socials lower-cased, ids as identity numbers)', () => {
        expect(dupHintSearchInput('phone', ' 11 4444-0303 ')).toEqual({ phones: ['11 4444-0303'] });
        expect(dupHintSearchInput('email', 'Ana@Mail.COM')).toEqual({ emails: ['ana@mail.com'] });
        expect(dupHintSearchInput('social', '@AnaP')).toEqual({ socials: ['@anap'] });
        expect(dupHintSearchInput('id', '30.111.222')).toEqual({ ids: ['30.111.222'] });
    });
    it('nothing for other types, empty values or non-strings', () => {
        expect(dupHintSearchInput('address', 'Belgrano 123')).toBeNull();
        expect(dupHintSearchInput('alias', 'Anita')).toBeNull();
        expect(dupHintSearchInput('phone', '   ')).toBeNull();
        expect(dupHintSearchInput('phone', 42)).toBeNull();
    });
    it('caps the value', () => {
        const out = dupHintSearchInput('email', `${'a'.repeat(500)}@x.com`) as { emails: string[] };
        expect(out.emails[0].length).toBe(200);
    });
});

describe('entryMatchesTyped — which stored contact is the one typed', () => {
    it('phones by their last 8 digits, any format', () => {
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6585-1333' }, 'phone', '6585 1333')).toBe(true);
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6585-1334' }, 'phone', '6585 1333')).toBe(false);
        expect(entryMatchesTyped({ type: 'phone', value: '123' }, 'phone', '123')).toBe(false);
    });
    it('emails case-insensitively; handles and ids normalized', () => {
        expect(entryMatchesTyped({ type: 'email', value: 'Ana@Mail.com ' }, 'email', 'ana@mail.com')).toBe(true);
        expect(entryMatchesTyped({ type: 'social', value: 'https://instagram.com/ana.perez' }, 'social', '@Ana.Perez')).toBe(true);
        expect(entryMatchesTyped({ type: 'id', value: '30.111.222' }, 'id', '30111222')).toBe(true);
    });
    it('never across types', () => {
        expect(entryMatchesTyped({ type: 'email', value: '30111222' }, 'id', '30111222')).toBe(false);
    });
    it('phones as the matcher keys them: «+54 9 11 6312-0851» and «11 6312-0851» are one phone (fix round 1)', () => {
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6312-0851' }, 'phone', '11 6312-0851')).toBe(true);
        expect(entryMatchesTyped({ type: 'phone', value: '11 6312-0851' }, 'phone', '+54 9 11 6312-0851')).toBe(true);
        expect(entryMatchesTyped({ type: 'phone', value: '+54 9 11 6312-0851' }, 'phone', '11 6312-0852')).toBe(false);
    });
});

describe('typedIsNewFor — does «Continuar» still add the typed value?', () => {
    const match = [{ type: 'phone', value: '+54 9 11 6312-0851' }, { type: 'email', value: 'Ana@Mail.com' }];
    it('not when the match already has it as the matcher compares it (country / area prefixes, case)', () => {
        expect(typedIsNewFor(match, 'phone', '11 6312-0851')).toBe(false);
        expect(typedIsNewFor(match, 'phone', '6312 0851')).toBe(false);
        expect(typedIsNewFor(match, 'email', 'ana@mail.com')).toBe(false);
    });
    it('yes for a value the match does not carry; never for a blank one', () => {
        expect(typedIsNewFor(match, 'phone', '11 6312-0999')).toBe(true);
        expect(typedIsNewFor(match, 'email', 'otra@mail.com')).toBe(true);
        expect(typedIsNewFor(match, 'phone', '  ')).toBe(false);
    });
});

describe('dupHintPairMatches — «Continuar» only joins two profiles that really match (EM review I1)', () => {
    const match = [{ type: 'phone', value: '+54 9 11 6312-0851' }, { type: 'email', value: 'Ana@Mail.com' }];
    it('the typed value is one of the match\'s contacts, as the hint\'s «coincide» reads it', () => {
        expect(dupHintPairMatches([], match, { type: 'phone', value: '11 6312-0851' })).toBe(true);
        expect(dupHintPairMatches([], match, { type: 'email', value: 'ana@mail.com' })).toBe(true);
    });
    it('or the two profiles already share a phone, email, handle or id', () => {
        expect(dupHintPairMatches([{ type: 'email', value: 'ANA@mail.com' }], match)).toBe(true);
        expect(dupHintPairMatches([{ type: 'phone', value: '6312 0851' }], match)).toBe(true);
        expect(dupHintPairMatches([{ type: 'id', value: '30.123.456' }], [{ type: 'id', value: '30123456' }])).toBe(true);
    });
    it('nothing in common: no', () => {
        expect(dupHintPairMatches([{ type: 'phone', value: '555-1234' }, { type: 'email', value: 'maria@example.com' }], match)).toBe(false);
        expect(dupHintPairMatches([], match, { type: 'phone', value: '11 6312-0999' })).toBe(false);
        expect(dupHintPairMatches([], match)).toBe(false);
    });
    it('a shared address, note, alias name or a «phone» with no digits is not evidence', () => {
        const soft = [
            { type: 'address', value: 'Av. Siempreviva 742' }, { type: 'note', value: 'llamar tarde' },
            { type: 'alias', value: 'Ana' }, { type: 'phone', value: 'ver notas' },
        ];
        expect(dupHintPairMatches(soft, soft)).toBe(false);
    });
    it('a typed value of another kind, too short to be a phone, or blank: not evidence', () => {
        expect(dupHintPairMatches([], match, { type: 'address', value: 'Av. Siempreviva 742' })).toBe(false);
        expect(dupHintPairMatches([], [{ type: 'phone', value: '123' }], { type: 'phone', value: '123' })).toBe(false);
        expect(dupHintPairMatches([], match, { type: 'email', value: '  ' })).toBe(false);
    });
});

describe('«No es esta persona» — hidden while the typed value stays the same', () => {
    const matches = [{ adopterId: 'a' }, { adopterId: 'b' }];

    it('hides the answered match, keeps the other', () => {
        const d = dismissDupHintMatch(NO_DISMISSED, '6585-1333', 'a');
        expect(visibleDupHintMatches(matches, d, '6585-1333').map(m => m.adopterId)).toEqual(['b']);
        // Surrounding spaces are the same value.
        expect(visibleDupHintMatches(matches, d, ' 6585-1333 ').map(m => m.adopterId)).toEqual(['b']);
    });
    it('a different value shows it again, and answering there starts over', () => {
        const d = dismissDupHintMatch(NO_DISMISSED, '6585-1333', 'a');
        expect(visibleDupHintMatches(matches, d, '6585-1334').map(m => m.adopterId)).toEqual(['a', 'b']);
        const d2 = dismissDupHintMatch(d, '6585-1334', 'b');
        expect(d2).toEqual({ value: '6585-1334', ids: ['b'] });
    });
    it('both answered → nothing left; answering twice adds nothing', () => {
        const d = dismissDupHintMatch(dismissDupHintMatch(NO_DISMISSED, 'x@y.com', 'a'), 'x@y.com', 'b');
        expect(visibleDupHintMatches(matches, d, 'x@y.com')).toEqual([]);
        expect(dismissDupHintMatch(d, 'x@y.com', 'a').ids).toEqual(['a', 'b']);
    });
});


describe('decideDupHintAction — what the «Ver perfil» window offers (Jon 2026-10-29)', () => {
    const base: DupHintFacts = { isAdmin: false, currentTeamOwned: true, matchTeamOwned: false, matchHasOwner: true, declinedForTeam: false, adminRuledSeparate: false, pending: false, settledSeparate: false };
    const with_ = (over: Partial<DupHintFacts>) => decideDupHintAction({ ...base, ...over });

    it('case 1: the viewer or their team loaded the profile being edited → continue', () => {
        expect(with_({})).toBe('continue');
    });
    it('case 2: someone else loaded it → flag (also when the viewer loaded the match)', () => {
        expect(with_({ currentTeamOwned: false })).toBe('flag');
    });
    it('case 3: the match has no real owner → flag, even when the profile being edited is the viewer\'s (D42)', () => {
        expect(with_({ matchHasOwner: false })).toBe('flag');
        expect(with_({ matchHasOwner: false, currentTeamOwned: false })).toBe('flag');
    });
    it('case 4: they already said no — the other owner declined, or an admin ruled them separate → review_admins', () => {
        expect(with_({ declinedForTeam: true })).toBe('review_admins');
        expect(with_({ adminRuledSeparate: true })).toBe('review_admins');
        // Mine is the match (someone else's profile being edited): mine is one of the two — I may ask.
        expect(with_({ adminRuledSeparate: true, currentTeamOwned: false, matchTeamOwned: true })).toBe('review_admins');
    });
    it('case 4 needs a profile of mine (review F1): a stranger on a said-no pair falls through to pending / flag', () => {
        expect(with_({ adminRuledSeparate: true, currentTeamOwned: false, matchTeamOwned: false })).toBe('flag');
        expect(with_({ declinedForTeam: true, currentTeamOwned: false, matchTeamOwned: false, pending: true })).toBe('pending');
    });
    it('case 5: already up for review → pending', () => {
        expect(with_({ pending: true })).toBe('pending');
        expect(with_({ pending: true, currentTeamOwned: false })).toBe('pending');
    });
    it('priority: said no > pending > ownerless > 1 / 2', () => {
        expect(with_({ declinedForTeam: true, pending: true, matchHasOwner: false })).toBe('review_admins');
        expect(with_({ pending: true, matchHasOwner: false })).toBe('pending');
        expect(with_({ matchHasOwner: false, currentTeamOwned: true })).toBe('flag');
    });
    it('already recorded as two people (a shared home, «Mantener separados», «Viven juntos»): settled — before everything, for admins too (F3)', () => {
        for (const over of [{}, { declinedForTeam: true }, { pending: true }, { matchHasOwner: false }, { currentTeamOwned: false }, { isAdmin: true }]) {
            expect(with_({ settledSeparate: true, ...over })).toBe('settled');
        }
    });
    it('admins choose freely (D24): continue, whatever was said, pending or owned', () => {
        for (const over of [{}, { currentTeamOwned: false }, { matchHasOwner: false }, { declinedForTeam: true }, { adminRuledSeparate: true }, { pending: true }]) {
            expect(with_({ isAdmin: true, ...over })).toBe('continue');
        }
    });
});

describe('dupHintMergePlan — who «Sí, continuar» tells', () => {
    const ME = 'me@example.com', MATE = 'mate@example.com', OTHER = 'Other@Example.com', ADMIN = 'admin@example.com';

    it('my profile into someone else\'s: they hear it (the rescuer notice), normalized', () => {
        expect(dupHintMergePlan({ actor: ME, isAdmin: false, currentTeamOwned: true, matchTeamOwned: false, currentAddedBy: ME, matchAddedBy: OTHER }))
            .toEqual({ viaAdmin: false, notifyOwner: OTHER, told: ['other@example.com'] });
    });
    it('both the team\'s: nobody is told', () => {
        expect(dupHintMergePlan({ actor: ME, isAdmin: false, currentTeamOwned: true, matchTeamOwned: true, currentAddedBy: MATE, matchAddedBy: ME }))
            .toEqual({ viaAdmin: false, notifyOwner: null, told: [] });
    });
    it('an admin merging two other owners\' profiles: both hear it (notifyMergeOwners), never the admin', () => {
        expect(dupHintMergePlan({ actor: ADMIN, isAdmin: true, currentTeamOwned: false, matchTeamOwned: false, currentAddedBy: 'gatitos@example.com', matchAddedBy: OTHER }))
            .toEqual({ viaAdmin: true, notifyOwner: null, told: ['other@example.com', 'gatitos@example.com'] });
        // An ownerless match: only the other owner.
        expect(dupHintMergePlan({ actor: ADMIN, isAdmin: true, currentTeamOwned: false, matchTeamOwned: false, currentAddedBy: 'gatitos@example.com', matchAddedBy: 'anonymous' }).told)
            .toEqual(['gatitos@example.com']);
    });
    it('an admin whose own profile folds into someone else\'s: the rescuer path, one person told (singular)', () => {
        expect(dupHintMergePlan({ actor: ADMIN, isAdmin: true, currentTeamOwned: true, matchTeamOwned: false, currentAddedBy: ADMIN, matchAddedBy: OTHER }))
            .toEqual({ viaAdmin: false, notifyOwner: OTHER, told: ['other@example.com'] });
    });
    it('agrees with decideDedupAction (keep = the match) when the viewer created the profile being edited', () => {
        const side = (id: string, addedBy: string, teamOwned: boolean) => ({ id, addedBy, createdAt: 1, deleted: false, teamOwned });
        for (const [matchBy, matchTeam] of [[OTHER, false], [MATE, true], [ME, true]] as const) {
            const d = decideDedupAction(ME, side('cur', ME, true), side('match', matchBy, matchTeam), 'detected', 'match');
            const plan = dupHintMergePlan({ actor: ME, isAdmin: false, currentTeamOwned: true, matchTeamOwned: matchTeam, currentAddedBy: ME, matchAddedBy: matchBy });
            expect(d.kind).toBe('merge');
            expect(plan.notifyOwner).toBe(d.kind === 'merge' ? d.notifyOwner : 'x');
        }
    });
});

describe('mergeOwnersToTell — the one rule for who an admin\'s merge tells', () => {
    it('real owners only, normalized, once each, never the actor or someone skipped', () => {
        expect(mergeOwnersToTell('A@x.com', 'a@x.com', 'admin@x.com')).toEqual(['a@x.com']);
        expect(mergeOwnersToTell('a@x.com', 'b@x.com', 'A@X.com')).toEqual(['b@x.com']);
        expect(mergeOwnersToTell('anonymous', null, 'admin@x.com')).toEqual([]);
        expect(mergeOwnersToTell('a@x.com', 'b@x.com', 'admin@x.com', ['B@x.com'])).toEqual(['a@x.com']);
    });
});

describe('ratingAfterMerge — the rating the profile that stays will have', () => {
    it('both profiles\' records together, as the average is computed — never the average of the averages', () => {
        // 4 and 4 here, one 1 there: (4+4+1)/3 = 3, not (4+1)/2 = 2.5.
        expect(ratingAfterMerge([{ rating: 4 }, { rating: 4 }], [{ rating: 1 }])).toBe(3);
        // Unrated records (null, 0) don't count.
        expect(ratingAfterMerge([{ rating: 4 }, { rating: 0 }], [{ rating: null }])).toBe(4);
        // Nothing rated on either side: unrated.
        expect(ratingAfterMerge([], [{ rating: null }])).toBeNull();
        expect(ratingAfterMerge([], [{ rating: 2 }])).toBe(2);
    });
});
