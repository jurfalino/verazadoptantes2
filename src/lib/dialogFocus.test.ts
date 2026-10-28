import { describe, it, expect } from 'vitest';
import { openDialogs, tabTrapTarget } from './dialogFocus';

describe('tabTrapTarget (the dialog keeps Tab inside it)', () => {
    const items = ['close', 'cancel', 'confirm'];
    it('Tab on the last wraps to the first; Shift+Tab on the first wraps to the last', () => {
        expect(tabTrapTarget(items, 'confirm', false)).toBe('close');
        expect(tabTrapTarget(items, 'close', true)).toBe('confirm');
    });
    it('in between, the browser moves the focus', () => {
        expect(tabTrapTarget(items, 'cancel', false)).toBeNull();
        expect(tabTrapTarget(items, 'cancel', true)).toBeNull();
    });
    it('focus outside the dialog comes back in', () => {
        expect(tabTrapTarget(items, 'page-link', false)).toBe('close');
        expect(tabTrapTarget(items, null, true)).toBe('confirm');
    });
    it('nothing focusable: nothing to do', () => expect(tabTrapTarget([], 'x', false)).toBeNull());
});

describe('openDialogs (only the topmost dialog answers Escape and Tab)', () => {
    it('a dialog opened on top of another is the top until it closes', () => {
        const a = Symbol('a'); const b = Symbol('b');
        openDialogs.push(a); openDialogs.push(b);
        expect(openDialogs.isTop(b)).toBe(true);
        expect(openDialogs.isTop(a)).toBe(false);
        openDialogs.remove(b);
        expect(openDialogs.isTop(a)).toBe(true);
        openDialogs.remove(a);
    });
});
