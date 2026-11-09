/**
 * H3 — who took the viewer's access back, in words (Jon 2026-11-09): the
 * profile's own team reads «El responsable quitó tu acceso…»; an admin reads
 * «Un administrador quitó tu acceso…».
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: tFor(es as unknown as Record<string, unknown>), locale: 'es' }) }));
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: () => '3 nov' }) }));

import PiiAccessHistoryNote from './PiiAccessHistoryNote';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('PiiAccessHistoryNote — the revoke line', () => {
    it('the profile team took it back → «El responsable…»', () => {
        const html = renderToStaticMarkup(<PiiAccessHistoryNote history={{ denied: false, note: null, accessRevokedAt: 1, revokedByAdmin: false }} />);
        expect(text(html)).toBe('El responsable quitó tu acceso el 3 nov.');
    });

    it('an admin took it back → «Un administrador…»', () => {
        const html = renderToStaticMarkup(<PiiAccessHistoryNote history={{ denied: false, note: null, accessRevokedAt: 1, revokedByAdmin: true }} />);
        expect(text(html)).toBe('Un administrador quitó tu acceso el 3 nov.');
    });
});
