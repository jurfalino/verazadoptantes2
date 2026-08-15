import { describe, it, expect } from 'vitest';
import { computeVisibilityBadge } from './visibilityBadge';

describe('computeVisibilityBadge', () => {
    it('shows no badge on the new-record form', () => {
        expect(computeVisibilityBadge({ isNew: true, isPublic: true })).toBeNull();
        expect(computeVisibilityBadge({ isNew: true, gatingOn: true })).toBeNull();
    });

    it('public wins regardless of gating/access', () => {
        expect(computeVisibilityBadge({ isPublic: true })).toBe('public');
        expect(computeVisibilityBadge({ isPublic: true, gatingOn: true })).toBe('public');
        expect(computeVisibilityBadge({ isPublic: 1 as unknown as boolean })).toBe('public');
    });

    it('no badge for a non-public record when gating is OFF (feature dormant)', () => {
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: false })).toBeNull();
        expect(computeVisibilityBadge({ isPublic: false })).toBeNull();
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: false, hasFullAccess: false })).toBeNull();
    });

    it('protected-unlocked (green) ONLY on a positive full-access signal', () => {
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: true })).toBe('protected-unlocked');
        expect(computeVisibilityBadge({ isPublic: null, gatingOn: true, hasFullAccess: true })).toBe('protected-unlocked');
    });

    it('protected-locked (gray) for a protected record without full access', () => {
        // Stranger with no access.
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: false })).toBe('protected-locked');
        // hasFullAccess omitted (undefined) — still gray, never green.
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true })).toBe('protected-locked');
        expect(computeVisibilityBadge({ isPublic: null, gatingOn: true })).toBe('protected-locked');
    });

    it('partial unlock is NOT full access — still gray "Protegido"', () => {
        // A viewer who unlocked the record's only contact field via search/verify
        // has nothing left masked, but does NOT have full access. This is the gap
        // that used to render no badge at all — must now be gray, never green.
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: false })).toBe('protected-locked');
    });

    it('fieldless protected record is still "Protegido" (never green, never blank)', () => {
        // A protected record with no maskable contact left also has hasFullAccess
        // false. It must read as protected — never as "you have access", never as
        // a missing badge.
        expect(computeVisibilityBadge({ isPublic: false, gatingOn: true, hasFullAccess: false })).toBe('protected-locked');
    });
});
