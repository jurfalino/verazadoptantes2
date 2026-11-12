import { describe, it, expect } from 'vitest';
import { pairBlocksGiving, blockingPairCount } from './samePersonGate';

const open = { viewerMayAnswer: true, unsureBy: null };

describe('pairBlocksGiving', () => {
    it('blocks an unanswered pair the viewer may answer, on a profile the form created', () => {
        expect(pairBlocksGiving(open, true)).toBe(true);
    });
    it('does not block once someone answered «No sé»', () => {
        expect(pairBlocksGiving({ ...open, unsureBy: 'ana@example.com' }, true)).toBe(false);
    });
    it('does not block a pair the viewer may not answer (hidden, or another team\'s)', () => {
        expect(pairBlocksGiving({ ...open, viewerMayAnswer: false }, true)).toBe(false);
    });
    it('does not block when the form sits on an existing profile (the cards are read-only there)', () => {
        expect(pairBlocksGiving(open, false)).toBe(false);
    });
});

describe('blockingPairCount', () => {
    it('counts each pair still to answer', () => {
        expect(blockingPairCount([open, { ...open, unsureBy: 'x@example.com' }, open], true)).toBe(2);
    });
    it('is 0 with no pairs', () => {
        expect(blockingPairCount([], true)).toBe(0);
    });
});
