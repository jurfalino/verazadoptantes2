import { describe, it, expect } from 'vitest';
import {
    computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings,
    getMessageTemplate, addDays, DEFAULT_SCHEDULE, DEFAULT_MESSAGES,
    type RecordedFollowup, type ComputeFollowupsInput,
} from './followups';

const ADOPTED = new Date('2026-06-01T12:00:00Z');
const day = (n: number) => addDays(ADOPTED, n);

function compute(overrides: Partial<ComputeFollowupsInput> = {}) {
    return computeFollowups({
        placementStartedAt: ADOPTED,
        animal: { estimatedBirthDate: null, neutered: null },
        schedule: DEFAULT_SCHEDULE,
        recorded: [],
        now: day(0),
        ...overrides,
    });
}

const rec = (o: Partial<RecordedFollowup>): RecordedFollowup => ({
    id: 'r1', date: null, followupKey: null, subtype: null, eventType: 'follow_up', ...o,
});

describe('computeFollowups — status boundary math', () => {
    it('projects the three default check-ins for an adult animal (no birthdate → health omitted)', () => {
        const slots = compute();
        expect(slots.map(s => s.key)).toEqual(['checkin_7d', 'checkin_30d', 'checkin_180d']);
        expect(slots.every(s => s.status === 'upcoming')).toBe(true);
    });

    it('upcoming before due, due on the due day, due at window end, missed past it', () => {
        expect(compute({ now: day(6) })[0].status).toBe('upcoming');
        expect(compute({ now: day(7) })[0].status).toBe('due');
        expect(compute({ now: day(14) })[0].status).toBe('due');       // 7d + 7 window
        expect(compute({ now: addDays(ADOPTED, 14.01) })[0].status).toBe('missed');
    });

    it('cold-start guard: a 60-day-old adoption has 7d/30d missed, never due', () => {
        const slots = compute({ now: day(60) });
        expect(slots.find(s => s.key === 'checkin_7d')!.status).toBe('missed');
        expect(slots.find(s => s.key === 'checkin_30d')!.status).toBe('missed'); // 30+21=51 < 60
        expect(slots.find(s => s.key === 'checkin_180d')!.status).toBe('upcoming');
    });
});

describe('computeFollowups — health applicability', () => {
    const puppy = { estimatedBirthDate: addDays(ADOPTED, -120), neutered: 0 }; // 4 months at adoption

    it('vaccines project for a young animal, due shortly after adoption', () => {
        const slots = compute({ animal: puppy });
        const vacc = slots.find(s => s.key === 'health_vaccines')!;
        expect(vacc.dueDate.getTime()).toBe(day(3).getTime());
        expect(vacc.subtype).toBe('vaccination');
    });

    it('vaccines omitted for an adult (adopted at 8+ months)', () => {
        const slots = compute({ animal: { estimatedBirthDate: addDays(ADOPTED, -400), neutered: 0 } });
        expect(slots.find(s => s.key === 'health_vaccines')).toBeUndefined();
    });

    it('neuter is due from the BIRTH date (+150d), not the adoption date', () => {
        const slots = compute({ animal: puppy });
        const neuter = slots.find(s => s.key === 'health_neuter')!;
        expect(neuter.dueDate.getTime()).toBe(addDays(puppy.estimatedBirthDate, 150).getTime());
    });

    it('neutered=1 resolves the neuter slot as done via the flag', () => {
        const slots = compute({ animal: { ...puppy, neutered: 1 }, now: day(40) });
        expect(slots.find(s => s.key === 'health_neuter')!.status).toBe('done');
    });
});

describe('computeFollowups — matching', () => {
    it('exact followupKey beats the date heuristic', () => {
        const recorded = [
            rec({ id: 'near', date: day(7), eventType: 'follow_up' }),
            rec({ id: 'keyed', date: day(13), followupKey: 'checkin_7d' }),
        ];
        const slots = compute({ recorded, now: day(20) });
        expect(slots.find(s => s.key === 'checkin_7d')!.satisfiedById).toBe('keyed');
    });

    it('greedy one-record-one-slot: a single unkeyed follow-up satisfies only the nearest slot', () => {
        const recorded = [rec({ id: 'only', date: day(8) })];
        const slots = compute({ recorded, now: day(60) });
        expect(slots.find(s => s.key === 'checkin_7d')!.satisfiedById).toBe('only');
        expect(slots.find(s => s.key === 'checkin_30d')!.satisfiedById).toBeUndefined();
    });

    it('a record far from every slot satisfies nothing', () => {
        const recorded = [rec({ id: 'stray', date: day(75) })];
        const slots = compute({ recorded, now: day(75) });
        expect(slots.every(s => s.satisfiedById === undefined)).toBe(true);
    });

    it('a record with an ORPHANED key (schedule was re-timed) re-enters the heuristic', () => {
        const recorded = [rec({ id: 'orphan', date: day(8), followupKey: 'checkin_10d' })];
        const slots = compute({ recorded, now: day(20) });
        expect(slots.find(s => s.key === 'checkin_7d')!.satisfiedById).toBe('orphan');
    });

    it('vaccines look back 33 days: a dose given before the adoption counts', () => {
        const puppy = { estimatedBirthDate: addDays(ADOPTED, -120), neutered: 0 };
        const recorded = [rec({ id: 'pre', date: day(-20), eventType: 'vaccination' })];
        const slots = compute({ animal: puppy, recorded, now: day(10) });
        expect(slots.find(s => s.key === 'health_vaccines')!.status).toBe('done');
    });

    it('a follow_up with a health subtype satisfies its health milestone but not a check-in', () => {
        const puppy = { estimatedBirthDate: addDays(ADOPTED, -120), neutered: 0 };
        const recorded = [rec({ id: 'hf', date: day(4), subtype: 'vaccination' })];
        const slots = compute({ animal: puppy, recorded, now: day(10) });
        expect(slots.find(s => s.key === 'health_vaccines')!.satisfiedById).toBe('hf');
        expect(slots.find(s => s.key === 'checkin_7d')!.satisfiedById).toBeUndefined();
    });
});

describe('computeFollowups — foster series', () => {
    it('projects the past occurrences plus only the next one', () => {
        const slots = compute({ placementType: 'foster', now: day(70) });
        expect(slots.map(s => s.key)).toEqual(['foster_checkin_m1', 'foster_checkin_m2', 'foster_checkin_m3']);
        expect(slots[0].status).toBe('missed');   // day 30, window ended day 44
        expect(slots[1].status).toBe('due');      // day 60, window until day 74
        expect(slots[2].status).toBe('upcoming'); // day 90
    });

    it('disabled foster rule projects nothing', () => {
        const slots = compute({ placementType: 'foster', fosterRule: { intervalDays: 30, windowDays: 14, disabled: true }, now: day(70) });
        expect(slots).toEqual([]);
    });
});

describe('mergeSchedule / mergeFosterRule / settings parse', () => {
    it('checkins replacement uses deterministic keys and keeps health entries', () => {
        const merged = mergeSchedule(DEFAULT_SCHEDULE, { version: 1, checkins: [{ offsetDays: 60 }, { offsetDays: 14 }] });
        expect(merged.filter(e => e.kind === 'checkin').map(e => e.key)).toEqual(['checkin_14d', 'checkin_60d']);
        expect(merged.some(e => e.key === 'health_vaccines')).toBe(true);
    });

    it('a custom offset matching a default inherits ITS window', () => {
        const merged = mergeSchedule(DEFAULT_SCHEDULE, { version: 1, checkins: [{ offsetDays: 30 }, { offsetDays: 45 }] });
        expect(merged.find(e => e.key === 'checkin_30d')!.windowDays).toBe(21);
        expect(merged.find(e => e.key === 'checkin_45d')!.windowDays).toBe(14);
    });

    it('disabledKeys removes entries (incl. health)', () => {
        const merged = mergeSchedule(DEFAULT_SCHEDULE, { version: 1, disabledKeys: ['health_neuter', 'checkin_180d'] });
        expect(merged.map(e => e.key)).toEqual(['checkin_7d', 'checkin_30d', 'health_vaccines']);
    });

    it('parseFollowupSettings tolerates garbage and legacy shapes', () => {
        expect(parseFollowupSettings(null)).toBeNull();
        expect(parseFollowupSettings('not json')).toBeNull();
        expect(parseFollowupSettings('{"version":2}')).toBeNull();
        expect(parseFollowupSettings('{"version":1,"checkins":[{"offsetDays":"x"},{"offsetDays":10}]}'))
            .toEqual({ version: 1, checkins: [{ offsetDays: 10 }] });
    });

    it('foster rule merges interval + disabled flag', () => {
        expect(mergeFosterRule(null)).toEqual({ intervalDays: 30, windowDays: 14, disabled: false });
        expect(mergeFosterRule({ version: 1, fosterIntervalDays: 45, disabledKeys: ['foster_checkin'] }))
            .toEqual({ intervalDays: 45, windowDays: 14, disabled: true });
    });

    it('message templates fall back per subtype', () => {
        expect(getMessageTemplate('adaptation', null)).toBe(DEFAULT_MESSAGES.adaptation);
        expect(getMessageTemplate('neuter', { version: 1, messages: { neuter: 'custom' } })).toBe('custom');
        expect(getMessageTemplate('adaptation', { version: 1, messages: { neuter: 'custom' } })).toBe(DEFAULT_MESSAGES.adaptation);
    });
});
