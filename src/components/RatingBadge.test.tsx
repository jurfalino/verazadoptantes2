/**
 * Audit B1: one rating rendering — the profile header pill, household rows,
 * card household lines, search cards and the picker all read «★ 4.0 · Bueno»:
 * one separator, one label set (the short word; no «Buen Adoptante» variant).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: tFor(es as unknown as Record<string, unknown>) }) }));

import { RatingBadge } from './RatingBadge';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('RatingBadge', () => {
    it('one look: the pill «★ 4.0 · Bueno», the AlertPill sm box', () => {
        const html = renderToStaticMarkup(<RatingBadge rating={4} />);
        expect(text(html)).toBe('4.0 · Bueno');
        expect(html).toContain('data-testid="rating-value"');
        for (const cls of ['rounded-full', 'border', 'px-2', 'py-0.5', 'text-[11px]', 'leading-4']) expect(html).toContain(cls);
    });
    it('a decimal keeps one decimal and the word', () => {
        expect(text(renderToStaticMarkup(<RatingBadge rating={2.5} />))).toBe('2.5 · Regular');
    });
    it('unrated (null, 0, out of range): the neutral «Sin calificación» pill, same box', () => {
        for (const r of [null, undefined, 0, '', 7]) {
            const html = renderToStaticMarkup(<RatingBadge rating={r as number | null} />);
            expect(text(html)).toBe('Sin calificación');
            expect(html).toContain('data-testid="person-unrated"');
            for (const cls of ['rounded-full', 'border', 'px-2', 'py-0.5', 'text-[11px]', 'leading-4']) expect(html).toContain(cls);
        }
    });
    it('the old «search» label set is gone from every locale', async () => {
        const [{ en }, { pt }] = await Promise.all([import('@/i18n/locales/en'), import('@/i18n/locales/pt')]);
        for (const dict of [es, en, pt]) expect((dict as unknown as { ratings: Record<string, unknown> }).ratings.search_label).toBeUndefined();
    });
});
