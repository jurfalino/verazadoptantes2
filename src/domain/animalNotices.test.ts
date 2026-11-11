/**
 * Forms, contracts and check-ups (Jon 2026-11-11): the team copies are bell
 * only; the email goes to the animal's owner, or to the form link's owner when
 * there's no animal of the team.
 */
import { describe, it, expect } from 'vitest';
import { animalNoticeEmailTo, teamCopyDelivery, parseAnimalsScope, followupDelivery } from './animalNotices';

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
    const base = { emailTo: 'bea@x.org', animalOwner: 'bea@x.org', scope: 'team' as const };
    it('the copy to the person the email is for may be emailed; every other team copy is bell only', () => {
        expect(teamCopyDelivery({ ...base, recipient: 'Bea@X.org ' })).toBe('bell_and_email');
        expect(teamCopyDelivery({ ...base, recipient: 'cal@x.org' })).toBe('bell');
        expect(teamCopyDelivery({ ...base, recipient: 'cal@x.org', emailTo: null, animalOwner: null })).toBe('bell');
    });

    it('«Mis animales»: no team copy at all (not even the bell) for animals the person did not add', () => {
        expect(teamCopyDelivery({ ...base, recipient: 'cal@x.org', scope: 'mine' })).toBe('skip');
        // A form for no animal of the team is nobody's animal: skipped too.
        expect(teamCopyDelivery({ recipient: 'cal@x.org', emailTo: 'ana@x.org', animalOwner: null, scope: 'mine' })).toBe('skip');
    });

    it('«Mis animales» keeps the copies about the person\'s own animals', () => {
        expect(teamCopyDelivery({ ...base, recipient: 'bea@x.org', scope: 'mine' })).toBe('bell_and_email');
        expect(teamCopyDelivery({ ...base, recipient: 'bea@x.org', emailTo: 'ana@x.org', scope: 'mine' })).toBe('bell');
    });
});

describe('the animals scope setting', () => {
    it('defaults to the whole team; only an exact «mine» narrows it', () => {
        expect(parseAnimalsScope(null)).toBe('team');
        expect(parseAnimalsScope(undefined)).toBe('team');
        expect(parseAnimalsScope('team')).toBe('team');
        expect(parseAnimalsScope('mine')).toBe('mine');
        expect(parseAnimalsScope('MINE')).toBe('team');
    });

});

describe('followupDelivery (the daily check-up Worker)', () => {
    const owner = 'ana@x.org';
    it('the owner: bell, plus the digest email when they switched it on', () => {
        expect(followupDelivery({ recipient: owner, owner, scope: 'mine', emailReminders: true })).toBe('bell_and_email');
        expect(followupDelivery({ recipient: owner, owner, scope: 'team', emailReminders: false })).toBe('bell');
    });
    it('a teammate: bell only, whatever their email switch; nothing with «Mis animales»', () => {
        expect(followupDelivery({ recipient: 'bea@x.org', owner, scope: 'team', emailReminders: true })).toBe('bell');
        expect(followupDelivery({ recipient: 'bea@x.org', owner, scope: 'mine', emailReminders: true })).toBe('skip');
    });
});
