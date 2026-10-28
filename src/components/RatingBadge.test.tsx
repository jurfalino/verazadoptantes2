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
    it('pill and inline read the same: number · short word', () => {
        const pill = text(renderToStaticMarkup(<RatingBadge rating={4} size="md" label="short" />));
        const inline = text(renderToStaticMarkup(<RatingBadge rating={4} variant="inline" size="sm" label="short" />));
        expect(pill).toBe('4.0 · Bueno');
        expect(inline).toBe('4.0 · Bueno');
    });
    it('no label: just the number', () => {
        expect(text(renderToStaticMarkup(<RatingBadge rating={2.5} />))).toBe('2.5');
    });
    it('the old «search» label set is gone from every locale', async () => {
        const [{ en }, { pt }] = await Promise.all([import('@/i18n/locales/en'), import('@/i18n/locales/pt')]);
        for (const dict of [es, en, pt]) expect((dict as unknown as { ratings: Record<string, unknown> }).ratings.search_label).toBeUndefined();
    });
});
