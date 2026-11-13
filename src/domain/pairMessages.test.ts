/**
 * «Te escribió» messages live on the pair (approved 2026-11-11): oldest first,
 * the viewer's own marked as theirs, names never emails.
 */
import { describe, it, expect } from 'vitest';
import { pairMessageViews } from './pairMessages';

const row = (id: string, sender: string, createdAt: number, senderName: string | null = null, body = `msg ${id}`) =>
    ({ id, senderEmail: sender, senderName, body, createdAt });

describe('pairMessageViews', () => {
    it('oldest first (ties by id); the viewer\'s own are «mine»', () => {
        const views = pairMessageViews([
            row('b', 'marta@x.org', 200, 'Marta Giménez'),
            row('a', 'Ana@X.org', 100, 'Ana'),
            row('c', 'ana@x.org', 200, 'Ana'),
        ], 'ana@x.org ');
        expect(views.map(v => [v.id, v.mine])).toEqual([['a', true], ['b', false], ['c', true]]);
        expect(views[1]).toEqual({ id: 'b', senderName: 'Marta Giménez', mine: false, body: 'msg b', createdAt: 200 });
    });

    it('no stored name: the email handle, never the address', () => {
        const [v] = pairMessageViews([row('a', 'marta.g@x.org', 1, '  ')], 'ana@x.org');
        expect(v.senderName).toBe('marta.g');
        expect(JSON.stringify(v)).not.toContain('@');
    });

    it('nothing stored: no messages', () => {
        expect(pairMessageViews([], 'ana@x.org')).toEqual([]);
    });
});
