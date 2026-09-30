import { describe, it, expect } from 'vitest';
import { dueWhen } from './dueWhen';

const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
const H = 3600000;
const D = 24 * H;

describe('dueWhen', () => {
    it('due right now is "today"', () => {
        expect(dueWhen(NOW, NOW)).toEqual({ kind: 'today' });
    });
    it('due earlier the same day (<24h) is "today"', () => {
        expect(dueWhen(NOW - 10 * H, NOW)).toEqual({ kind: 'today' });
        expect(dueWhen(NOW - 23 * H, NOW)).toEqual({ kind: 'today' });
    });
    it('due yesterday (24h+) is overdue by 1 day', () => {
        expect(dueWhen(NOW - D, NOW)).toEqual({ kind: 'overdue', days: 1 });
    });
    it('due 3 days ago is overdue by 3 days', () => {
        expect(dueWhen(NOW - 3 * D - H, NOW)).toEqual({ kind: 'overdue', days: 3 });
    });
    it('due in 3 days is future, never past tense', () => {
        expect(dueWhen(NOW + 3 * D, NOW)).toEqual({ kind: 'future' });
        expect(dueWhen(NOW + H, NOW)).toEqual({ kind: 'future' });
    });
});
