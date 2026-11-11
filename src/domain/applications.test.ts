import { describe, it, expect } from 'vitest';
import {
    isLiveInvitation, contractNote, applicationStatus, candidatesLostOnDelete, isToEvaluate, isToDo, panelOrder, nextToEvaluateIndex,
    planAdoptionClose, planMergeDedupe, submissionApplication, lifeStageOf, matchesPreference, rankProposalAnimals, formNoticeUrl,
    type ApplicationStatus, type ApplicationFacts,
} from './applications';
import { takesContract } from './placements';

const NOW = 1_800_000_000;
const DAY = 86_400;
const open: ApplicationFacts = { state: 'open', closeReason: null, closedAt: null };
const live = { createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: null };
const te: ApplicationStatus = { kind: 'to_evaluate', note: null };
const cs: ApplicationStatus = { kind: 'contract_sent', sentAt: NOW };
const done: ApplicationStatus = { kind: 'declined', at: NOW };

describe('invitations', () => {
    it('a link is live while unused and unexpired; expires_at NULL is live', () => {
        expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: null }, NOW)).toBe(true);
        expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: null, usedAt: null }, NOW)).toBe(true);
        expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW, usedAt: null }, NOW)).toBe(false);
        expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: NOW }, NOW)).toBe(false);
    });
    it('contractNote is null when any link is live', () => {
        expect(contractNote([live, { createdAt: NOW - 5 * DAY, expiresAt: NOW - 3 * DAY, usedAt: null }], NOW)).toBeNull();
    });
});

describe('applicationStatus', () => {
    it('open + live link = contract_sent at the newest live link createdAt', () => {
        expect(applicationStatus(open, [{ createdAt: NOW - 2 * DAY, expiresAt: NOW + 28 * DAY, usedAt: null }], NOW)).toEqual({ kind: 'contract_sent', sentAt: NOW - 2 * DAY });
        expect(applicationStatus(open, [{ createdAt: NOW - 5 * DAY, expiresAt: NOW + DAY, usedAt: null }, { createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: null }], NOW))
            .toEqual({ kind: 'contract_sent', sentAt: NOW - DAY });
    });
    it('retired early → to_evaluate with «replaced» at its expiresAt; ran its 30 days → «expired»', () => {
        expect(applicationStatus(open, [{ createdAt: NOW - 5 * DAY, expiresAt: NOW - 3 * DAY, usedAt: null }], NOW))
            .toEqual({ kind: 'to_evaluate', note: { kind: 'replaced', at: NOW - 3 * DAY } });
        expect(applicationStatus(open, [{ createdAt: NOW - 40 * DAY, expiresAt: NOW - 10 * DAY, usedAt: null }], NOW))
            .toEqual({ kind: 'to_evaluate', note: { kind: 'expired', at: NOW - 10 * DAY } });
    });
    it('the note comes from the NEWEST dead unused link; a used link gives no note', () => {
        const older = { createdAt: NOW - 60 * DAY, expiresAt: NOW - 30 * DAY, usedAt: null };
        const newer = { createdAt: NOW - 10 * DAY, expiresAt: NOW - 8 * DAY, usedAt: null };
        expect(applicationStatus(open, [older, newer], NOW)).toEqual({ kind: 'to_evaluate', note: { kind: 'replaced', at: NOW - 8 * DAY } });
        expect(applicationStatus(open, [newer, older], NOW)).toEqual({ kind: 'to_evaluate', note: { kind: 'replaced', at: NOW - 8 * DAY } });
        expect(applicationStatus(open, [{ createdAt: NOW - 5 * DAY, expiresAt: NOW - 3 * DAY, usedAt: NOW - 4 * DAY }], NOW)).toEqual({ kind: 'to_evaluate', note: null });
        expect(applicationStatus(open, [], NOW)).toEqual({ kind: 'to_evaluate', note: null });
    });
    it('outcomes ignore links', () => {
        expect(applicationStatus({ state: 'declined', closeReason: null, closedAt: NOW }, [live], NOW)).toEqual({ kind: 'declined', at: NOW });
        expect(applicationStatus({ state: 'closed', closeReason: 'adopted_other', closedAt: NOW }, [], NOW)).toEqual({ kind: 'closed', reason: 'adopted_other' });
        expect(applicationStatus({ state: 'closed', closeReason: null, closedAt: NOW }, [], NOW)).toEqual({ kind: 'closed', reason: 'adopted_other' });
        expect(applicationStatus({ state: 'adopted', closeReason: null, closedAt: null }, [live], NOW)).toEqual({ kind: 'adopted' });
        expect(applicationStatus({ state: 'proposed', closeReason: null, closedAt: null }, [], NOW)).toEqual({ kind: 'proposed' });
        expect(applicationStatus({ state: 'replaced', closeReason: null, closedAt: null }, [], NOW)).toEqual({ kind: 'replaced' });
        expect(applicationStatus({ state: 'also_applied', closeReason: null, closedAt: null }, [], NOW)).toEqual({ kind: 'also_applied' });
    });
    it('isToEvaluate', () => {
        expect(isToEvaluate(te)).toBe(true);
        expect(isToEvaluate(cs)).toBe(false);
    });
});

describe('isToDo', () => {
    it('to evaluate AND on a profile — an orphan form is listed but not a to-do', () => {
        expect(isToDo({ status: te, adopterId: 'p' })).toBe(true);
        expect(isToDo({ status: te, adopterId: null })).toBe(false);
        expect(isToDo({ status: { kind: 'contract_sent', sentAt: NOW }, adopterId: 'p' })).toBe(false);
    });
});

describe('panelOrder', () => {
    it('to_evaluate oldest first, then contract_sent, then outcomes newest first', () => {
        const items = [
            { id: 'out-old', status: { kind: 'declined', at: 1 } as ApplicationStatus, appliedAt: 10 },
            { id: 'cs', status: cs, appliedAt: 5 },
            { id: 'te-new', status: te, appliedAt: 30 },
            { id: 'out-new', status: { kind: 'adopted' } as ApplicationStatus, appliedAt: 50 },
            { id: 'te-old', status: te, appliedAt: 20 },
        ];
        expect(panelOrder(items).map((i) => i.id)).toEqual(['te-old', 'te-new', 'cs', 'out-new', 'out-old']);
        expect(items[0].id).toBe('out-old'); // input not mutated
    });
});

describe('nextToEvaluateIndex', () => {
    it('next after `from`, else wraps to the first, else -1', () => {
        expect(nextToEvaluateIndex([te, cs, te], 0)).toBe(2);
        expect(nextToEvaluateIndex([te, cs, done], 2)).toBe(0);
        expect(nextToEvaluateIndex([cs, done], 0)).toBe(-1);
    });
});

describe('planAdoptionClose', () => {
    it("the adopter's own → adopted; others → closed", () => {
        expect(planAdoptionClose([{ id: 'a', adopterId: 'juan' }, { id: 'b', adopterId: 'ana' }, { id: 'c', adopterId: null }], 'juan', 'invitation'))
            .toEqual([{ id: 'a', state: 'adopted', closeReason: null }, { id: 'b', state: 'closed', closeReason: 'adopted_other' }, { id: 'c', state: 'closed', closeReason: 'adopted_other' }]);
        expect(planAdoptionClose([{ id: 'b', adopterId: 'ana' }], 'new-signer', 'open_link')).toEqual([{ id: 'b', state: 'closed', closeReason: 'adopted_open_link' }]);
        expect(planAdoptionClose([{ id: 'b', adopterId: 'ana' }], 'juan', 'in_app')).toEqual([{ id: 'b', state: 'closed', closeReason: 'adopted_other' }]);
    });
});

describe('planMergeDedupe', () => {
    const sameTeam = (a: string, b: string) => a.split('@')[1] === b.split('@')[1];
    it('per animal the newest open stays; older → replaced; same-team general → also_applied; other team general stays open', () => {
        expect(planMergeDedupe([
            { id: 'old', animalId: 'luna', state: 'open', createdAt: 1, formOwner: 'x@a.org' },
            { id: 'new', animalId: 'luna', state: 'open', createdAt: 2, formOwner: 'y@a.org' },
            { id: 'gen', animalId: null, state: 'open', createdAt: 3, formOwner: 'x@a.org' },
            { id: 'genB', animalId: null, state: 'open', createdAt: 4, formOwner: 'z@b.org' },
            { id: 'done', animalId: 'luna', state: 'declined', createdAt: 0, formOwner: 'x@a.org' },
        ], sameTeam)).toEqual([
            { id: 'old', state: 'replaced', replacedBy: 'new' },
            { id: 'gen', state: 'also_applied', replacedBy: 'new' },
        ]);
    });
    it('two open generals of one team → the older is replaced by the newer', () => {
        expect(planMergeDedupe([
            { id: 'g1', animalId: null, state: 'open', createdAt: 1, formOwner: 'x@a.org' },
            { id: 'g2', animalId: null, state: 'open', createdAt: 2, formOwner: 'y@a.org' },
            { id: 'g3', animalId: null, state: 'open', createdAt: 3, formOwner: 'z@b.org' },
        ], sameTeam)).toEqual([{ id: 'g1', state: 'replaced', replacedBy: 'g2' }]);
    });
    it('a general is also_applied to the NEWEST same-team animal row', () => {
        expect(planMergeDedupe([
            { id: 'a1', animalId: 'luna', state: 'open', createdAt: 5, formOwner: 'x@a.org' },
            { id: 'a2', animalId: 'rex', state: 'open', createdAt: 9, formOwner: 'x@a.org' },
            { id: 'gen', animalId: null, state: 'open', createdAt: 1, formOwner: 'x@a.org' },
        ], sameTeam)).toEqual([{ id: 'gen', state: 'also_applied', replacedBy: 'a2' }]);
    });
});

describe('submissionApplication', () => {
    it('adopted animal → general; fostered/available → the animal; unknown → general; lookup failed → the animal', () => {
        expect(submissionApplication('luna', { recordType: 'adoption', adopterId: 'p' })).toEqual({ animalId: null, origin: 'adopted_animal', askedAnimalId: 'luna' });
        expect(submissionApplication('luna', { recordType: 'foster', adopterId: 'p' })).toEqual({ animalId: 'luna', origin: 'form', askedAnimalId: null });
        expect(submissionApplication('luna', null)).toEqual({ animalId: null, origin: 'form', askedAnimalId: null });
        expect(submissionApplication('luna', undefined)).toEqual({ animalId: 'luna', origin: 'form', askedAnimalId: null });
        expect(submissionApplication(null, undefined)).toEqual({ animalId: null, origin: 'form', askedAnimalId: null });
    });
});

describe('life stage and preference', () => {
    const NOW_MS = Date.UTC(2026, 10, 10);
    const yearsAgo = (y: number) => NOW_MS - y * 365.25 * DAY * 1000;
    it('lifeStageOf: <1y puppy, ≥8y senior, else young; null birth → null', () => {
        expect(lifeStageOf(yearsAgo(0.5), NOW_MS)).toBe('puppy');
        expect(lifeStageOf(yearsAgo(1), NOW_MS)).toBe('young');
        expect(lifeStageOf(yearsAgo(7.9), NOW_MS)).toBe('young');
        expect(lifeStageOf(yearsAgo(8), NOW_MS)).toBe('senior');
        expect(lifeStageOf(null, NOW_MS)).toBeNull();
    });
    it('matchesPreference: none/null = any; other = neither', () => {
        const pup = { species: 'dog', birthMs: yearsAgo(0.3) };
        expect(matchesPreference(pup, { species: 'dog', lifeStage: 'puppy' }, NOW_MS)).toBe(true);
        expect(matchesPreference(pup, { species: 'cat', lifeStage: null }, NOW_MS)).toBe(false);
        expect(matchesPreference(pup, { species: 'dog', lifeStage: 'senior' }, NOW_MS)).toBe(false);
        expect(matchesPreference(pup, { species: 'none', lifeStage: 'none' }, NOW_MS)).toBe(true);
        expect(matchesPreference(pup, { species: null, lifeStage: null }, NOW_MS)).toBe(true);
        expect(matchesPreference(pup, { species: 'other', lifeStage: null }, NOW_MS)).toBe(false);
        expect(matchesPreference({ species: 'rabbit', birthMs: null }, { species: 'other', lifeStage: null }, NOW_MS)).toBe(true);
        expect(matchesPreference({ species: 'dog', birthMs: null }, { species: null, lifeStage: 'puppy' }, NOW_MS)).toBe(false);
    });
    it('rankProposalAnimals: matches first, then by name', () => {
        const animals = [
            { name: 'Zoe', species: 'dog', birthMs: yearsAgo(0.2) },
            { name: 'Ana', species: 'cat', birthMs: yearsAgo(0.2) },
            { name: 'Bob', species: 'dog', birthMs: yearsAgo(0.2) },
            { name: null, species: 'dog', birthMs: yearsAgo(0.2) },
        ];
        const r = rankProposalAnimals(animals, { species: 'dog', lifeStage: 'puppy' }, NOW_MS);
        expect(r.map((a) => [a.name, a.matches])).toEqual([['Bob', true], ['Zoe', true], [null, true], ['Ana', false]]);
    });
});

describe('takesContract', () => {
    it('false only for an active adoption', () => {
        expect(takesContract({ adopterId: 'p', recordType: 'adoption' })).toBe(false);
        expect(takesContract({ adopterId: 'p', recordType: 'foster' })).toBe(true);
        expect(takesContract({ adopterId: null, recordType: 'available' })).toBe(true);
        expect(takesContract({ adopterId: null, recordType: 'adoption' })).toBe(true);
    });
});

describe('formNoticeUrl — where a form\'s bell notice leads', () => {
    const base = { submissionId: 's-1', applicationId: 'app-s-1', animalId: 'luna', animalInTeam: true, animalsOn: true };
    it('opens that application on «Con solicitudes por evaluar»', () => {
        expect(formNoticeUrl(base)).toBe('/my-animals?view=solicitudes&animal=luna&solicitud=app-s-1');
    });
    it('a general application (no animal, or an adopted one asked for) opens «Sin animal elegido»', () => {
        expect(formNoticeUrl({ ...base, animalId: null, animalInTeam: false })).toBe('/my-animals?view=solicitudes&animal=general&solicitud=app-s-1');
    });
    it('ids are encoded', () => {
        expect(formNoticeUrl({ ...base, animalId: 'a b&c', applicationId: 'app-x?y' })).toBe('/my-animals?view=solicitudes&animal=a%20b%26c&solicitud=app-x%3Fy');
    });
    it('the form itself when animals are off, no application was created, or the animal is another team\'s', () => {
        expect(formNoticeUrl({ ...base, animalsOn: false })).toBe('/form-results/s-1');
        expect(formNoticeUrl({ ...base, applicationId: null })).toBe('/form-results/s-1');
        expect(formNoticeUrl({ ...base, animalInTeam: false })).toBe('/form-results/s-1');
    });
});

describe('candidatesLostOnDelete', () => {
    it('counts only the open ones (to evaluate or contract sent); decided or closed ones are not lost', () => {
        const items = [
            { status: te }, { status: te }, { status: cs },
            { status: done }, { status: { kind: 'closed', reason: 'adopted_other' } as ApplicationStatus },
            { status: { kind: 'replaced' } as ApplicationStatus }, { status: { kind: 'adopted' } as ApplicationStatus },
        ];
        expect(candidatesLostOnDelete(items)).toBe(3);
        expect(candidatesLostOnDelete([])).toBe(0);
    });
});
