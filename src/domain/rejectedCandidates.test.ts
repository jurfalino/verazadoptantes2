import { describe, it, expect } from 'vitest';
import { keepOffered } from './rejectedCandidates';

describe('keepOffered — a household «No, es otra persona» only counts for a profile the app offered', () => {
    it('keeps the rejected ids the server\'s own check offered', () => {
        expect(keepOffered(['a', 'b'], ['a', 'b', 'c'])).toEqual({ kept: ['a', 'b'], dropped: 0 });
    });
    it('drops an id the check never offered (a forged answer), and counts it', () => {
        expect(keepOffered(['a', 'zzz'], ['a'])).toEqual({ kept: ['a'], dropped: 1 });
    });
    it('dedupes, and ignores non-string junk', () => {
        expect(keepOffered(['a', 'a', 7 as unknown as string], ['a'])).toEqual({ kept: ['a'], dropped: 1 });
    });
    it('nothing rejected → nothing kept', () => {
        expect(keepOffered(undefined, ['a'])).toEqual({ kept: [], dropped: 0 });
    });
});
