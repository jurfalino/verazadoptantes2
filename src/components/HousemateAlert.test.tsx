/**
 * The housemate alert chips (Jon, 2026-11-01): «Conviviente con calificación
 * {rating}» and «Conviviente con alertas» — alerts in the card's own alert row,
 * opening the list of everyone in the person's homes.
 */
import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import { NO_PERIOD_ALERTS, type PeriodAlert } from '@/domain/periodAlerts';
import { housemateAlertSummary, type CardHousehold, type HouseholdLine } from '@/domain/households';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));

import { HousemateAlert, HousemateAlertChips, HousemateList, hasHousemateAlert } from './HousemateAlert';
import { MatchCardHeader } from './MatchCardParts';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const alert = (count: number): PeriodAlert => ({ count, threshold: 3, periodDays: 90, actualSpanDays: 10 });
const line = (profileId: string, name: string, over: Partial<HouseholdLine> = {}): HouseholdLine =>
    ({ name, profileId, rating: null, openAlerts: [], alerts: NO_PERIOD_ALERTS, isMinor: false, isGift: false, householdId: 'h1', ...over });

/** A card's homes as the server sends them: the chips' answers from these lines (the list is all of them). */
const home = (lines: HouseholdLine[], more = 0): CardHousehold => ({ lines, more, alert: housemateAlertSummary(lines) });

const julian = line('j', 'Julián Urfalino', { rating: 2 });
const pedro = line('p', 'Pedro Paez', { rating: 1.5, householdId: 'h2' });
const ana = line('a', 'Ana Gil', { rating: 4, openAlerts: ['duplicate'], alerts: { tooManyAdoptions: alert(5), tooManyRequests: null } });
const rosa = line('r', 'Rosa Gift', { rating: 1, isGift: true, householdId: 'g1' });

describe('HousemateAlertChips', () => {
    it('«Conviviente con calificación 2.0»: one decimal, as the cards write ratings', () => {
        const html = renderToStaticMarkup(<HousemateAlertChips household={home([julian])} open={false} onToggle={() => {}} listId="l1" />);
        expect(text(html)).toContain('Conviviente con calificación 2.0');
        expect(html).toContain('data-alert="housemate_low_rating"');
        expect(html).not.toContain('data-alert="housemate_alerts"');
        // An alert: the warning tone, through theme tokens.
        expect(html).toContain('var(--status-warning-bg)');
    });

    it('several low-rated housemates (another home too) → ONE chip with the lowest rating', () => {
        const html = renderToStaticMarkup(<HousemateAlertChips household={home([julian, pedro])} open={false} onToggle={() => {}} listId="l1" />);
        expect(html.match(/data-alert="housemate_low_rating"/g)).toHaveLength(1);
        expect(text(html)).toContain('Conviviente con calificación 1.5');
    });

    it('a housemate with an alert of their own → «Conviviente con alertas»; with a low-rated one too, both chips', () => {
        const only = renderToStaticMarkup(<HousemateAlertChips household={home([ana])} open={false} onToggle={() => {}} listId="l1" />);
        expect(text(only)).toContain('Conviviente con alertas');
        expect(only).not.toContain('data-alert="housemate_low_rating"');
        const both = renderToStaticMarkup(<HousemateAlertChips household={home([julian, ana])} open={false} onToggle={() => {}} listId="l1" />);
        expect(both).toContain('data-alert="housemate_low_rating"');
        expect(both).toContain('data-alert="housemate_alerts"');
    });

    it('flags only, a 2.5, or a gift-only housemate → nothing', () => {
        const flagsOnly = line('f', 'Flag Only', { rating: 4, openAlerts: ['duplicate', 'inaccurate'] });
        for (const lines of [[flagsOnly], [line('m', 'Mid', { rating: 2.5 })], [rosa], []]) {
            expect(renderToStaticMarkup(<HousemateAlertChips household={home(lines)} open={false} onToggle={() => {}} listId="l1" />)).toBe('');
            expect(hasHousemateAlert(home(lines))).toBe(false);
        }
    });

    it('a real disclosure button: aria-expanded / aria-controls follow the list', () => {
        const closed = renderToStaticMarkup(<HousemateAlertChips household={home([julian, ana])} open={false} onToggle={() => {}} listId="hh-list" />);
        expect(closed.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls="hh-list"/g)).toHaveLength(2);
        expect(closed).not.toContain('aria-pressed');
        const open = renderToStaticMarkup(<HousemateAlertChips household={home([julian, ana])} open onToggle={() => {}} listId="hh-list" />);
        expect(open.match(/aria-expanded="true"/g)).toHaveLength(2);
    });

    it('tapping a chip toggles the list and never follows the card it sits in (a link)', () => {
        const onToggle = vi.fn();
        const tree = HousemateAlertChips({ household: home([julian]), open: false, onToggle, listId: 'l1' }) as ReactElement<{ children: unknown }>;
        const chips = ([] as unknown[]).concat(tree.props.children).filter(isValidElement) as Array<ReactElement<{ onClick: (e: unknown) => void }>>;
        expect(chips).toHaveLength(1);
        const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        chips[0].props.onClick(e);
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
    });
});

describe('the chips answer for every housemate, not just the listed ones (review fix 2)', () => {
    it('ten fine housemates listed, an 11th rated 1 beyond the list → the chip shows 1.0, the list says «y 1 más»', () => {
        const ten = Array.from({ length: 10 }, (_, i) => line(`f${i}`, `Fine ${i}`, { rating: 4 }));
        const card: CardHousehold = { lines: ten, more: 1, alert: { lowRating: 1, hasAlerts: false } };
        const chips = renderToStaticMarkup(<HousemateAlertChips household={card} open={false} onToggle={() => {}} listId="l1" />);
        expect(text(chips)).toContain('Conviviente con calificación 1.0');
        const list = renderToStaticMarkup(<HousemateList household={card} id="l1" />);
        expect(list.match(/data-testid="card-household-person"/g)).toHaveLength(10);
        expect(text(list)).toContain('y 1 más');
    });

    it('a card further down with only the answers (no list read) still raises its chips', () => {
        const card: CardHousehold = { lines: [], more: 0, alert: { lowRating: null, hasAlerts: true } };
        expect(hasHousemateAlert(card)).toBe(true);
        expect(text(renderToStaticMarkup(<HousemateAlertChips household={card} open={false} onToggle={() => {}} listId="l1" />))).toContain('Conviviente con alertas');
    });

    it('no «y N más» when the list holds everyone', () => {
        expect(renderToStaticMarkup(<HousemateList household={home([julian])} id="l1" />)).not.toContain('card-household-more');
    });
});

describe('HousemateList — what a tap opens', () => {
    it('everyone per home («Convive con» / «En otro hogar, con»), each with their own rating and alerts, never flags; gift-only left out', () => {
        const html = renderToStaticMarkup(<HousemateList household={home([julian, ana, pedro, rosa])} id="l1" />);
        const said = text(html);
        expect(said).toContain('Convive con');
        expect(said).toContain('En otro hogar, con');
        expect(said).toContain('Julián Urfalino');
        expect(said).toContain('Ana Gil');
        expect(said).toContain('Pedro Paez');
        expect(said).not.toContain('Rosa Gift');
        expect(html.match(/data-testid="card-household-person"/g)).toHaveLength(3);
        // Ana's own alert next to her rating; her «Duplicado» flag is not shown.
        expect(said).toContain('5 adopciones en 10 días');
        expect(html).not.toContain('data-alert="duplicate"');
        expect(said).toContain('2.0');
        expect(html).toContain('id="l1"');
    });

    it('closed by default: the combined HousemateAlert draws the chips and no list', () => {
        const html = renderToStaticMarkup(<div className="flex flex-wrap"><HousemateAlert household={home([julian])} personId="x" /></div>);
        expect(text(html)).toContain('Conviviente con calificación 2.0');
        expect(html).not.toContain('data-testid="card-household-list"');
    });
});

describe('MatchCardHeader — the chips are alerts in the person\'s own alert row', () => {
    it('both chips after the person\'s own rating and before their flags; no old «Vive con» line', () => {
        const html = renderToStaticMarkup(
            <MatchCardHeader person={{ id: 'x', name: 'Jonathan Urfalino', rating: 5, openAlerts: ['duplicate'], households: home([julian, ana]) }} testId="mh" />,
        );
        expect(html).toContain('data-testid="mh-housemate-alert-rating"');
        expect(html).toContain('data-testid="mh-housemate-alert-alerts"');
        const rating = html.indexOf('data-testid="rating-value"');
        const lowChip = html.indexOf('data-alert="housemate_low_rating"');
        const alertsChip = html.indexOf('data-alert="housemate_alerts"');
        const flag = html.indexOf('data-alert="duplicate"');
        expect(rating).toBeGreaterThan(-1);
        expect(rating).toBeLessThan(lowChip);
        expect(lowChip).toBeLessThan(alertsChip);
        expect(alertsChip).toBeLessThan(flag);
        expect(text(html)).not.toContain('Vive con');
        expect(html).not.toContain('card-household-line');
    });

    it('no housemate problem → no chip at all', () => {
        const html = renderToStaticMarkup(<MatchCardHeader person={{ id: 'x', name: 'A', rating: 5, households: home([line('z', 'Zoe', { rating: 4 })]) }} />);
        expect(html).not.toContain('data-alert="housemate_');
    });
});
