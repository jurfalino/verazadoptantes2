import { describe, it, expect } from 'vitest';
import { activityOrigin, apiToolFromHistory, profileOrigin } from './recordOrigin';

describe('profileOrigin', () => {
    it('import, form, contract and API profiles get a tag; hand-made ones do not', () => {
        expect(profileOrigin('imported')).toEqual({ kind: 'imported' });
        expect(profileOrigin('form')).toEqual({ kind: 'form' });
        expect(profileOrigin('contract')).toEqual({ kind: 'contract' });
        expect(profileOrigin('api', 'Jotform')).toEqual({ kind: 'api', tool: 'Jotform' });
        expect(profileOrigin('manual')).toBeNull();
        expect(profileOrigin(null)).toBeNull();
    });
});

describe('activityOrigin', () => {
    it('API wins, then a form request, then a signed contract', () => {
        expect(activityOrigin({ apiTool: 'Jotform', sourceUrl: 'form:x' })).toEqual({ kind: 'api', tool: 'Jotform' });
        expect(activityOrigin({ sourceUrl: 'form:abc' })).toEqual({ kind: 'form' });
        expect(activityOrigin({ hasContract: 1 })).toEqual({ kind: 'contract' });
    });
    it('anything a rescuer typed has no tag', () => {
        expect(activityOrigin({ sourceUrl: 'https://facebook.com/x' })).toBeNull();
        expect(activityOrigin({})).toBeNull();
    });
});

describe('apiToolFromHistory', () => {
    it('reads the key name from the creation row only', () => {
        expect(apiToolFromHistory([
            { changedBy: 'api:Jotform', changes: '{"record_added_via_api":{}}' },
            { changedBy: 'api:Formulario web', changes: '{"created_via_api":{"keyName":"Formulario web"}}' },
        ])).toBe('Formulario web');
        expect(apiToolFromHistory([{ changedBy: 'ana@x.com', changes: '{}' }])).toBeNull();
    });
});
