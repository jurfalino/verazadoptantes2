import { describe, it, expect } from 'vitest';
import { FOCUSABLE, claimEscape, modalKeyAction, openDialogs, tabTrapTarget } from './dialogFocus';

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

/**
 * Pre-production review (2.58.4): the Modal's keydown ignored `defaultPrevented`,
 * so a menu inside a dialog that answers Escape / Tab itself would also close or
 * trap the dialog. Tested at this seam: the Modal's handler is modalKeyAction
 * plus focus calls, and the suite has no DOM environment.
 */
describe('modalKeyAction (what the dialog does with a keypress)', () => {
    const top = { isTop: true, busy: false };
    const key = (k: string, defaultPrevented = false) => ({ key: k, defaultPrevented });
    it('Escape closes it; Tab is kept inside it', () => {
        expect(modalKeyAction(key('Escape'), top)).toBe('close');
        expect(modalKeyAction(key('Tab'), top)).toBe('tab');
    });
    it('a key something inside the dialog already handled is not the dialog\'s: no close, no trap', () => {
        expect(modalKeyAction(key('Escape', true), top)).toBeNull();
        expect(modalKeyAction(key('Tab', true), top)).toBeNull();
    });
    it('busy: Escape does not close it (Tab is still kept inside)', () => {
        expect(modalKeyAction(key('Escape'), { isTop: true, busy: true })).toBeNull();
        expect(modalKeyAction(key('Tab'), { isTop: true, busy: true })).toBe('tab');
    });
    it('a dialog under another one answers nothing', () => {
        expect(modalKeyAction(key('Escape'), { isTop: false, busy: false })).toBeNull();
        expect(modalKeyAction(key('Tab'), { isTop: false, busy: false })).toBeNull();
    });
    it('other keys: nothing', () => expect(modalKeyAction(key('Enter'), top)).toBeNull());
});

describe('FOCUSABLE (the tab trap\'s stops)', () => {
    const parts = FOCUSABLE.split(',').map(p => p.trim());
    it('every selector leaves out tabindex="-1" — a link or button taken out of the tab order is never a stop', () => {
        for (const p of parts) expect(p, p).toMatch(/:not\(\[tabindex="-1"\]\)$/);
    });
    it('still covers links, enabled controls and explicit tabindex', () => {
        expect(parts.map(p => p.replace(/:not\(\[tabindex="-1"\]\)$/, ''))).toEqual([
            'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]',
        ]);
    });
});

describe('claimEscape (a menu inside a dialog: one Escape closes one layer)', () => {
    const key = (k: string) => {
        const e = { key: k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        return e;
    };
    it('the menu claims Escape first (capture), so the dialog that looks next leaves itself open', () => {
        const e = key('Escape');
        expect(claimEscape(e)).toBe(true);
        expect(modalKeyAction(e, { isTop: true, busy: false })).toBeNull();
    });
    it('with no menu open, nobody claims it and the dialog closes', () => {
        expect(modalKeyAction(key('Escape'), { isTop: true, busy: false })).toBe('close');
    });
    it('other keys are not claimed', () => {
        const e = key('Tab');
        expect(claimEscape(e)).toBe(false);
        expect(e.defaultPrevented).toBe(false);
    });
});
