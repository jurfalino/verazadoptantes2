import { describe, it, expect } from 'vitest';
import { formLinkKind, formResultsView, planFormLink, summarizeAdopterForms } from './formLink';

const AUTO = 'auto-1';
const EXISTING = 'existing-1';
const OTHER = 'existing-2';

describe('formLinkKind', () => {
    it('is unlinked when the form points at no profile (auto-create failed, or a pre-auto-create form)', () => {
        expect(formLinkKind({ linkedAdopterId: null, autoAdopterId: null })).toBe('unlinked');
        expect(formLinkKind({ linkedAdopterId: null, autoAdopterId: AUTO })).toBe('unlinked');
    });

    it('is new_profile while the form still points at the profile auto-created from it', () => {
        expect(formLinkKind({ linkedAdopterId: AUTO, autoAdopterId: AUTO })).toBe('new_profile');
    });

    it('is linked_existing once the form points anywhere else', () => {
        expect(formLinkKind({ linkedAdopterId: EXISTING, autoAdopterId: AUTO })).toBe('linked_existing');
        // A form linked by hand (create-from-form) never had an auto-created profile.
        expect(formLinkKind({ linkedAdopterId: EXISTING, autoAdopterId: null })).toBe('linked_existing');
    });
});

describe('formResultsView', () => {
    it('asks the rescuer to review matches while a new profile has look-alikes', () => {
        const v = formResultsView('new_profile', 2);
        expect(v.banner).toBe('review_matches');
        expect(v.primary).toBe('review_matches');
        expect(v.secondary).toBe('view_profile');
        expect(v.canLinkMatches).toBe(true);
        expect(v.matchesOpenByDefault).toBe(true);
    });

    it('settles on the new profile when nothing (or nothing left) matches', () => {
        const v = formResultsView('new_profile', 0);
        expect(v.banner).toBe('new_profile');
        expect(v.primary).toBe('view_profile');
        expect(v.secondary).toBeNull();
        expect(v.canLinkMatches).toBe(false);
    });

    it('offers no further linking once linked to an existing profile, and folds the matches away', () => {
        for (const n of [0, 1, 3]) {
            const v = formResultsView('linked_existing', n);
            expect(v.banner).toBe('linked_existing');
            expect(v.primary).toBe('view_profile');
            expect(v.secondary).toBeNull();
            expect(v.canLinkMatches).toBe(false);
            expect(v.matchesOpenByDefault).toBe(false);
        }
    });

    it('keeps "create profile" as the way forward for an unlinked form', () => {
        expect(formResultsView('unlinked', 0)).toMatchObject({ banner: 'unlinked', primary: 'create_profile', secondary: null });
        expect(formResultsView('unlinked', 2)).toMatchObject({
            banner: 'unlinked_with_matches', primary: 'create_profile', secondary: 'review_matches', canLinkMatches: true,
        });
    });

    it('never offers the same action twice', () => {
        const kinds = ['unlinked', 'new_profile', 'linked_existing'] as const;
        for (const k of kinds) for (const n of [0, 1]) {
            const v = formResultsView(k, n);
            expect(v.secondary).not.toBe(v.primary);
        }
    });
});

describe('planFormLink', () => {
    const base = {
        row: { linkedAdopterId: AUTO, autoAdopterId: AUTO },
        targetId: EXISTING,
        recordedMatchIds: [EXISTING, OTHER],
        targetLive: true,
        autoLive: true,
    };

    it('merges the auto-created profile into the chosen match', () => {
        expect(planFormLink(base)).toEqual({ ok: true, op: 'merge', orphanId: AUTO });
    });

    it('just links when there is no auto-created profile to fold in', () => {
        expect(planFormLink({ ...base, row: { linkedAdopterId: null, autoAdopterId: null } })).toEqual({ ok: true, op: 'link' });
        // Auto-create failed but the column was set before the failure.
        expect(planFormLink({ ...base, row: { linkedAdopterId: null, autoAdopterId: AUTO } })).toEqual({ ok: true, op: 'link' });
    });

    it('just links when the auto-created profile was already merged away elsewhere', () => {
        expect(planFormLink({ ...base, autoLive: false })).toEqual({ ok: true, op: 'link' });
    });

    it('is a no-op when the form already points at the target (double click, retry after a timeout)', () => {
        expect(planFormLink({ ...base, row: { linkedAdopterId: EXISTING, autoAdopterId: AUTO } })).toEqual({ ok: true, op: 'noop' });
    });

    it('refuses a target that is not one of the recorded matches — the action must not merge into arbitrary profiles', () => {
        expect(planFormLink({ ...base, targetId: 'someone-else' })).toEqual({ ok: false, reason: 'not_a_match' });
    });

    it('refuses to merge the auto-created profile into itself', () => {
        const row = { linkedAdopterId: null, autoAdopterId: AUTO };
        expect(planFormLink({ ...base, row, targetId: AUTO, recordedMatchIds: [AUTO] })).toEqual({ ok: false, reason: 'self' });
    });

    it('refuses a match that has since been deleted or merged', () => {
        expect(planFormLink({ ...base, targetLive: false })).toEqual({ ok: false, reason: 'target_unavailable' });
    });

    it('never moves a form off an existing profile — that profile is real, merging it away would lose a person', () => {
        expect(planFormLink({ ...base, targetId: OTHER, row: { linkedAdopterId: EXISTING, autoAdopterId: AUTO } }))
            .toEqual({ ok: false, reason: 'already_linked' });
    });
});

describe('summarizeAdopterForms', () => {
    const ME = 'me@x.org';
    const TEAMMATE = 'mate@x.org';
    const form = (over: Partial<Parameters<typeof summarizeAdopterForms>[0][number]>) => ({
        id: 'f1', userId: ME, linkedAdopterId: AUTO, autoAdopterId: AUTO, submittedAt: 100, selectedAnimalId: null, ...over,
    });

    it('is empty for a person with no forms', () => {
        expect(summarizeAdopterForms([], ME, () => 0)).toEqual({ count: 0, latest: null, needsReview: false });
    });

    it('counts every form and surfaces the newest one', () => {
        const s = summarizeAdopterForms([
            form({ id: 'old', submittedAt: 100 }),
            form({ id: 'new', submittedAt: 300, selectedAnimalId: 'luna' }),
            form({ id: 'mid', submittedAt: 200 }),
        ], ME, () => 0);
        expect(s.count).toBe(3);
        expect(s.latest).toEqual({ submissionId: 'new', submittedAt: 300, animalId: 'luna', ownedByViewer: true });
    });

    it('needs review exactly when the form-results page would ask for a decision', () => {
        // New profile with live look-alikes → review_matches.
        expect(summarizeAdopterForms([form({})], ME, () => 2).needsReview).toBe(true);
        // Nothing left to compare against.
        expect(summarizeAdopterForms([form({})], ME, () => 0).needsReview).toBe(false);
        // Already linked to an existing profile — decided.
        expect(summarizeAdopterForms([form({ linkedAdopterId: EXISTING })], ME, () => 2).needsReview).toBe(false);
    });

    it("never flags a teammate's form: only its owner can act on it", () => {
        const s = summarizeAdopterForms([form({ userId: TEAMMATE })], ME, () => 2);
        expect(s.needsReview).toBe(false);
        expect(s.latest?.ownedByViewer).toBe(false);
    });

    it('flags the person when any of their forms needs review, not only the newest', () => {
        const s = summarizeAdopterForms([
            form({ id: 'pending', submittedAt: 100 }),
            form({ id: 'decided', submittedAt: 200, linkedAdopterId: EXISTING }),
        ], ME, (id) => (id === 'pending' ? 1 : 0));
        expect(s.latest?.submissionId).toBe('decided');
        expect(s.needsReview).toBe(true);
    });
});
