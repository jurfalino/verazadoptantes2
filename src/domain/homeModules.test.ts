import { describe, it, expect } from 'vitest';
import { orderHomeModules, homeListLimit, dueRowsShown, isPostRecord, postsCardLive } from './homeModules';

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

describe('homeListLimit', () => {
    it('3 rows, 2 under amber rows', () => {
        expect(homeListLimit(false)).toBe(3);
        expect(homeListLimit(true)).toBe(2);
    });
});

describe('dueRowsShown', () => {
    it('one or two animals: one row each', () => {
        expect(dueRowsShown(['a'])).toEqual({ rows: ['a'], moreCount: 0 });
        expect(dueRowsShown(['a', 'b'])).toEqual({ rows: ['a', 'b'], moreCount: 0 });
    });

    it('five animals: the most overdue + «4 animales más»', () => {
        expect(dueRowsShown(['a', 'b', 'c', 'd', 'e'])).toEqual({ rows: ['a'], moreCount: 4 });
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
