import { describe, it, expect } from 'vitest';
import { canonField, planFieldSave, fieldAuthor } from './fieldCollab';

describe('canonField — same meaning, same string', () => {
    it('text: trimmed; "", null and undefined are the same', () => {
        expect(canonField('name', ' Carla ')).toBe(canonField('name', 'Carla'));
        expect(canonField('color', '')).toBe(canonField('color', null));
        expect(canonField('color', undefined)).toBe(canonField('color', null));
        expect(canonField('name', 'Carla')).not.toBe(canonField('name', 'carla'));
    });
    it('flags: true / 1 / "1" agree; null is 0', () => {
        expect(canonField('deliveredToHome', true)).toBe(canonField('deliveredToHome', 1));
        expect(canonField('deliveredToHome', null)).toBe(canonField('deliveredToHome', 0));
    });
    it('neutered: unknown (null) is NOT «sin castrar» (0)', () => {
        expect(canonField('neutered', null)).not.toBe(canonField('neutered', 0));
        expect(canonField('neutered', true)).toBe(canonField('neutered', 1));
    });
    it('dates: Date, seconds, ms and ISO all agree (to the second)', () => {
        const d = new Date('2026-05-01T12:00:00Z');
        const s = Math.floor(d.getTime() / 1000);
        expect(canonField('date', d)).toBe(canonField('date', s));
        expect(canonField('date', d.getTime())).toBe(canonField('date', s));
        expect(canonField('estimatedBirthDate', d.toISOString())).toBe(canonField('estimatedBirthDate', s));
        expect(canonField('date', null)).toBe(canonField('date', ''));
        expect(canonField('date', s)).not.toBe(canonField('date', s + 86400));
    });
    it('rating: numbers and numeric strings agree; empty is null', () => {
        expect(canonField('rating', '4')).toBe(canonField('rating', 4));
        expect(canonField('rating', '')).toBe(canonField('rating', null));
    });
});

describe('planFieldSave', () => {
    it('a stale tab that re-sends a field unchanged never reverts a teammate\'s edit to it', () => {
        const plan = planFieldSave(
            { name: 'Carla', familyMembers: 'Hijo' },                 // the stale tab sends everything
            { name: 'Carla', familyMembers: 'Hija' },                 // as it loaded it
            { name: 'Carla Gómez', familyMembers: 'Hija' },           // a teammate renamed meanwhile
        );
        expect(plan.changed).toEqual(['familyMembers']);
        expect(plan.apply).toEqual(['familyMembers']);
        expect(plan.updatedByOthers).toEqual(['name']);
    });
    it('same field changed by someone else → conflict; already equal → saved', () => {
        const plan = planFieldSave(
            { color: 'negro', sex: 'hembra' },
            { color: 'gris', sex: 'macho' },
            { color: 'blanco', sex: 'hembra' },
        );
        expect(plan.conflicts).toEqual(['color']);
        expect(plan.alreadySaved).toEqual(['sex']);
        expect(plan.apply).toEqual([]);
    });
    it('a field with no loaded value is applied as before (callers outside the check)', () => {
        expect(planFieldSave({ details: 'x' }, {}, { details: 'y' }).apply).toEqual(['details']);
    });
});

describe('fieldAuthor', () => {
    it('the newest row that changed the field, else null', () => {
        const rows = [{ by: 'beto', fields: ['color'] }, { by: 'ana', fields: ['name', 'color'] }];
        expect(fieldAuthor('color', rows)).toBe('beto');
        expect(fieldAuthor('name', rows)).toBe('ana');
        expect(fieldAuthor('sex', rows)).toBeNull();
    });
});
