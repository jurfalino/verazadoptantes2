import { describe, it, expect } from 'vitest';
import { candidateRefreshOutcome } from './refreshOutcome';

describe('candidateRefreshOutcome', () => {
    it('applies a result, reports a failure, stays quiet when the feature is off', () => {
        expect(candidateRefreshOutcome({ ok: true })).toBe('apply');
        expect(candidateRefreshOutcome({ ok: false, error: 'generic', errorId: 'abcd1234' })).toBe('report');
        expect(candidateRefreshOutcome({ ok: false, error: 'forbidden' })).toBe('report');
        expect(candidateRefreshOutcome({ ok: false, error: 'invalid' })).toBe('report');
        expect(candidateRefreshOutcome({ ok: false, error: 'disabled' })).toBe('ignore');
    });
});
