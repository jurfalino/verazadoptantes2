import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// t() echoes the key so we can assert on labels.
vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));

import { StarRating } from './StarRating';

const noop = () => {};

// A rating is optional and never inferred (Jon, 2026-10-09): an input must show
// an explicit "not rated" state and always offer a way back to it.
describe('StarRating', () => {
    it('an empty input says "not rated" and fills no star', () => {
        const html = renderToStaticMarkup(<StarRating value={0} onChange={noop} showLabel />);
        expect(html).toContain('ratings.none');
        expect(html).not.toContain('ratings.clear');
        expect(html).not.toContain('aria-pressed="true"');
    });

    it('a rated input shows its label and a clear control', () => {
        const html = renderToStaticMarkup(<StarRating value={2} onChange={noop} showLabel />);
        expect(html).toContain('ratings.poor');
        expect(html).toContain('ratings.clear');
        expect(html).not.toContain('ratings.none');
        expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    });

    it('a read-only display never shows "not rated" or a clear control', () => {
        for (const value of [0, 3]) {
            const html = renderToStaticMarkup(<StarRating value={value} showLabel />);
            expect(html).not.toContain('ratings.none');
            expect(html).not.toContain('ratings.clear');
        }
    });

    // Every tap target is ≥44px (plan global constraint): the large input's stars keep their 32px
    // drawing inside a 44px button; the smaller sizes are unchanged.
    it('size lg: each star is a 44px button around a 32px star', () => {
        const html = renderToStaticMarkup(<StarRating value={0} onChange={noop} size="lg" />);
        const stars = html.split('<button').slice(1).filter(b => /aria-label="\d stars?"/.test(b));
        expect(stars).toHaveLength(5);
        for (const b of stars) {
            expect(b).toMatch(/\bmin-h-11\b/);
            expect(b).toMatch(/\bmin-w-11\b/);
            expect(b).toMatch(/<span class="[^"]*\bw-8 h-8\b/);
        }
    });

    it('sizes md / sm keep their star-sized buttons', () => {
        for (const size of ['md', 'sm'] as const) {
            const html = renderToStaticMarkup(<StarRating value={0} onChange={noop} size={size} />);
            expect(html).not.toContain('min-h-11');
        }
    });
});
