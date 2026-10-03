import { describe, it, expect } from 'vitest';
import { dueWhenText } from './dueWhenText';

const es: Record<string, string> = {
    'followups.due_today': 'vence hoy',
    'followups.overdue_day_one': 'venció hace 1 día',
    'followups.overdue_days': 'venció hace {days} días',
    'followups.vence_el': 'vence el',
};
const t = (k: string) => es[k] ?? '';
const NOW = Date.UTC(2026, 8, 30, 15);
const D = 86400000;

describe('dueWhenText', () => {
    it('today', () => expect(dueWhenText(t, NOW - 3600000, NOW)).toBe('vence hoy'));
    it('1 day is singular', () => expect(dueWhenText(t, NOW - D, NOW)).toBe('venció hace 1 día'));
    it('3 days is plural', () => expect(dueWhenText(t, NOW - 3 * D, NOW)).toBe('venció hace 3 días'));
    it('future uses the date', () => expect(dueWhenText(t, NOW + D, NOW, () => '1 oct')).toBe('vence el 1 oct'));
});
