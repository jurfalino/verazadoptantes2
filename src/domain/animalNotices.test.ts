/**
 * Forms, contracts and check-ups (Jon 2026-11-11): the team copies are bell
 * only; the email goes to the animal's owner, or to the form link's owner when
 * there's no animal of the team.
 */
import { describe, it, expect } from 'vitest';
import { animalNoticeEmailTo, teamCopyDelivery } from './animalNotices';

describe('animalNoticeEmailTo', () => {
    it("a team animal: its owner (the link owner's teammate, or the link owner)", () => {
        expect(animalNoticeEmailTo({ linkOwner: 'ana@x.org', animalOwner: 'bea@x.org', animalInTeam: true })).toBe('bea@x.org');
        expect(animalNoticeEmailTo({ linkOwner: 'ana@x.org', animalOwner: 'ana@x.org', animalInTeam: true })).toBe('ana@x.org');
    });
    it('no animal, or one outside the team (a forged link): the link owner', () => {
        expect(animalNoticeEmailTo({ linkOwner: 'ana@x.org', animalOwner: null, animalInTeam: false })).toBe('ana@x.org');
        expect(animalNoticeEmailTo({ linkOwner: 'ana@x.org', animalOwner: 'zoe@other.org', animalInTeam: false })).toBe('ana@x.org');
    });
});

describe('teamCopyDelivery', () => {
    it('the copy to the person the email is for may be emailed; every other team copy is bell only', () => {
        expect(teamCopyDelivery({ recipient: 'Bea@X.org ', emailTo: 'bea@x.org' })).toBe('bell_and_email');
        expect(teamCopyDelivery({ recipient: 'cal@x.org', emailTo: 'bea@x.org' })).toBe('bell');
        expect(teamCopyDelivery({ recipient: 'cal@x.org', emailTo: null })).toBe('bell');
    });
});
