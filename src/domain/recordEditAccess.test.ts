import { describe, it, expect } from 'vitest';
import { canEditRecord, recordStoresIdentityCheck } from './recordEditAccess';

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
