import { describe, it, expect } from 'vitest';
import { askedOwnersText } from './askedOwners';

const t = (k: string) => ({ 'adopter.asked_admins': 'los administradores', 'adopter.hh_list_and': 'y' } as Record<string, string>)[k] ?? k;

describe('askedOwnersText — who a «no» was sent to, said the same way on every screen', () => {
    it('no owner on either profile → the admins', () => {
        expect(askedOwnersText(t, [])).toBe('los administradores');
    });
    it('owners → their names, joined like every other list of names', () => {
        expect(askedOwnersText(t, ['Rescate Norte'])).toBe('Rescate Norte');
        expect(askedOwnersText(t, ['Rescate Norte', 'east'])).toContain('Rescate Norte');
        expect(askedOwnersText(t, ['Rescate Norte', 'east'])).toContain('east');
        expect(askedOwnersText(t, ['Rescate Norte', 'east'])).not.toContain(', ,');
    });
});
