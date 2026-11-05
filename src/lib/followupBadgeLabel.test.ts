import { describe, expect, it } from 'vitest';
import { followupBadgeLabel } from './followupBadgeLabel';

const strings: Record<string, string> = {
    'followups.health_neuter': 'Castración (≈6 meses de edad)',
    'followups.health_neuter_short': 'Castración',
    'followups.health_vaccines': 'Plan de vacunas (cachorro)',
};
// Like the app's t(): the raw key path when a string is missing.
const t = (k: string) => strings[k] ?? k;
const DAY = 86_400_000;
const now = 100 * DAY;

describe('followupBadgeLabel short', () => {
    it('uses the _short wording on the homepage row', () => {
        const label = followupBadgeLabel(t, 1, { copyKey: 'health_neuter', dueDate: now + DAY }, now, { short: true });
        expect(label.startsWith('Castración · ')).toBe(true);
    });
    it('keeps the full wording when there is no _short string', () => {
        const label = followupBadgeLabel(t, 1, { copyKey: 'health_vaccines', dueDate: now + DAY }, now, { short: true });
        expect(label.startsWith('Plan de vacunas (cachorro) · ')).toBe(true);
    });
    it('keeps the full wording by default (/my-animals)', () => {
        const label = followupBadgeLabel(t, 1, { copyKey: 'health_neuter', dueDate: now + DAY }, now);
        expect(label.startsWith('Castración (≈6 meses de edad) · ')).toBe(true);
    });
});
