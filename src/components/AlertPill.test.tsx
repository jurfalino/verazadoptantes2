/**
 * Flags are not alerts (Jon, 2026-11-01): a rescuer's report («Duplicado») is a
 * neutral grey outlined chip with a flag icon, by its own name — never the
 * alert colours, never counted as «N alertas» — and «Inexacto» is never drawn
 * on a rescuer-facing surface (rescuerFlagKinds). Alerts keep their pill.
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

import { AlertPill, AlertSummary, PeriodAlertPills } from './AlertPill';
import { MatchCardHeader } from './MatchCardParts';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('AlertSummary — the flags on a person', () => {
    it('«Duplicado» by name, neutral and outlined with the flag icon; «Inexacto» never; no «N alertas»', () => {
        const html = renderToStaticMarkup(<AlertSummary kinds={['inaccurate', 'duplicate']} testId="x-alerts" />);
        expect(text(html)).toBe('Duplicado');
        expect(html).toContain('data-alert="duplicate"');
        expect(html).not.toContain('data-alert="inaccurate"');
        expect(text(html)).not.toContain('Inexacto');
        expect(text(html)).not.toMatch(/alertas/);
        expect(html).toContain('lucide-flag');
        expect(html).toContain('background:transparent');
        expect(html).not.toContain('--status-');
    });

    it('only «Inexacto»: nothing at all', () => {
        expect(renderToStaticMarkup(<AlertSummary kinds={['inaccurate']} />)).toBe('');
        expect(renderToStaticMarkup(<AlertSummary kinds={[]} />)).toBe('');
    });

    it('an alert keeps its status pill', () => {
        const html = renderToStaticMarkup(<PeriodAlertPills alerts={{ tooManyAdoptions: { count: 3, threshold: 3, periodDays: 10, actualSpanDays: 10 }, tooManyRequests: null }} />);
        expect(html).toContain('var(--status-warning-bg)');
        expect(html).not.toContain('lucide-flag');
        // A flag kind drawn directly is the neutral chip too (the profile header's «Duplicado» button).
        expect(renderToStaticMarkup(<AlertPill kind="duplicate" size="md" onClick={() => {}}>Duplicado</AlertPill>)).not.toContain('--status-');
    });
});

describe('a match card — no «Inexacto» chip', () => {
    it('a person with an inaccuracy report and an open duplicate: «Duplicado» only, never «2 alertas»', () => {
        const html = renderToStaticMarkup(<MatchCardHeader person={{ id: 'p1', name: 'Jonatan Urfalino', rating: 5, openAlerts: ['inaccurate', 'duplicate'] }} />);
        expect(html).toContain('data-testid="match-card-head-alerts"');
        expect(html).not.toContain('data-alert="inaccurate"');
        expect(text(html)).not.toContain('Inexacto');
        expect(text(html)).not.toMatch(/\d+ alertas/);
        expect(text(html)).toContain('Duplicado');
    });

    it('only an inaccuracy report: no flag chip at all', () => {
        const html = renderToStaticMarkup(<MatchCardHeader person={{ id: 'p1', name: 'Jonatan Urfalino', rating: 5, openAlerts: ['inaccurate'] }} />);
        expect(html).not.toContain('data-testid="match-card-head-alerts"');
        expect(html).not.toContain('data-alert=');
    });
});
