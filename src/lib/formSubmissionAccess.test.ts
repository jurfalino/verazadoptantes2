import { describe, it, expect, vi } from 'vitest';
import { canViewerAccessFormSubmission, type FormSubmissionAccessDeps } from './formSubmissionAccess';

/**
 * Who may open a form submission (/form-results, «Crear adoptante» prefill,
 * «Vincular»). It must agree with the animal page, which lists an animal's
 * applicants to anyone on the animal OWNER's team:
 *   1. admin;
 *   2. owner or org-mate of the FORM-LINK owner (`user_id`);
 *   3. the submission targets an animal, the viewer is owner/org-mate of the
 *      ANIMAL owner, and the form-link owner is in the animal owner's team
 *      (forged `?animal=` rows from outside the team still fail).
 *
 * Team graph used below (O is in two orgs):
 *   org1 = { O, V }     org2 = { O, T }     X = outsider
 */
const ORG_MATES: Record<string, string[]> = {
    'o@example.com': ['v@example.com', 't@example.com'],
    'v@example.com': ['o@example.com'],
    't@example.com': ['o@example.com'],
};
const ANIMALS: Record<string, string | null> = { 'animal-o': 'o@example.com', 'animal-orphan': null };

function deps(overrides: Partial<FormSubmissionAccessDeps> = {}) {
    const d = {
        isOwnerOrOrgMate: vi.fn(async (viewer: string, owner: string) => {
            const v = viewer.toLowerCase(); const o = owner.toLowerCase();
            return v === o || (ORG_MATES[o] ?? []).includes(v);
        }),
        isAdmin: vi.fn(async (viewer: string) => viewer === 'admin@example.com'),
        getAnimalOwner: vi.fn(async (id: string) => ANIMALS[id] ?? null),
        getTeamEmails: vi.fn(async (owner: string) => [owner.toLowerCase(), ...(ORG_MATES[owner.toLowerCase()] ?? [])]),
        ...overrides,
    };
    return d;
}

const sub = (userId: string, selectedAnimalId: string | null = 'animal-o') => ({ userId, selectedAnimalId });

describe('canViewerAccessFormSubmission', () => {
    it('the form-link owner (any case) is allowed without touching the animal', async () => {
        const d = deps();
        expect(await canViewerAccessFormSubmission('T@Example.com', sub('t@example.com'), d)).toBe(true);
        expect(d.getAnimalOwner).not.toHaveBeenCalled();
    });

    it('an org-mate of the form-link owner is allowed (branch 2) — branch 3 is not evaluated', async () => {
        const d = deps();
        expect(await canViewerAccessFormSubmission('o@example.com', sub('t@example.com'), d)).toBe(true);
        expect(d.getAnimalOwner).not.toHaveBeenCalled();
        expect(d.getTeamEmails).not.toHaveBeenCalled();
    });

    it('an admin is allowed', async () => {
        expect(await canViewerAccessFormSubmission('admin@example.com', sub('x@example.com', null), deps())).toBe(true);
    });

    it('cross-org: V (org1 with O) may open T\'s-link applicant (org2 with O) for O\'s animal', async () => {
        const d = deps();
        expect(await canViewerAccessFormSubmission('v@example.com', sub('t@example.com'), d)).toBe(true);
        // Scope is the ANIMAL OWNER's team — V's own team ({V, O}) does not contain T.
        expect(d.getTeamEmails).toHaveBeenCalledWith('o@example.com');
        expect(d.getTeamEmails).not.toHaveBeenCalledWith('v@example.com');
    });

    it('cross-org scope matches the form-link owner case-insensitively', async () => {
        expect(await canViewerAccessFormSubmission('v@example.com', sub('T@EXAMPLE.com'), deps())).toBe(true);
    });

    it('a forged row (form-link owner outside the animal owner\'s team) stays forbidden', async () => {
        expect(await canViewerAccessFormSubmission('v@example.com', sub('x@example.com'), deps())).toBe(false);
    });

    it('a viewer outside the animal owner\'s team is forbidden', async () => {
        expect(await canViewerAccessFormSubmission('x@example.com', sub('t@example.com'), deps())).toBe(false);
    });

    it('no animal, an unknown animal or an ownerless animal → no branch 3', async () => {
        expect(await canViewerAccessFormSubmission('v@example.com', sub('t@example.com', null), deps())).toBe(false);
        expect(await canViewerAccessFormSubmission('v@example.com', sub('t@example.com', 'animal-missing'), deps())).toBe(false);
        expect(await canViewerAccessFormSubmission('v@example.com', sub('t@example.com', 'animal-orphan'), deps())).toBe(false);
    });

    it('an empty animal-owner team fails closed', async () => {
        const d = deps({ getTeamEmails: vi.fn(async () => []) });
        expect(await canViewerAccessFormSubmission('v@example.com', sub('t@example.com'), d)).toBe(false);
    });

    it('a blank viewer is forbidden', async () => {
        expect(await canViewerAccessFormSubmission('', sub('t@example.com'), deps())).toBe(false);
        expect(await canViewerAccessFormSubmission(null, sub('t@example.com'), deps())).toBe(false);
    });
});
