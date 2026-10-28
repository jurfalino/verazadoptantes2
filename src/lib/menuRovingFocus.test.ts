import { describe, expect, it } from 'vitest';
import { rovingTarget } from './menuRovingFocus';

describe('rovingTarget — which menu item an arrow key moves to', () => {
    it('ArrowDown / ArrowUp step through the items and wrap around', () => {
        expect(rovingTarget('ArrowDown', 0, 3)).toBe(1);
        expect(rovingTarget('ArrowDown', 2, 3)).toBe(0);
        expect(rovingTarget('ArrowUp', 0, 3)).toBe(2);
        expect(rovingTarget('ArrowUp', 2, 3)).toBe(1);
    });
    it('Home / End go to the first and last item', () => {
        expect(rovingTarget('Home', 2, 4)).toBe(0);
        expect(rovingTarget('End', 0, 4)).toBe(3);
    });
    it('with the focus on no item (the panel itself), ArrowDown takes the first and ArrowUp the last', () => {
        expect(rovingTarget('ArrowDown', -1, 3)).toBe(0);
        expect(rovingTarget('ArrowUp', -1, 3)).toBe(2);
    });
    it('any other key (Tab is the menu\'s close) and an empty menu: no move', () => {
        expect(rovingTarget('Tab', 0, 3)).toBeNull();
        expect(rovingTarget('Enter', 0, 3)).toBeNull();
        expect(rovingTarget('ArrowDown', -1, 0)).toBeNull();
    });
});
