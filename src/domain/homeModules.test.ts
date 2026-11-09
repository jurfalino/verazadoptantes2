import { describe, it, expect } from 'vitest';
import { orderHomeModules, homeAdopterRowCount, HOME_CARD_SLOTS, homeAnimalRows, isPostRecord, postsCardLive } from './homeModules';

describe('orderHomeModules', () => {
    it('a brand-new account gets no cards, only «Para empezar» with every step', () => {
        expect(orderHomeModules({ adopters: 'empty', animals: 'empty', posts: 'empty' }))
            .toEqual({ cards: [], steps: ['adopters', 'animals', 'posts'], firstSteps: 'start' });
    });

    it('to-dos first, then content; empties become «También podés» steps', () => {
        expect(orderHomeModules({ adopters: 'content', animals: 'todo', posts: 'empty' }))
            .toEqual({ cards: ['animals', 'adopters'], steps: ['posts'], firstSteps: 'more' });
    });

    it('ties keep Adoptantes > Animales > Posts, so cards never shuffle between visits', () => {
        expect(orderHomeModules({ adopters: 'todo', animals: 'todo', posts: 'content' }).cards)
            .toEqual(['adopters', 'animals', 'posts']);
        expect(orderHomeModules({ adopters: 'content', animals: 'content', posts: 'content' }).cards)
            .toEqual(['adopters', 'animals', 'posts']);
    });

    it('a module that is off is neither a card nor a step', () => {
        expect(orderHomeModules({ adopters: 'content', animals: 'off', posts: 'off' }))
            .toEqual({ cards: ['adopters'], steps: [], firstSteps: 'more' });
    });
});

describe('homeAdopterRowCount — 4 slots; the amber row / import link takes one', () => {
    it('4 people, 3 under an amber row or above the import link', () => {
        expect(HOME_CARD_SLOTS).toBe(4);
        expect(homeAdopterRowCount(false)).toBe(4);
        expect(homeAdopterRowCount(true)).toBe(3);
    });
});

describe('homeAnimalRows — 4 slots; the «N más» amber row takes one', () => {
    const a = (id: string) => ({ id });
    const ids = (r: { due: { id: string }[]; recent: { id: string }[]; moreDue: number }) =>
        ({ due: r.due.map(x => x.id), recent: r.recent.map(x => x.id), moreDue: r.moreDue });

    it('nothing due: the 4 most recently updated', () => {
        expect(ids(homeAnimalRows([], [a('r1'), a('r2'), a('r3'), a('r4'), a('r5')])))
            .toEqual({ due: [], recent: ['r1', 'r2', 'r3', 'r4'], moreDue: 0 });
    });

    it('one due: it first, then the 3 most recently updated, never the due one twice', () => {
        expect(ids(homeAnimalRows([a('luna')], [a('luna'), a('r1'), a('r2'), a('r3'), a('r4')])))
            .toEqual({ due: ['luna'], recent: ['r1', 'r2', 'r3'], moreDue: 0 });
    });

    it('exactly 4 due: all 4 listed, no «más» row', () => {
        const due = Array.from({ length: 4 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows(due, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2', 'd3'], recent: [], moreDue: 0 });
    });

    it('five due: the 3 most overdue + «2 animales más» (the amber row takes the 4th slot)', () => {
        const due = Array.from({ length: 5 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows(due, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2'], recent: [], moreDue: 2 });
    });

    it('ten due: the 3 most overdue + «7 animales más»', () => {
        const due = Array.from({ length: 10 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows(due, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2'], recent: [], moreDue: 7 });
    });

    it('fewer animals than rows: all of them', () => {
        expect(ids(homeAnimalRows([], [a('r1'), a('r1'), a('r2')])))
            .toEqual({ due: [], recent: ['r1', 'r2'], moreDue: 0 });
    });
});

describe('isPostRecord', () => {
    it('an observation that carries a post link', () => {
        expect(isPostRecord({ recordType: 'observation', sourceUrl: 'https://www.facebook.com/share/p/1Ab' })).toBe(true);
        expect(isPostRecord({ recordType: 'observation', sourceUrl: ' http://instagram.com/p/x ' })).toBe(true);
    });

    it('not a form request, an empty link, or another record type', () => {
        expect(isPostRecord({ recordType: 'adoption_request', sourceUrl: 'form:abc' })).toBe(false);
        expect(isPostRecord({ recordType: 'observation', sourceUrl: 'form:abc' })).toBe(false);
        expect(isPostRecord({ recordType: 'observation', sourceUrl: null })).toBe(false);
        expect(isPostRecord({ recordType: 'adoption', sourceUrl: 'https://facebook.com/x' })).toBe(false);
    });
});

describe('postsCardLive', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    it('within the window', () => {
        expect(postsCardLive(now - 3 * day, now, 30)).toBe(true);
        expect(postsCardLive(now - 30 * day, now, 30)).toBe(true);
    });
    it('older, or never', () => {
        expect(postsCardLive(now - 31 * day, now, 30)).toBe(false);
        expect(postsCardLive(null, now, 30)).toBe(false);
    });
});
