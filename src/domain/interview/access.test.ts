import { describe, it, expect } from 'vitest';
import { canViewInterviewAnswers } from './access';

const base = { conductedBy: 'ana@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false };

describe('canViewInterviewAnswers (spec D7)', () => {
    it('interviewer, profile owner, owner org-mates and admins may read answers', () => {
        expect(canViewInterviewAnswers({ ...base, viewer: 'ana@x.com' })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'owner@x.com' })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'mate@x.com', viewerIsOrgMate: true })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'root@x.com', viewerIsAdmin: true })).toBe(true);
    });
    it('any other rescuer, and nobody signed out, may not', () => {
        expect(canViewInterviewAnswers({ ...base, viewer: 'other@x.com' })).toBe(false);
        expect(canViewInterviewAnswers({ ...base, viewer: null })).toBe(false);
        expect(canViewInterviewAnswers({ ...base, ownerEmail: null, viewer: 'other@x.com' })).toBe(false);
    });
});
