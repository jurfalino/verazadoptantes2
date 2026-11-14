import { describe, it, expect } from 'vitest';
import { modalOpen, MODAL_SELECTOR } from './modalOpen';

describe('modalOpen — the chat bubble steps aside while a dialog is open (UX review S2)', () => {
    it('true when anything marked aria-modal is in the page', () => {
        const seen: string[] = [];
        const root = (found: boolean) => ({ querySelector: (sel: string) => { seen.push(sel); return found ? {} : null; } });
        expect(modalOpen(root(true))).toBe(true);
        expect(modalOpen(root(false))).toBe(false);
        expect(seen).toEqual([MODAL_SELECTOR, MODAL_SELECTOR]);
        expect(MODAL_SELECTOR).toBe('[aria-modal="true"]');
    });
});
