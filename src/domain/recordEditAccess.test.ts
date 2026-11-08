import { describe, it, expect } from 'vitest';
import { canEditRecord, recordStoresIdentityCheck, recordHandoverFields, splitDeliveryAddress, joinDeliveryAddress } from './recordEditAccess';

describe('canEditRecord — the one rule behind the pencil and the save', () => {
    it('the author and the author\'s teammates can edit', () => {
        expect(canEditRecord({ viewer: 'ana@x.org', viewerIsAdmin: false, viewerIsAuthorOrTeammate: true })).toBe(true);
    });

    it('a rescuer outside the author\'s team cannot, even on a teammate\'s profile', () => {
        expect(canEditRecord({ viewer: 'ana@x.org', viewerIsAdmin: false, viewerIsAuthorOrTeammate: false })).toBe(false);
    });

    it('an admin can edit any record', () => {
        expect(canEditRecord({ viewer: 'root@x.org', viewerIsAdmin: true, viewerIsAuthorOrTeammate: false })).toBe(true);
    });

    it('nobody signed in: never', () => {
        expect(canEditRecord({ viewer: '', viewerIsAdmin: true, viewerIsAuthorOrTeammate: true })).toBe(false);
        expect(canEditRecord({ viewer: null, viewerIsAdmin: false, viewerIsAuthorOrTeammate: true })).toBe(false);
    });
});

describe('recordStoresIdentityCheck — where «¿Verificaste su identidad?» is saved', () => {
    it('placements (adoption, foster) store it', () => {
        expect(recordStoresIdentityCheck('adoption')).toBe(true);
        expect(recordStoresIdentityCheck('foster')).toBe(true);
    });

    it('events (follow-up, return, observation, request) do not', () => {
        for (const t of ['follow_up', 'returned_pet', 'observation', 'adoption_request', '', null, undefined]) {
            expect(recordStoresIdentityCheck(t)).toBe(false);
        }
    });
});

describe('recordHandoverFields — what a record asks about the handover (F3)', () => {
    it('an adoption and a «Tránsito» ask the same: delivered home + identity', () => {
        expect(recordHandoverFields('adoption')).toEqual({ deliveredToHome: true, identityCheck: true });
        expect(recordHandoverFields('foster')).toEqual({ deliveredToHome: true, identityCheck: true });
    });

    it('nothing else asks either (the record would not store it)', () => {
        for (const t of ['follow_up', 'returned_pet', 'observation', 'adoption_request', 'available', '', null, undefined]) {
            expect(recordHandoverFields(t)).toEqual({ deliveredToHome: false, identityCheck: false });
        }
    });
});

describe('splitDeliveryAddress / joinDeliveryAddress — the stored string ⇄ the two fields', () => {
    it('an old address typed on several lines keeps its parts (single-line fields would glue them)', () => {
        expect(splitDeliveryAddress('Calle 5\nPiso 2\nLanús')).toEqual({ streetAndNumber: 'Calle 5, Piso 2', locality: 'Lanús' });
    });
    it('street and locality split on the LAST comma (the locality is what masking keeps)', () => {
        expect(splitDeliveryAddress('Av. Maipú 1200, Vicente López')).toEqual({ streetAndNumber: 'Av. Maipú 1200', locality: 'Vicente López' });
        expect(splitDeliveryAddress('Calle 5 1234, depto 3, Vicente López')).toEqual({ streetAndNumber: 'Calle 5 1234, depto 3', locality: 'Vicente López' });
    });

    it('no comma: it is all street', () => {
        expect(splitDeliveryAddress('Av. Maipú 1200 Vicente López')).toEqual({ streetAndNumber: 'Av. Maipú 1200 Vicente López', locality: '' });
    });

    it('empty or missing: both empty', () => {
        expect(splitDeliveryAddress('')).toEqual({ streetAndNumber: '', locality: '' });
        expect(splitDeliveryAddress(null)).toEqual({ streetAndNumber: '', locality: '' });
        expect(splitDeliveryAddress('   ')).toEqual({ streetAndNumber: '', locality: '' });
    });

    it('a leading or trailing comma keeps every character of text', () => {
        expect(joinDeliveryAddress(splitDeliveryAddress(', Vicente López'))).toBe(', Vicente López');
        expect(joinDeliveryAddress(splitDeliveryAddress('Av. Maipú 1200,'))).toBe('Av. Maipú 1200,');
    });

    it('an old single-string address round-trips without losing text', () => {
        for (const old of [
            'Av. Maipú 1200, Vicente López',
            'Calle 5 1234, depto 3, Vicente López',
            'Av. Maipú 1200 Vicente López',
            'Ruta 8 km 50,Pilar',
            '  Av. Maipú 1200 ,  Vicente López  ',
            'Belgrano 55\nPB, Tigre',
        ]) {
            const back = joinDeliveryAddress(splitDeliveryAddress(old));
            // Same words in the same order; only the spacing around the comma may be tidied,
            // and a line break becomes a comma.
            expect(back.replace(/\s+/g, '')).toBe(old.replace(/\s*[\r\n]+\s*/g, ',').replace(/\s+/g, ''));
        }
    });

    it('join drops an empty half and trims', () => {
        expect(joinDeliveryAddress({ streetAndNumber: ' Av. Maipú 1200 ', locality: ' Vicente López ' })).toBe('Av. Maipú 1200, Vicente López');
        expect(joinDeliveryAddress({ streetAndNumber: '', locality: 'Vicente López' })).toBe('Vicente López');
        expect(joinDeliveryAddress({ streetAndNumber: 'Av. Maipú 1200', locality: '' })).toBe('Av. Maipú 1200');
        expect(joinDeliveryAddress({ streetAndNumber: '', locality: '' })).toBe('');
    });
});
