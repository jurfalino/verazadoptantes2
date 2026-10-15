import { describe, it, expect } from 'vitest';
import { computeRequestRescueDensity, groupRescues, knownRescuer } from './requestDensity';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 12));
const req = (n: number, addedBy: string | null, rescueKey?: string) => ({ recordType: 'adoption_request', date: day(n), addedBy, rescueKey });

describe('computeRequestRescueDensity', () => {
    it('five forms to the same rescue count once', () => {
        const r = computeRequestRescueDensity([1, 2, 3, 4, 5].map(n => req(n, 'shelter@example.com')), 30);
        expect(r.count).toBe(1);
    });

    it('three different rescues inside the window count three', () => {
        const r = computeRequestRescueDensity([req(1, 'a@x.com'), req(5, 'b@x.com'), req(9, 'c@x.com'), req(10, 'a@x.com')], 30);
        expect(r.count).toBe(3);
        expect(r.startDate?.getTime()).toBe(day(1).getTime());
    });

    it('members of one organization (rescueKey) count as one rescue', () => {
        const r = computeRequestRescueDensity([req(1, 'a@x.com', 'org:1'), req(2, 'b@x.com', 'org:1'), req(3, 'c@x.com')], 30);
        expect(r.count).toBe(2);
    });

    it('records with an unknown rescuer each count on their own', () => {
        const r = computeRequestRescueDensity([req(1, null), req(2, 'anonymous'), req(3, '')], 30);
        expect(r.count).toBe(3);
    });

    it('a tie reports the tightest window', () => {
        const r = computeRequestRescueDensity([req(0, 'a@x.com'), req(1, 'b@x.com'), req(2, 'c@x.com'), req(29, 'a@x.com')], 30);
        expect(r.count).toBe(3);
        expect(r.timeSpanDays).toBe(2);
    });

    it('rescues outside the window do not add up', () => {
        const r = computeRequestRescueDensity([req(0, 'a@x.com'), req(40, 'b@x.com'), req(80, 'c@x.com')], 30);
        expect(r.count).toBe(1);
    });

    it('an infinite period counts every distinct rescue', () => {
        const r = computeRequestRescueDensity([req(0, 'a@x.com'), req(400, 'b@x.com'), req(800, 'a@x.com')], Infinity);
        expect(r.count).toBe(2);
    });

    it('ignores other record types and undated records', () => {
        const r = computeRequestRescueDensity([
            { recordType: 'adoption', date: day(1), addedBy: 'a@x.com' },
            { recordType: 'adoption_request', date: null, addedBy: 'b@x.com' },
        ], 30);
        expect(r).toEqual({ count: 0, timeSpanDays: 0, startDate: null, endDate: null });
    });

    it('reads epoch-second dates like the rest of the app', () => {
        const secs = Math.floor(day(1).getTime() / 1000);
        const r = computeRequestRescueDensity([{ recordType: 'adoption_request', date: secs, addedBy: 'a@x.com' }, { recordType: 'adoption_request', date: secs + 86400, addedBy: 'b@x.com' }], 30);
        expect(r.count).toBe(2);
    });
});

describe('groupRescues', () => {
    it('rescuers sharing an organization get one key; others keep their own', () => {
        const g = groupRescues(new Map([['A@x.com', ['o1']], ['b@x.com', ['o1']], ['c@x.com', []]]));
        expect(g.get('a@x.com')).toBe(g.get('b@x.com'));
        expect(g.get('c@x.com')).not.toBe(g.get('a@x.com'));
    });

    it('someone in two organizations joins both teams into one rescue', () => {
        const g = groupRescues(new Map([['a@x.com', ['o1']], ['b@x.com', ['o1', 'o2']], ['c@x.com', ['o2']]]));
        expect(new Set([g.get('a@x.com'), g.get('b@x.com'), g.get('c@x.com')]).size).toBe(1);
    });
});

describe('groupRescues: admins never link organizations', () => {
    it('an admin in two organizations does not merge them, and is a rescue of its own', () => {
        const orgs = new Map([['admin@x.com', ['o1', 'o2']], ['a@x.com', ['o1']], ['b@x.com', ['o2']]]);
        const g = groupRescues(orgs, new Set(['admin@x.com']));
        expect(g.get('a@x.com')).not.toBe(g.get('b@x.com'));
        expect(g.get('admin@x.com')).not.toBe(g.get('a@x.com'));
        expect(g.get('admin@x.com')).not.toBe(g.get('b@x.com'));
        // Without the exclusion the admin chains them together.
        const merged = groupRescues(orgs);
        expect(merged.get('a@x.com')).toBe(merged.get('b@x.com'));
    });
});

describe('knownRescuer', () => {
    it('only a real email is a known rescuer', () => {
        expect(knownRescuer(' A@X.com ')).toBe('a@x.com');
        expect(knownRescuer('anonymous')).toBeNull();
        expect(knownRescuer(null)).toBeNull();
        expect(knownRescuer('api:Jotform')).toBeNull();
    });
});
