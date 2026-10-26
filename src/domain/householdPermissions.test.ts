import { describe, it, expect } from 'vitest';
import {
    canAddToHousehold, canEditHouseholdMember, canRemoveHouseholdMember,
    canChangeMemberContact, withoutOwnMarks, HOUSEHOLD_NOT_AUTHORIZED,
    type HouseholdViewer,
} from './householdPermissions';

const privileged: HouseholdViewer = { signedIn: true, privileged: true };
const contributor: HouseholdViewer = { signedIn: true, privileged: false };
const anonymous: HouseholdViewer = { signedIn: false, privileged: false };

describe('household controls per viewer (D54)', () => {
    it('anyone signed in may add a member or a contact; nobody signed out may', () => {
        expect(canAddToHousehold(privileged)).toBe(true);
        expect(canAddToHousehold(contributor)).toBe(true);
        expect(canAddToHousehold(anonymous)).toBe(false);
    });

    it('the owner\'s team changes every member; a contributor only the ones marked own', () => {
        const theirs = { contactEntries: [] };
        const mine = { own: true, contactEntries: [] };
        expect(canEditHouseholdMember(privileged, theirs)).toBe(true);
        expect(canEditHouseholdMember(contributor, theirs)).toBe(false);
        expect(canEditHouseholdMember(contributor, mine)).toBe(true);
        expect(canEditHouseholdMember(anonymous, mine)).toBe(false);
    });

    it('a contributor removes their member only when every contact on it is theirs too', () => {
        expect(canRemoveHouseholdMember(contributor, { own: true, contactEntries: [] })).toBe(true);
        expect(canRemoveHouseholdMember(contributor, { own: true, contactEntries: [{ own: true }, { own: true }] })).toBe(true);
        // Someone else added a phone to it: removing the member would remove their data.
        expect(canRemoveHouseholdMember(contributor, { own: true, contactEntries: [{ own: true }, {}] })).toBe(false);
        // A masked foreign entry arrives with neither `own` nor `addedBy` nor `id`.
        expect(canRemoveHouseholdMember(contributor, { own: true, contactEntries: [{ masked: true }] })).toBe(false);
        expect(canRemoveHouseholdMember(contributor, { contactEntries: [] })).toBe(false);
        expect(canRemoveHouseholdMember(privileged, { contactEntries: [{}, { masked: true }] })).toBe(true);
    });

    it('a contact changes for the team or for whoever added it; never while masked or without an id', () => {
        expect(canChangeMemberContact(privileged, { id: 'a' })).toBe(true);
        expect(canChangeMemberContact(contributor, { id: 'a' })).toBe(false);
        expect(canChangeMemberContact(contributor, { id: 'a', own: true })).toBe(true);
        expect(canChangeMemberContact(contributor, { masked: true })).toBe(false);
        expect(canChangeMemberContact(privileged, { id: 'a', masked: true })).toBe(false);
        expect(canChangeMemberContact(privileged, {})).toBe(false);
        expect(canChangeMemberContact(anonymous, { id: 'a', own: true })).toBe(false);
    });

    it('an unmasked contact someone else added (gating off: nothing masked) gives a non-privileged viewer no edit/remove', () => {
        const theirs = { id: 'ce-1', type: 'phone', value: '11 4200-0002' };
        expect(canChangeMemberContact(contributor, theirs)).toBe(false);
        expect(canRemoveHouseholdMember(contributor, { own: true, contactEntries: [theirs] })).toBe(false);
        expect(canChangeMemberContact(privileged, theirs)).toBe(true);
    });

    it('preview as a stranger: no own markers survive, so no controls from them', () => {
        const members = [{ id: 'm', own: true, contactEntries: [{ id: 'e', own: true }, { id: 'f' }] }];
        const asStranger = withoutOwnMarks(members);
        expect(asStranger).toEqual([{ id: 'm', contactEntries: [{ id: 'e' }, { id: 'f' }] }]);
        expect(canEditHouseholdMember(contributor, asStranger[0])).toBe(false);
        expect(canChangeMemberContact(contributor, asStranger[0].contactEntries[0])).toBe(false);
        expect(members[0].own).toBe(true); // the input is not touched
    });

    it('keeps the server\'s refusal string', () => {
        expect(HOUSEHOLD_NOT_AUTHORIZED).toBe('Not authorized to edit this household.');
    });
});
