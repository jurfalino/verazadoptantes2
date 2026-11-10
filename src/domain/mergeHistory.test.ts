import { describe, it, expect } from 'vitest';
import { mergeRowsNewestFirst } from './mergeHistory';

const merged = (id: string, at: number, fromId: string, auditId?: string) => ({
    id, changedAt: new Date(at), changes: JSON.stringify({ profiles_merged: { fromId, fromName: 'X', fromAddedBy: null, ...(auditId ? { auditId } : {}) } }),
});

describe('mergeRowsNewestFirst (H2)', () => {
    it('the «Perfiles unidos» rows, newest first by changedAt, whatever order they come in', () => {
        const rows = [merged('h1', 1000, 'a', 'au1'), merged('h3', 3000, 'c'), merged('h2', 2000, 'b', 'au2')];
        expect(mergeRowsNewestFirst(rows)).toEqual([
            { historyId: 'h3', fromId: 'c', auditId: null },
            { historyId: 'h2', fromId: 'b', auditId: 'au2' },
            { historyId: 'h1', fromId: 'a', auditId: 'au1' },
        ]);
    });

    it('a row written before auditId was stored carries null (the loader looks it up)', () => {
        expect(mergeRowsNewestFirst([merged('h1', 1000, 'a')])).toEqual([{ historyId: 'h1', fromId: 'a', auditId: null }]);
    });

    it('other rows, malformed JSON and a merge row without fromId are ignored', () => {
        const rows = [
            { id: 'x1', changedAt: 5000, changes: JSON.stringify({ name_changed: { from: 'a', to: 'b' } }) },
            { id: 'x2', changedAt: 6000, changes: '{not json' },
            { id: 'x3', changedAt: 7000, changes: JSON.stringify({ profiles_merged: { fromName: 'no id' } }) },
            { id: 'x4', changedAt: 8000, changes: null },
            { id: 'x5', changedAt: 9000, changes: JSON.stringify({ profiles_unmerged: { otherId: 'a' } }) },
            merged('h1', 1000, 'a', 'au1'),
        ];
        expect(mergeRowsNewestFirst(rows)).toEqual([{ historyId: 'h1', fromId: 'a', auditId: 'au1' }]);
    });

    it('a non-string or empty auditId reads as missing', () => {
        const row = { id: 'h1', changedAt: 1, changes: JSON.stringify({ profiles_merged: { fromId: 'a', auditId: 42 } }) };
        const empty = { id: 'h2', changedAt: 2, changes: JSON.stringify({ profiles_merged: { fromId: 'b', auditId: '' } }) };
        expect(mergeRowsNewestFirst([row, empty])).toEqual([
            { historyId: 'h2', fromId: 'b', auditId: null },
            { historyId: 'h1', fromId: 'a', auditId: null },
        ]);
    });

    it('accepts changedAt as epoch seconds, ms, or an ISO string', () => {
        const rows = [
            { id: 's', changedAt: 2_000_000_000, changes: merged('s', 0, 's').changes },  // seconds → 2033
            { id: 'ms', changedAt: 1_000_000_000_000, changes: merged('ms', 0, 'ms').changes }, // ms → 2001
            { id: 'iso', changedAt: '2020-01-01T00:00:00Z', changes: merged('iso', 0, 'iso').changes },
        ];
        expect(mergeRowsNewestFirst(rows).map(r => r.historyId)).toEqual(['s', 'iso', 'ms']);
    });
});
