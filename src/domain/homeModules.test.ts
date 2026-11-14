import { describe, it, expect } from 'vitest';
import { orderHomeModules, HOME_CARD_SLOTS, homeAnimalRows, homePendingRows, homeAdopterSlots, isPostRecord, postsCardLive, recentWithoutRequests } from './homeModules';

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

describe('HOME_CARD_SLOTS', () => {
    it('4 slots per card', () => expect(HOME_CARD_SLOTS).toBe(4));
});

describe('homeAnimalRows — 4 slots; the «N más» amber row takes one', () => {
    const a = (id: string) => ({ id });
    const none = { offers: [], due: [], applications: [] };
    const ids = (r: { due: { id: string }[]; recent: { id: string }[]; moreDue: number }) =>
        ({ due: r.due.map(x => x.id), recent: r.recent.map(x => x.id), moreDue: r.moreDue });

    it('the existing homeAnimalRows expectations hold with empty offers/applications', () => {
        // nothing due: the 4 most recently updated
        expect(ids(homeAnimalRows(none, [a('r1'), a('r2'), a('r3'), a('r4'), a('r5')])))
            .toEqual({ due: [], recent: ['r1', 'r2', 'r3', 'r4'], moreDue: 0 });
        // fewer animals than rows: all of them, once
        expect(ids(homeAnimalRows(none, [a('r1'), a('r1'), a('r2')])))
            .toEqual({ due: [], recent: ['r1', 'r2'], moreDue: 0 });
    });

    it('one due: it first, then the 3 most recently updated, never the due one twice', () => {
        expect(ids(homeAnimalRows({ ...none, due: [a('luna')] }, [a('luna'), a('r1'), a('r2'), a('r3'), a('r4')])))
            .toEqual({ due: ['luna'], recent: ['r1', 'r2', 'r3'], moreDue: 0 });
    });

    it('exactly 4 due: all 4 listed, no «más» row', () => {
        const due = Array.from({ length: 4 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows({ ...none, due }, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2', 'd3'], recent: [], moreDue: 0 });
    });

    it('five due: the 3 most overdue + «2 animales más» (the amber row takes the 4th slot)', () => {
        const due = Array.from({ length: 5 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows({ ...none, due }, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2'], recent: [], moreDue: 2 });
    });

    it('ten due: the 3 most overdue + «7 animales más»', () => {
        const due = Array.from({ length: 10 }, (_, i) => a(`d${i}`));
        expect(ids(homeAnimalRows({ ...none, due }, [a('r1')])))
            .toEqual({ due: ['d0', 'd1', 'd2'], recent: [], moreDue: 7 });
    });
});

describe('homeAnimalRows — offers, due animals and applications share the 4 slots', () => {
    const a = (id: string) => ({ id });
    const all = (r: ReturnType<typeof homeAnimalRows>) => ({
        offers: r.offers.map(x => x.id), due: r.due.map(x => x.id), applications: r.applications.map(x => x.id),
        recent: r.recent.map(x => x.id), moreDue: r.moreDue, moreApplications: r.moreApplications,
    });

    it('applications take slots like due animals; an animal with both shows as due', () => {
        expect(all(homeAnimalRows({ offers: [], due: [a('luna')], applications: [a('general'), a('luna'), a('sol')] }, [a('luna'), a('r1'), a('r2')])))
            .toEqual({ offers: [], due: ['luna'], applications: ['general', 'sol'], recent: ['r1'], moreDue: 0, moreApplications: 0 });
    });

    it('5 due + 2 applications in 4 slots → 2 due listed, moreDue 3, moreApplications 2 (two «more» rows)', () => {
        const due = Array.from({ length: 5 }, (_, i) => a(`d${i}`));
        expect(all(homeAnimalRows({ offers: [], due, applications: [a('x1'), a('x2')] }, [a('r1')])))
            .toEqual({ offers: [], due: ['d0', 'd1'], applications: [], recent: [], moreDue: 3, moreApplications: 2 });
    });

    it('only applications hidden: one «more» row, 3 listed', () => {
        const applications = Array.from({ length: 6 }, (_, i) => a(`x${i}`));
        expect(all(homeAnimalRows({ offers: [], due: [a('d0')], applications }, [])))
            .toEqual({ offers: [], due: ['d0'], applications: ['x0', 'x1'], recent: [], moreDue: 0, moreApplications: 4 });
    });

    it('offers come first and are never counted as «more»', () => {
        const offers = [a('o1'), a('o2')];
        const due = Array.from({ length: 3 }, (_, i) => a(`d${i}`));
        expect(all(homeAnimalRows({ offers, due, applications: [a('x1')] }, [a('r1')])))
            .toEqual({ offers: ['o1', 'o2'], due: [], applications: [], recent: [], moreDue: 3, moreApplications: 1 });
        // A hidden offer waits for a free slot: it is not a «more» row.
        const many = Array.from({ length: 5 }, (_, i) => a(`o${i}`));
        expect(all(homeAnimalRows({ offers: many, due: [], applications: [] }, [a('r1')])))
            .toEqual({ offers: ['o0', 'o1', 'o2'], due: [], applications: [], recent: [], moreDue: 0, moreApplications: 0 });
    });

    it('an id in both due and applications that ends up hidden is counted in both «more» rows', () => {
        // d4 also has applications: hidden, it is one of the 3 due AND one of the 2 with applications the tab lists.
        const due = Array.from({ length: 5 }, (_, i) => a(`d${i}`));
        expect(all(homeAnimalRows({ offers: [], due, applications: [a('d4'), a('x1')] }, [])))
            .toEqual({ offers: [], due: ['d0', 'd1'], applications: [], recent: [], moreDue: 3, moreApplications: 2 });
    });

    it('a hidden offer that is also due counts in «más con controles» (the due tab lists it)', () => {
        const offers = Array.from({ length: 5 }, (_, i) => a(`o${i}`));
        expect(all(homeAnimalRows({ offers, due: [a('o4')], applications: [] }, [])))
            .toEqual({ offers: ['o0', 'o1', 'o2'], due: [], applications: [], recent: [], moreDue: 1, moreApplications: 0 });
    });

    it('the reservation uses the same membership: a hidden due item that also has applications needs both «more» rows', () => {
        // Only due items are hidden after dedup, but d3 also has applications → two «more» rows, 2 listed.
        const due = Array.from({ length: 4 }, (_, i) => a(`d${i}`));
        expect(all(homeAnimalRows({ offers: [a('o0')], due, applications: [a('d3')] }, [])))
            .toEqual({ offers: ['o0'], due: ['d0'], applications: [], recent: [], moreDue: 3, moreApplications: 1 });
    });

    it('an offer that is also due is listed once, as the offer', () => {
        expect(all(homeAnimalRows({ offers: [a('luna')], due: [a('luna'), a('d1')], applications: [] }, [a('luna'), a('r1')])))
            .toEqual({ offers: ['luna'], due: ['d1'], applications: [], recent: ['r1'], moreDue: 0, moreApplications: 0 });
    });
});

describe('homePendingRows — like the due animals: one row each, «N más» takes the 4th slot', () => {
    const p = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    it('none', () => expect(homePendingRows([], 0)).toEqual({ shown: [], more: 0 }));
    it('1 of 1: listed, nothing more', () => expect(homePendingRows(p(1), 1)).toEqual({ shown: ['p0'], more: 0 }));
    it('exactly 4: all 4, no «más» row', () => expect(homePendingRows(p(4), 4)).toEqual({ shown: p(4), more: 0 }));
    it('65 waiting (4 fetched): 3 rows + «62 más»', () => expect(homePendingRows(p(4), 65)).toEqual({ shown: p(3), more: 62 }));
    it('a row the feed could not build still counts in «más»', () => expect(homePendingRows(p(1), 2)).toEqual({ shown: ['p0'], more: 1 }));
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

describe('homeAdopterSlots — general forms first, then «¿Es la misma persona?», one «N más» row (Jon 2026-11-13)', () => {
    it('everything fits: all shown, no «más»', () => {
        expect(homeAdopterSlots(2, 1)).toEqual({ requests: 2, pending: 1, more: 0 });
        expect(homeAdopterSlots(0, 4)).toEqual({ requests: 0, pending: 4, more: 0 });
        expect(homeAdopterSlots(4, 0)).toEqual({ requests: 4, pending: 0, more: 0 });
    });
    it('too many: the 4th slot is one «N más esperan tu respuesta» row, requests take the others first', () => {
        expect(homeAdopterSlots(5, 2)).toEqual({ requests: 3, pending: 0, more: 4 });
        expect(homeAdopterSlots(2, 3)).toEqual({ requests: 2, pending: 1, more: 2 });
        expect(homeAdopterSlots(0, 6)).toEqual({ requests: 0, pending: 3, more: 3 });
    });
    it('the slot count is a parameter', () => expect(homeAdopterSlots(3, 0, 2)).toEqual({ requests: 1, pending: 0, more: 2 }));
});

describe('recentWithoutRequests — one person, one row on the home card (UX review S1)', () => {
    it('drops the recent row of someone already listed as a request, and fills from the next ones', () => {
        const recent = [{ id: 'ana' }, { id: 'beto' }, { id: 'cami' }, { id: 'dani' }, { id: 'eli' }];
        expect(recentWithoutRequests(recent, [{ adopterId: 'ana' }, { adopterId: null }], 4).map(r => r.id)).toEqual(['beto', 'cami', 'dani', 'eli']);
        expect(recentWithoutRequests(recent, [], 4).map(r => r.id)).toEqual(['ana', 'beto', 'cami', 'dani']);
    });
});
