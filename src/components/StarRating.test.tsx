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
});
