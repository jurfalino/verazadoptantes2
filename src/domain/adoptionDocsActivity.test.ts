import { describe, it, expect } from 'vitest';
import {
    isDocsActivityVisible, ADOPTION_DOCS_FORM_SAVED, ADOPTION_DOCS_CONTRACT_SAVED,
    ADOPTION_DOCS_ACTIVITY_ACTIONS,
} from './adoptionDocsActivity';

describe('ADOPTION_DOCS_ACTIVITY_ACTIONS', () => {
    it('lists the two action names', () => {
        expect(ADOPTION_DOCS_ACTIVITY_ACTIONS).toEqual(['adoption_docs_form_saved', 'adoption_docs_contract_saved']);
    });
});

describe('isDocsActivityVisible', () => {
    it('shows every non-docs action unconditionally', () => {
        expect(isDocsActivityVisible('adopter_created', {}, [])).toBe(true);
        expect(isDocsActivityVisible('flag_created', { orgId: 'org-2' }, ['org-1'])).toBe(true);
    });
    it('hides a self edit — no orgId in details', () => {
        expect(isDocsActivityVisible(ADOPTION_DOCS_FORM_SAVED, {}, ['org-1'])).toBe(false);
    });
    it('hides an edit of an org the viewer is not (or no longer) a member of', () => {
        expect(isDocsActivityVisible(ADOPTION_DOCS_CONTRACT_SAVED, { orgId: 'org-2' }, ['org-1'])).toBe(false);
    });
    it('shows an edit of an org the viewer belongs to', () => {
        expect(isDocsActivityVisible(ADOPTION_DOCS_FORM_SAVED, { orgId: 'org-1' }, ['org-1', 'org-3'])).toBe(true);
    });
    it('hides on a non-string or empty orgId (forged/malformed row)', () => {
        expect(isDocsActivityVisible(ADOPTION_DOCS_CONTRACT_SAVED, { orgId: 42 }, ['org-1'])).toBe(false);
        expect(isDocsActivityVisible(ADOPTION_DOCS_CONTRACT_SAVED, { orgId: '' }, ['org-1'])).toBe(false);
    });
});
