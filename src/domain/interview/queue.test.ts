import { describe, it, expect } from 'vitest';
import { buildQueue, nextUpcomingId, MAX_UPCOMING } from './queue';
import { QUESTION_BANK } from './bank';
import type { CandidateSummary, InterviewContext, QuestionDef } from './types';
import { EMPTY_PREP } from './types';

function ctx(over: Partial<InterviewContext> = {}): InterviewContext {
    return { prep: { ...EMPTY_PREP, name: 'Juan Pérez' }, answers: {}, visited: [], custom: [], candidates: [], ...over };
}
const cand = (id: string, over: Partial<CandidateSummary> = {}): CandidateSummary => ({
    adopterId: id, displayName: id, relevancePercent: 60, avgRating: null, adoptionCount: 0, canEdit: false,
    stored: [], visible: {}, ...over,
});
const ids = (q: ReturnType<typeof buildQueue>) => q.map(i => i.id);
const upcoming = (q: ReturnType<typeof buildQueue>) => q.filter(i => i.state === 'upcoming').map(i => i.id);

describe('buildQueue', () => {
    it('starts with rapport, then story, then details, and caps the upcoming list', () => {
        const q = buildQueue(ctx());
        const stages = q.map(i => i.stage);
        expect(stages.indexOf('story')).toBeGreaterThan(stages.lastIndexOf('rapport'));
        expect(stages.indexOf('details')).toBeGreaterThan(stages.lastIndexOf('story'));
        expect(upcoming(q).length).toBeLessThanOrEqual(MAX_UPCOMING);
        expect(q[0].id).toBe('rapport_good_time');
    });

    it('drops questions whose facts the prep already gave', () => {
        const q = buildQueue(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'], address: 'Calle 1' } }));
        expect(ids(q)).not.toContain('rapport_phone');
        expect(ids(q)).not.toContain('story_address');
        expect(ids(q)).not.toContain('rapport_area'); // only asked when the address is unknown
    });

    it('verification-only questions exist only when a candidate holds that fact', () => {
        expect(ids(buildQueue(ctx()))).not.toContain('details_other_phones');
        const q = buildQueue(ctx({ candidates: [cand('a1', { stored: ['phones'] })] }));
        const item = q.find(i => i.id === 'details_other_phones')!;
        expect(item.verify).toEqual({ fact: 'phones', candidateIds: ['a1'] });
        expect(item.added?.reasonKey).toBe('interview.reason.verify');
    });

    it('with unconfirmed candidates, dedup questions lead their stage', () => {
        const q = buildQueue(ctx({ candidates: [cand('a1')] }));
        const rapport = upcoming(q).filter(id => id.startsWith('rapport_'));
        const firstNonDedup = rapport.findIndex(id => !QUESTION_BANK.find(b => b.id === id)!.dedup);
        const lastDedup = rapport.map(id => !!QUESTION_BANK.find(b => b.id === id)!.dedup).lastIndexOf(true);
        expect(lastDedup).toBeLessThan(firstNonDedup);
    });

    it('a confirmed profile verifies only against itself', () => {
        const q = buildQueue(ctx({
            confirmedAdopterId: 'a1',
            candidates: [cand('a1', { stored: ['phones'] }), cand('a2', { stored: ['phones'] })],
        }));
        expect(q.find(i => i.id === 'details_other_phones')!.verify!.candidateIds).toEqual(['a1']);
    });

    it('an ANSWERED verifying question keeps its verification hint (the first keystroke must not drop it)', () => {
        const candidates = [cand('a1', { stored: ['phones'] }), cand('a2', { stored: ['emails'] })];
        const answers = {
            details_other_phones: { status: 'answered' as const, contacts: [{ type: 'phone' as const, value: '11 6585-1333' }] },
            rapport_phone: { status: 'answered' as const, contacts: [{ type: 'phone' as const, value: '11 6585-1444' }] },
        };
        const q = buildQueue(ctx({ candidates, answers, visited: ['details_other_phones', 'rapport_phone'] }));
        const other = q.find(i => i.id === 'details_other_phones')!;
        const phone = q.find(i => i.id === 'rapport_phone')!;
        expect(other.state).toBe('answered');
        expect(other.verify).toEqual({ fact: 'phones', candidateIds: ['a1'] });
        expect(phone.state).toBe('answered');
        expect(phone.verify).toEqual({ fact: 'phones', candidateIds: ['a1'] });
        // Order and `added` semantics of locked items are unchanged.
        expect(q.slice(0, 2).map(i => i.id)).toEqual(['details_other_phones', 'rapport_phone']);
        expect(other.added).toBeUndefined();
        expect(phone.added).toBeUndefined();
    });

    it('an answered verifying question verifies only against the confirmed profile, and carries no hint without a holder', () => {
        const answers = { details_other_phones: { status: 'answered' as const, contacts: [{ type: 'phone' as const, value: '11 6585-1333' }] } };
        const confirmed = buildQueue(ctx({
            confirmedAdopterId: 'a2', answers, visited: ['details_other_phones'],
            candidates: [cand('a1', { stored: ['phones'] }), cand('a2', { stored: ['phones'] })],
        }));
        expect(confirmed.find(i => i.id === 'details_other_phones')!.verify).toEqual({ fact: 'phones', candidateIds: ['a2'] });
        const none = buildQueue(ctx({ answers, visited: ['details_other_phones'], candidates: [cand('a1', { stored: ['emails'] })] }));
        const item = none.find(i => i.id === 'details_other_phones')!;
        expect(item.state).toBe('answered');
        expect(item.verify).toBeUndefined();
    });

    it('follow-ups appear only after a matching answer, marked with their parent', () => {
        expect(ids(buildQueue(ctx()))).not.toContain('details_pet_what_happened');
        const q = buildQueue(ctx({
            answers: { story_pets_past: { status: 'answered', text: 'Tuve un perro que se escapó' } },
            visited: ['story_pets_past'],
        }));
        const item = q.find(i => i.id === 'details_pet_what_happened')!;
        expect(item.added).toEqual({ reasonKey: 'interview.reason.followup', parentId: 'story_pets_past' });
    });

    it('a rented home brings the landlord question; owning does not', () => {
        const rent = buildQueue(ctx({ answers: { story_tenure: { status: 'answered', choice: 'rent' } }, visited: ['story_tenure'] }));
        const own = buildQueue(ctx({ answers: { story_tenure: { status: 'answered', choice: 'own' } }, visited: ['story_tenure'] }));
        expect(ids(rent)).toContain('details_landlord');
        expect(ids(own)).not.toContain('details_landlord');
    });

    it('answered items keep their place, in the order they were answered', () => {
        const q = buildQueue(ctx({
            answers: { story_home: { status: 'answered', text: 'Casa' }, rapport_work: { status: 'skipped' } },
            visited: ['story_home', 'rapport_work'],
        }));
        expect(q.slice(0, 2).map(i => [i.id, i.state])).toEqual([['story_home', 'answered'], ['rapport_work', 'skipped']]);
    });

    it('custom questions lead the upcoming items of their stage until answered', () => {
        const q = buildQueue(ctx({ custom: [{ id: 'custom:1', stage: 'rapport', text: '¿Tenés auto?' }] }));
        expect(upcoming(q)[0]).toBe('custom:1');
        expect(q.find(i => i.id === 'custom:1')!.added?.reasonKey).toBe('interview.reason.custom');
    });

    it('is deterministic for the same input', () => {
        const c = ctx({ candidates: [cand('a1', { stored: ['phones', 'emails'] })] });
        expect(buildQueue(c)).toEqual(buildQueue(c));
    });

    it('never trims rapport questions to make room (later stages give way first)', () => {
        const q = buildQueue(ctx());
        const rapportBank = QUESTION_BANK.filter(b => b.stage === 'rapport' && !b.verifies && !b.followUpOf).map(b => b.id);
        for (const id of rapportBank) expect(ids(q)).toContain(id);
    });

    it('when trimming to the cap, keeps follow-ups and drops the highest-priority-number items first', () => {
        const bank: QuestionDef[] = Array.from({ length: 30 }, (_, i) => ({ id: `q${String(i).padStart(2, '0')}`, stage: 'details', kind: 'text', priority: i, fills: [] }));
        bank.push({ id: 'fu', stage: 'details', kind: 'text', priority: 99, fills: [], followUpOf: { parents: ['q00'], test: () => true } });
        const q = buildQueue(ctx({ answers: { q00: { status: 'answered', text: 'x' } }, visited: ['q00'] }), bank);
        const up = upcoming(q);
        expect(up).toHaveLength(MAX_UPCOMING);
        expect(up).toContain('fu');
        expect(up).not.toContain('q29');
    });
});

describe('nextUpcomingId', () => {
    it('starts at the first upcoming item', () => {
        expect(nextUpcomingId(buildQueue(ctx()))).toBe('rapport_good_time');
    });
    it('Next walks forward through unanswered questions instead of bouncing between two', () => {
        const q = buildQueue(ctx());
        const a = nextUpcomingId(q);
        const b = nextUpcomingId(q, a);
        const c = nextUpcomingId(q, b);
        expect([a, b, c]).toEqual(upcoming(q).slice(0, 3));
    });
    it('after the last upcoming item it wraps to the first one left', () => {
        const q = buildQueue(ctx());
        const up = upcoming(q);
        expect(nextUpcomingId(q, up.at(-1)!)).toBe(up[0]);
    });
    it('after answering, continues from the first unanswered question', () => {
        const q = buildQueue(ctx({ answers: { rapport_good_time: { status: 'answered', choice: 'yes' } }, visited: ['rapport_good_time'] }));
        expect(nextUpcomingId(q, 'rapport_good_time')).toBe(upcoming(q)[0]);
    });
});
