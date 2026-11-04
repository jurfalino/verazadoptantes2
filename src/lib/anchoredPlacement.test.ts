import { describe, expect, it } from 'vitest';
import { placeAnchoredPanel } from './anchoredPlacement';

const rect = (top: number, left: number, w = 44, h = 44) => ({ top, left, right: left + w, bottom: top + h, width: w, height: h });
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

describe('placeAnchoredPanel', () => {
    it('opens below the button, right edges aligned, when there is room', () => {
        const p = placeAnchoredPanel({ anchor: rect(200, 1000), panel: { width: 256, height: 180 }, viewport: DESK });
        expect(p.placement).toBe('below');
        expect(p.top).toBe(244 + 8);
        expect(p.left).toBe(1044 - 256);
        expect(p.maxHeight).toBeNull();
    });

    it('flips above when the panel would run past the bottom of the screen (the last member of a household)', () => {
        const p = placeAnchoredPanel({ anchor: rect(700, 330), panel: { width: 256, height: 220 }, viewport: PHONE });
        expect(p.placement).toBe('above');
        expect(p.top).toBe(700 - 8 - 220);
        expect(p.top + 220).toBeLessThanOrEqual(700);
        expect(p.maxHeight).toBeNull();
    });

    it('keeps a 16px gutter at 390: a right-aligned panel wider than the space to its left is pushed in', () => {
        const p = placeAnchoredPanel({ anchor: rect(200, 100), panel: { width: 256, height: 100 }, viewport: PHONE });
        expect(p.left).toBe(16);
        const q = placeAnchoredPanel({ anchor: rect(200, 300), panel: { width: 256, height: 100 }, viewport: PHONE, align: 'left' });
        expect(q.left).toBe(390 - 16 - 256);
    });

    it('left-aligned panels start at the button', () => {
        const p = placeAnchoredPanel({ anchor: rect(200, 40), panel: { width: 256, height: 100 }, viewport: PHONE, align: 'left' });
        expect(p.left).toBe(40);
    });

    it('never tucks under the 64px sticky nav when flipped', () => {
        const p = placeAnchoredPanel({ anchor: rect(150, 300), panel: { width: 200, height: 500 }, viewport: { width: 390, height: 600 } });
        // 600-194-8-16 = 382 below vs 150-8-64 = 78 above: below wins, capped.
        expect(p.placement).toBe('below');
        expect(p.maxHeight).toBe(600 - 194 - 8 - 16);
        const q = placeAnchoredPanel({ anchor: rect(500, 300), panel: { width: 200, height: 500 }, viewport: { width: 390, height: 600 } });
        expect(q.placement).toBe('above');
        expect(q.top).toBe(64);
        expect(q.maxHeight).toBe(500 - 8 - 64);
    });

    it('a panel wider than the screen is clamped to the gutter', () => {
        const p = placeAnchoredPanel({ anchor: rect(100, 300), panel: { width: 500, height: 100 }, viewport: PHONE });
        expect(p.left).toBe(16);
    });

    it('a «below» panel never slides under the sticky nav when its button scrolls up behind it', () => {
        // The ⋯ has scrolled to y=0 (under the 64px nav): the panel stays at the nav's edge.
        const p = placeAnchoredPanel({ anchor: rect(0, 300), panel: { width: 200, height: 180 }, viewport: PHONE });
        expect(p.placement).toBe('below');
        expect(p.top).toBeGreaterThanOrEqual(64);
        expect(p.maxHeight).toBeNull();
        // Scrolled further (the button above the screen): still at the nav's edge, height capped to the room left.
        const q = placeAnchoredPanel({ anchor: rect(-300, 300), panel: { width: 200, height: 900 }, viewport: PHONE });
        expect(q.top).toBe(64);
        expect(q.top + (q.maxHeight ?? 900)).toBeLessThanOrEqual(844 - 16);
    });
});
