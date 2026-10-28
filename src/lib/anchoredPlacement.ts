/**
 * Where a small menu opened from a button goes (AnchoredMenu): fixed
 * coordinates on the screen, below the button when it fits, else above it,
 * else on the roomier side with a capped height (it scrolls). Aligned to the
 * button's right edge (a row's «⋯») or left edge («+ Agregar»), never closer
 * than `gutter` to a screen edge and never under the sticky nav (`topInset`),
 * whichever way it opens — even once its button has scrolled up behind the nav.
 * Pure: rects in, coordinates out.
 */

export type AnchorRect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type AnchoredPlacement = {
    top: number;
    left: number;
    placement: 'below' | 'above';
    /** Set only when the panel fits on neither side: it scrolls within this height. */
    maxHeight: number | null;
};

export function placeAnchoredPanel({ anchor, panel, viewport, align = 'right', gap = 8, gutter = 16, topInset = 64 }: {
    anchor: AnchorRect;
    panel: { width: number; height: number };
    viewport: { width: number; height: number };
    align?: 'left' | 'right';
    gap?: number;
    gutter?: number;
    /** The sticky nav's height: a panel opening upward stops below it. */
    topInset?: number;
}): AnchoredPlacement {
    // A «below» panel starts under the button, but never under the sticky nav:
    // a button scrolled up behind the nav (the panel follows it on scroll)
    // keeps its panel at the nav's edge instead of sliding beneath it.
    const belowTop = Math.max(anchor.bottom + gap, topInset);
    const below = viewport.height - belowTop - gutter;
    const above = anchor.top - gap - topInset;

    let placement: 'below' | 'above';
    let maxHeight: number | null = null;
    if (panel.height <= below) placement = 'below';
    else if (panel.height <= above) placement = 'above';
    else {
        placement = below >= above ? 'below' : 'above';
        maxHeight = Math.max(0, placement === 'below' ? below : above);
    }
    const height = maxHeight ?? panel.height;
    const top = placement === 'below' ? belowTop : anchor.top - gap - height;

    const wanted = align === 'right' ? anchor.right - panel.width : anchor.left;
    const maxLeft = viewport.width - gutter - panel.width;
    const left = Math.max(gutter, Math.min(wanted, maxLeft));

    return { top, left, placement, maxHeight };
}
