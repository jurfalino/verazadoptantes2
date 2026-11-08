/**
 * /my-adopters rows' «Alertas» with the housemate chips (Jon, 2026-11-01):
 * after the person's own alerts and before their flags, as real links to the
 * profile at «Familiares / Convivientes».
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { AdopterFlags } from '@/types/adopter';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));

import { MyAdoptersFlagBadges, myAdoptersHouseholdHref } from './MyAdoptersFlagBadges';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const NO_FLAGS: AdopterFlags = { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null };
const HREF = '/adopter/x1?ref=my-adopters#profile-household-section';

describe('MyAdoptersFlagBadges — the housemate chips on a /my-adopters row', () => {
    it('both chips are links to the profile at «Familiares / Convivientes», between the own alerts and the flags', () => {
        const flags: AdopterFlags = { ...NO_FLAGS, duplicate: true, tooManyAdoptions: { count: 3, threshold: 3, periodDays: 90, actualSpanDays: 8 } };
        const html = renderToStaticMarkup(<MyAdoptersFlagBadges flags={flags} housemateAlert={{ lowRating: 2, hasAlerts: true }} adopterId="x1" personName="Lia Roca" t={t} />);
        expect(myAdoptersHouseholdHref('x1')).toBe(HREF);
        expect(html).toMatch(new RegExp(`<a [^>]*data-testid="my-adopters-housemate-alert-rating"[^>]*href="${HREF.replace(/[?]/g, '\\?')}"`));
        expect(html).toMatch(new RegExp(`<a [^>]*data-testid="my-adopters-housemate-alert-alerts"[^>]*href="${HREF.replace(/[?]/g, '\\?')}"`));
        expect(text(html)).toContain('Conviviente con calificación 2.0');
        expect(text(html)).toContain('Conviviente con alertas');
        const own = html.indexOf('data-alert="too_many_adoptions"');
        const low = html.indexOf('data-alert="housemate_low_rating"');
        const alerts = html.indexOf('data-alert="housemate_alerts"');
        const flag = html.indexOf('data-flag="duplicate"');
        expect(own).toBeGreaterThan(-1);
        expect(own).toBeLessThan(low);
        expect(low).toBeLessThan(alerts);
        expect(alerts).toBeLessThan(flag);
        // Nothing expands here: no list, no names, no button.
        expect(html).not.toContain('<button');
        expect(html).not.toContain('aria-expanded');
    });

    it("each chip's accessible name carries the ROW person's name after its words — never a housemate's", () => {
        const html = renderToStaticMarkup(<MyAdoptersFlagBadges flags={NO_FLAGS} housemateAlert={{ lowRating: 2, hasAlerts: true }} adopterId="x1" personName="Lia Roca" t={t} />);
        expect(html).toContain('aria-label="Conviviente con calificación 2.0 — Lia Roca"');
        expect(html).toContain('aria-label="Conviviente con alertas — Lia Roca"');
    });

    it('only a housemate chip → the chip, not the «—» of a row with nothing', () => {
        const html = renderToStaticMarkup(<MyAdoptersFlagBadges flags={NO_FLAGS} housemateAlert={{ lowRating: 1.4, hasAlerts: false }} adopterId="x1" personName="Lia Roca" t={t} />);
        expect(text(html)).toBe('Conviviente con calificación 1.4');
        expect(html).not.toContain('data-alert="housemate_alerts"');
        expect(html).not.toContain('>—<');
    });

    it('no housemate answer (none, or past the cap) → exactly the row as before', () => {
        for (const housemateAlert of [null, undefined]) {
            const html = renderToStaticMarkup(<MyAdoptersFlagBadges flags={NO_FLAGS} housemateAlert={housemateAlert} adopterId="x1" personName="Lia Roca" t={t} />);
            expect(text(html)).toBe('—');
            expect(html).not.toContain('housemate');
        }
    });
});
