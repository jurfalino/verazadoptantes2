import { describe, it, expect } from 'vitest';
import { myAnimalsTabCount } from './myAnimalsTabCount';

/**
 * The number in "Disponibles (N)" / "Ya Adoptados (N)". The list the page
 * holds belongs to `loadedView`; right after a tab switch it is still the
 * PREVIOUS tab's list, so its length must not be shown for the new tab.
 */
describe('myAnimalsTabCount', () => {
    const counts = { available: 7, adopted: 12 };

    it('the tab whose list is loaded shows that list length', () => {
        expect(myAnimalsTabCount('available', 'available', 'available', 5, counts)).toBe(5);
    });

    it('the inactive tab shows its count', () => {
        expect(myAnimalsTabCount('adopted', 'available', 'available', 5, counts)).toBe(12);
    });

    it('while a tab switch loads, the new tab shows its count, not the old list length', () => {
        // view switched to adopted; animals are still the available list (5)
        expect(myAnimalsTabCount('adopted', 'adopted', 'available', 5, counts)).toBe(12);
        expect(myAnimalsTabCount('available', 'adopted', 'available', 5, counts)).toBe(7);
    });

    it('shows "..." when nothing is known yet', () => {
        expect(myAnimalsTabCount('adopted', 'adopted', null, 0, null)).toBe('...');
        expect(myAnimalsTabCount('adopted', 'available', 'available', 3, null)).toBe('...');
    });
});
