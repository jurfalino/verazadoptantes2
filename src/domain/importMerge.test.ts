import { describe, it, expect } from 'vitest';
import { planRecordMerge, isExactIdentifierMatch, type PlanRecordMergeInput } from './importMerge';

const base: PlanRecordMergeInput = {
    existingName: 'Ana Pérez',
    existingEntries: [{ type: 'phone', value: '11 4796-3445' }, { type: 'email', value: 'ana@mail.com' }],
    existingActivities: [{ recordType: 'observation', date: '2015-03-10', details: 'Maltrato' }],
    incomingName: 'Ana Pérez',
    incomingEntries: [],
    incomingActivity: { recordType: 'observation', date: '2016-01-01', details: 'Nueva denuncia' },
};

describe('planRecordMerge — contacts', () => {
    it('adds only contacts the existing record lacks', () => {
        const p = planRecordMerge({ ...base, incomingEntries: [
            { type: 'phone', value: '011-4796-3445' }, // same number, different formatting → skip
            { type: 'email', value: 'ANA@mail.com' },   // same email (case) → skip
            { type: 'social', value: 'fb.com/ana' },    // new → add
        ] });
        expect(p.contactsToAdd.map(c => c.type)).toEqual(['social']);
    });
    it('matches phones by last-8 digits (area-code agnostic)', () => {
        const p = planRecordMerge({ ...base, incomingEntries: [{ type: 'phone', value: '4796-3445' }] });
        expect(p.contactsToAdd).toEqual([]);
    });
    it('dedups within the incoming list too', () => {
        const p = planRecordMerge({ ...base, existingEntries: [], incomingEntries: [
            { type: 'email', value: 'x@y.com' }, { type: 'email', value: 'x@y.com' },
        ] });
        expect(p.contactsToAdd).toHaveLength(1);
    });
});

describe('planRecordMerge — activity (idempotent re-import)', () => {
    it('adds a genuinely new activity', () => {
        expect(planRecordMerge(base).addActivity).toBe(true);
    });
    it('skips an activity equivalent to one already present', () => {
        const p = planRecordMerge({ ...base, incomingActivity: { recordType: 'observation', date: '2015-03-10', details: 'maltrato' } });
        expect(p.addActivity).toBe(false); // same type + date + normalized details
    });
    it('is idempotent for DATELESS activities (both empty date) — key to VANA re-import', () => {
        // Create + upsert paths both store null date now, so a dateless row's
        // activity must dedup against itself on re-import (same type + '' + details).
        const existingActivities = [{ recordType: 'observation', date: '', details: 'Acumulación' }];
        const incomingActivity = { recordType: 'observation', date: '', details: 'acumulación' };
        expect(planRecordMerge({ ...base, existingActivities, incomingActivity }).addActivity).toBe(false);
        // A different dateless observation is still added.
        expect(planRecordMerge({ ...base, existingActivities, incomingActivity: { recordType: 'observation', date: '', details: 'otra cosa' } }).addActivity).toBe(true);
    });
});

describe('planRecordMerge — name', () => {
    it("fills the name when the existing record is nameless", () => {
        const p = planRecordMerge({ ...base, existingName: '', incomingName: 'Nuevo Nombre' });
        expect(p.nameAction).toBe('fill');
        expect(p.nameValue).toBe('Nuevo Nombre');
    });
    it('adds the incoming name as an alias when the existing name differs', () => {
        const p = planRecordMerge({ ...base, existingName: 'Ana Pérez', incomingName: 'Ana Gómez' });
        expect(p.nameAction).toBe('alias');
        expect(p.nameValue).toBe('Ana Gómez');
    });
    it('does nothing when the name is absent or the same (accent/case-insensitive)', () => {
        expect(planRecordMerge({ ...base, incomingName: '' }).nameAction).toBe('none');
        expect(planRecordMerge({ ...base, existingName: 'Ana Perez', incomingName: 'ANA PÉREZ' }).nameAction).toBe('none');
    });
});

describe('isExactIdentifierMatch', () => {
    it('true for phone/email/id/social/phone_suffix', () => {
        expect(isExactIdentifierMatch(['name_word', 'phone'])).toBe(true);
        expect(isExactIdentifierMatch(['email'])).toBe(true);
        expect(isExactIdentifierMatch(['id_number'])).toBe(true);
        expect(isExactIdentifierMatch(['phone_suffix'])).toBe(true);
    });
    it('false for name-only or address-only overlap (must be reviewed)', () => {
        expect(isExactIdentifierMatch(['name_word'])).toBe(false);
        expect(isExactIdentifierMatch(['name_word_fuzzy'])).toBe(false);
        expect(isExactIdentifierMatch(['address_word'])).toBe(false);
        expect(isExactIdentifierMatch([])).toBe(false);
        expect(isExactIdentifierMatch(null)).toBe(false);
    });
});
