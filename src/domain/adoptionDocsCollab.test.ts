import { describe, it, expect } from 'vitest';
import {
    planItemSave, changedByOthers, sectionRevisionText, storedSection, mergeSections, mergeHidden,
    sectionAuthor, stepAuthor, stepStates,
} from './adoptionDocsCollab';
import { STANDARD_RICH_DOCS } from './standardContractText';
import type { RichDoc } from './adoptionDocs';

const doc = (text: string): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ text }] }] });

describe('planItemSave', () => {
    const current = { '2': 'r2', '3': 'r3b', '4': 'std' } as const;
    it('writes what is unchanged since load, refuses what someone else changed, skips what already matches', () => {
        const plan = planItemSave({ ...current }, [
            { key: '2', value: 1, newRev: 'r2-new', expectedRev: 'r2' },   // still as loaded → write
            { key: '3', value: 2, newRev: 'r3-mine', expectedRev: 'r3a' }, // they changed it → conflict
            { key: '4', value: 3, newRev: 'std', expectedRev: 'old' },     // already equal → saved, nothing to write
        ]);
        expect(plan).toEqual({ apply: ['2'], conflicts: ['3'], alreadySaved: ['4'] });
    });
    it('one change per item: the first wins', () => {
        expect(planItemSave({ a: 'x' }, [
            { key: 'a', value: 1, newRev: 'y', expectedRev: 'x' },
            { key: 'a', value: 2, newRev: 'z', expectedRev: 'stale' },
        ]).apply).toEqual(['a']);
    });
});

describe('changedByOthers', () => {
    it('items that moved since load, excluding mine and items not loaded (dirty here)', () => {
        const current: Record<string, string> = { '2': 'a2', '3': 'b2', '4': 'c2' };
        expect(changedByOthers<string>({ '2': 'a', '3': 'b' }, current, ['3'])).toEqual(['2']);
    });
});

describe('section revisions', () => {
    it('absent, empty and equal-to-standard are the same revision (null = standard)', () => {
        expect(sectionRevisionText('2', undefined)).toBeNull();
        expect(sectionRevisionText('2', STANDARD_RICH_DOCS['2'])).toBeNull();
        expect(sectionRevisionText('2', doc('   '))).toBeNull();
        expect(sectionRevisionText('2', doc('mío'))).not.toBeNull();
        expect(storedSection('3', STANDARD_RICH_DOCS['3'])).toBeNull();
    });
    it('mergeSections replaces only the applied keys, null resets to standard', () => {
        const merged = mergeSections({ '2': doc('a'), '3': doc('b') }, [{ key: '3', doc: null }, { key: '4', doc: doc('c') }]);
        expect(Object.keys(merged).sort()).toEqual(['2', '4']);
    });
    it('mergeHidden changes only the applied toggles, in form order', () => {
        const all = Object.keys(stepStates([]));
        expect(mergeHidden([all[2]], [{ key: all[0], hidden: true }, { key: all[2], hidden: false }])).toEqual([all[0]]);
    });
});

describe('attribution', () => {
    it('sectionAuthor: whoever introduced the current text, walking back while it is unchanged', () => {
        const history = [
            { sections: { '2': doc('B'), '3': doc('x') }, by: 'carla' },  // newest: changed 3
            { sections: { '2': doc('B') }, by: 'beto' },                   // introduced 2 = B
            { sections: { '2': doc('A') }, by: 'ana' },
        ];
        expect(sectionAuthor('2', history)).toBe('beto');
        expect(sectionAuthor('3', history)).toBe('carla');
        expect(sectionAuthor('4', history)).toBe('ana'); // standard all along → oldest known
        expect(sectionAuthor('2', [])).toBeNull();
    });
    it('stepAuthor: the latest save that set it to its current state', () => {
        const rows = [
            { by: 'beto', changedSteps: [{ id: 'q1', hidden: true }] },
            { by: 'ana', changedSteps: [{ id: 'q1', hidden: false }, { id: 'q2', hidden: true }] },
        ];
        expect(stepAuthor('q1', 'hidden', rows)).toBe('beto');
        expect(stepAuthor('q2', 'hidden', rows)).toBe('ana');
        expect(stepAuthor('q1', 'shown', rows)).toBeNull(); // latest record disagrees with the state → unknown
        expect(stepAuthor('q3', 'shown', rows)).toBeNull();
    });
});

describe('the phone option rides the per-question saves', () => {
    it('mergeHidden never drops the phone option', () => {
        expect(mergeHidden(['phone-optional'], [{ key: 'intent', hidden: true }])).toEqual(['intent', 'phone-optional']);
        expect(mergeHidden(['intent'], [{ key: 'phone-optional', hidden: true }])).toEqual(['intent', 'phone-optional']);
    });
    it('has a state of its own, so a teammate\'s change to it is a conflict like any question', () => {
        expect(stepStates(['phone-optional'])['phone-optional']).toBe('hidden');
        expect(stepStates([])['phone-optional']).toBe('shown');
    });
});
