/**
 * Forms, contracts and check-ups (Jon 2026-11-11): the team copies are bell
 * only; the email goes to the animal's owner, or to the form link's owner when
 * there's no animal of the team.
 */
import { describe, it, expect } from 'vitest';
import { formNoticeRecipients, teamCopyDelivery, parseAnimalsScope, followupDelivery } from './animalNotices';

type Member = { email: string; scope: 'mine' | 'team' };

/** Who ends up with what: the route's two direct copies, then notifyOrgMembers over the team (minus the actor and `excludeFromTeam`). */
function outcome(linkOwner: string, animalOwner: string | null, ownerInTeam: boolean | null, team: Member[]) {
    const plan = formNoticeRecipients({ linkOwner, animalOwner, ownerInTeam });
    const out: Record<string, string> = { [linkOwner.toLowerCase()]: plan.linkOwnerBellOnly ? 'bell' : 'bell_and_email' };
    if (plan.animalOwnerCopy) out[plan.animalOwnerCopy.toLowerCase()] = 'bell_and_email';
    const skip = new Set([linkOwner, ...plan.excludeFromTeam].map(e => e.trim().toLowerCase()));
    for (const m of team) {
        if (skip.has(m.email.trim().toLowerCase())) continue;
        const d = teamCopyDelivery({ recipient: m.email, ...plan.teamCopy, scope: m.scope });
        if (d !== 'skip') out[m.email.toLowerCase()] = d;
    }
    return out;
}

const ANA = 'ana@x.org';
const BEA = 'bea@x.org';
const CAL = 'cal@x.org';
const team = (scope: 'mine' | 'team' = 'team', beaScope: 'mine' | 'team' = scope): Member[] =>
    [{ email: ANA, scope }, { email: BEA, scope: beaScope }, { email: CAL, scope }];

describe('formNoticeRecipients (a form arrives on ana\'s link)', () => {
    it("ana's own animal: ana's copy may be emailed, the team's are bell only", () => {
        expect(outcome(ANA, ANA, false, team())).toEqual({ [ANA]: 'bell_and_email', [BEA]: 'bell', [CAL]: 'bell' });
    });

    it("bea's animal: bea's own copy (made by the route) may be emailed; ana's and cal's are bell only", () => {
        const plan = formNoticeRecipients({ linkOwner: ANA, animalOwner: BEA, ownerInTeam: true });
        expect(plan).toEqual({ linkOwnerBellOnly: true, animalOwnerCopy: BEA, excludeFromTeam: [BEA], teamCopy: { emailTo: null, animalOwner: BEA } });
        expect(outcome(ANA, BEA, true, team())).toEqual({ [ANA]: 'bell', [BEA]: 'bell_and_email', [CAL]: 'bell' });
    });

    it('no animal: ana may be emailed, the team gets the bell', () => {
        expect(outcome(ANA, null, false, team())).toEqual({ [ANA]: 'bell_and_email', [BEA]: 'bell', [CAL]: 'bell' });
    });

    it("an animal outside ana's team (a forged ?animal=): treated as no animal, its owner hears nothing", () => {
        const plan = formNoticeRecipients({ linkOwner: ANA, animalOwner: 'zoe@other.org', ownerInTeam: false });
        expect(plan.animalOwnerCopy).toBeNull();
        expect(plan.teamCopy).toEqual({ emailTo: ANA, animalOwner: null });
        expect(outcome(ANA, 'zoe@other.org', false, team())).toEqual({ [ANA]: 'bell_and_email', [BEA]: 'bell', [CAL]: 'bell' });
    });

    it('the team lookup failed: ana is emailed, as before this branch; no direct copy to an owner we could not place', () => {
        const plan = formNoticeRecipients({ linkOwner: ANA, animalOwner: BEA, ownerInTeam: null });
        expect(plan.linkOwnerBellOnly).toBe(false);
        expect(plan.animalOwnerCopy).toBeNull();
        expect(plan.excludeFromTeam).toEqual([]);
        // If the fan-out does reach bea, «Mis animales» still lets her animal through (bell).
        expect(outcome(ANA, BEA, null, team('team', 'mine'))).toEqual({ [ANA]: 'bell_and_email', [BEA]: 'bell', [CAL]: 'bell' });
    });

    it('case and spaces never matter', () => {
        expect(formNoticeRecipients({ linkOwner: 'Ana@X.org', animalOwner: ' ana@x.ORG ', ownerInTeam: false }))
            .toMatchObject({ linkOwnerBellOnly: false, animalOwnerCopy: null });
        const plan = formNoticeRecipients({ linkOwner: ANA, animalOwner: ' Bea@X.org ', ownerInTeam: true });
        expect(plan.animalOwnerCopy).toBe('Bea@X.org');
        expect(plan.excludeFromTeam).toEqual(['bea@x.org']);
        // The fan-out lists bea in another case: still one copy, hers.
        expect(outcome(ANA, ' Bea@X.org ', true, [{ email: 'BEA@x.org', scope: 'team' }, { email: CAL, scope: 'team' }]))
            .toEqual({ [ANA]: 'bell', [BEA]: 'bell_and_email', [CAL]: 'bell' });
    });

    it("bea on «Mis animales» or «todo el equipo»: her animal reaches her either way; cal's «Mis animales» drops it", () => {
        expect(outcome(ANA, BEA, true, team('team', 'mine'))).toEqual({ [ANA]: 'bell', [BEA]: 'bell_and_email', [CAL]: 'bell' });
        expect(outcome(ANA, BEA, true, team('mine'))).toEqual({ [ANA]: 'bell', [BEA]: 'bell_and_email' });
        expect(outcome(ANA, BEA, true, team('team'))).toEqual({ [ANA]: 'bell', [BEA]: 'bell_and_email', [CAL]: 'bell' });
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
