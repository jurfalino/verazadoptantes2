import { describe, it, expect } from 'vitest';
import { computeVisibilityBadge } from './visibilityBadge';

describe('computeVisibilityBadge', () => {
    it('shows no badge on the new-record form', () => {
        expect(computeVisibilityBadge({ isNew: true, isPublic: true })).toBeNull();
        expect(computeVisibilityBadge({ isNew: true, gatingOn: true, masked: true })).toBeNull();
    });

    it('public wins regardless of gating/access', () => {
        expect(computeVisibilityBadge({ isPublic: true })).toBe('public');
        expect(computeVisibilityBadge({ isPublic: true, gatingOn: true, masked: true })).toBe('public');
        expect(computeVisibilityBadge({ isPublic: 1 as unknown as boolean })).toBe('public');
    });

    it('no badge for a non-public record when gating is OFF (today\'s behavior)', () => {
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: false })).toBeNull();
        expect(computeVisibilityBadge({ isPublic: false })).toBeNull();
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: false, masked: true })).toBeNull();
    });

    it('protected-unlocked ONLY on a positive full-access signal', () => {
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: true })).toBe('protected-unlocked');
        // full access wins even if masked were somehow set
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: true, masked: true })).toBe('protected-unlocked');
    });

    it('protected-locked when gating on, no full access, but fields are masked', () => {
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: false, masked: true })).toBe('protected-locked');
    });

    it('REGRESSION: fieldless/legacy stranger (no access, nothing masked) shows NO badge — never green', () => {
        // A stranger on a non-public record with no maskable fields has
        // masked=false AND hasFullAccess=false. Must NOT read as "you have access".
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: false, masked: false })).toBeNull();
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true })).toBeNull();
    });

    it('null/undefined isPublic is treated as not public', () => {
        expect(computeVisibilityBadge({ isPublic: null, gatingOn: true, hasFullAccess: true })).toBe('protected-unlocked');
        expect(computeVisibilityBadge({ isPublic: null, gatingOn: true, masked: true })).toBe('protected-locked');
    });
});
