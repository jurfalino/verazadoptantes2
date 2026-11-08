import { describe, it, expect } from 'vitest';
import { canSeeInaccuracyReports } from './inaccuracyReports';

const OWNER = 'owner@example.com';
const base = { owner: OWNER, viewerIsOrgMateOfOwner: false, viewerIsModeratorOrAdmin: false };

describe('canSeeInaccuracyReports — the notice\'s audience, plus admins and moderators', () => {
    it('the owner, whatever case either email was written in', () => {
        expect(canSeeInaccuracyReports({ ...base, viewer: OWNER })).toBe(true);
        expect(canSeeInaccuracyReports({ ...base, owner: ' Owner@Example.com ', viewer: 'owner@example.com' })).toBe(true);
    });

    it('a member of the owner\'s organization', () => {
        expect(canSeeInaccuracyReports({ ...base, viewer: 'mate@example.com', viewerIsOrgMateOfOwner: true })).toBe(true);
    });

    it('an admin or moderator, even on an ownerless (imported) profile', () => {
        expect(canSeeInaccuracyReports({ ...base, viewer: 'admin@example.com', viewerIsModeratorOrAdmin: true })).toBe(true);
        expect(canSeeInaccuracyReports({ ...base, owner: 'import', viewer: 'admin@example.com', viewerIsModeratorOrAdmin: true })).toBe(true);
    });

    it('never another rescuer — the reporter included, when not on the team', () => {
        expect(canSeeInaccuracyReports({ ...base, viewer: 'reporter@example.com' })).toBe(false);
    });

    it('an ownerless profile: nobody but staff (the notice tells the admins only)', () => {
        expect(canSeeInaccuracyReports({ ...base, owner: null, viewer: 'mate@example.com', viewerIsOrgMateOfOwner: true })).toBe(false);
        expect(canSeeInaccuracyReports({ ...base, owner: 'sheet-import', viewer: 'sheet-import' })).toBe(false);
    });

    it('nobody signed out', () => {
        expect(canSeeInaccuracyReports({ ...base, viewer: '' })).toBe(false);
        expect(canSeeInaccuracyReports({ ...base, viewer: null, viewerIsModeratorOrAdmin: true })).toBe(false);
    });
});
