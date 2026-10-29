/**
 * «Ya está en otro perfil», option B (Jon 2026-10-29): a compact inline box
 * that never repeats the typed contact, and a window with the match card —
 * «Es la misma persona» only on a saved profile, «No es esta persona» hiding
 * the row for the same typed value.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
const t = tFor(es as unknown as Record<string, unknown>);

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/app/actions', () => ({
    getDuplicateHintMatches: vi.fn(), grantSearchMatchAccess: vi.fn(), flagAdopterAsDuplicate: vi.fn(), countAdoptersBySocialHandle: vi.fn(),
}));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'e1'), reportClientError: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { DupHintBox, DupHintProfile } from './DuplicateHint';
import { dismissDupHintMatch, NO_DISMISSED, visibleDupHintMatches } from '@/domain/dupHint';
import type { DupHintMatch } from '@/app/actions/households';
import { NO_PERIOD_ALERTS } from '@/domain/periodAlerts';

const TYPED = '6585-1333';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function match(id: string, name: string, over: Partial<DupHintMatch> = {}): DupHintMatch {
    return {
        adopterId: id, adopterName: name, relevancePercent: 50, matchTypes: ['phone_suffix'], matchValues: [], source: 'token',
        adopter: { id, name, contactEntries: JSON.stringify([
            { id: `${id}-p`, type: 'phone', value: '•••• 1333', masked: true },
            { id: `${id}-e`, type: 'email', value: 'j•••@gmail.com', masked: true },
        ]) } as DupHintMatch['adopter'],
        matchSnippet: null, contactProtected: true, visibilityBadge: null, avgRating: null, thumbnail: null,
        stats: { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 },
        flags: { inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false, tooManyAdoptions: null, tooManyRequests: null } as DupHintMatch['flags'],
        householdLine: [], openAlerts: [], activity: {}, rating: null, matchedEntryIndexes: [0],
        ...over,
    };
}

const jonathan = match('a', 'Jonathan Urfalino');
const jonatan = match('b', 'Jonatan Urfalino', {
    rating: 4,
    householdLine: [
        { name: 'Pedro Paez', profileId: 'p', rating: 1, openAlerts: [], alerts: NO_PERIOD_ALERTS, isMinor: false, isGift: false, householdId: 'h1' },
        { name: 'Delia Urfalino', profileId: 'd', rating: null, openAlerts: [], alerts: NO_PERIOD_ALERTS, isMinor: false, isGift: false, householdId: 'h1' },
    ],
});

describe('DupHintBox — the compact inline notice', () => {
    it('header by count, one row per match: name, rating, «Ver perfil»; the household line only for the problem housemate', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan, jonatan]} flagged={new Set()} onView={() => {}} />);
        expect(text(html)).toContain('Ya está en 2 perfiles');
        expect(html.match(/data-testid="dup-hint-row"/g)).toHaveLength(2);
        expect(html.match(/data-testid="dup-hint-view"/g)).toHaveLength(2);
        expect(text(html)).toContain('Sin calificación');
        // The household line (CardHouseholdLine, closed) on Jonatan's row only.
        expect(html.match(/data-testid="card-household-line"/g)).toHaveLength(1);
        expect(text(html)).toContain('Vive con 2 personas');
        // Warning tone through theme tokens, not raw amber classes.
        expect(html).toContain('var(--status-warning-bg)');
        expect(html).not.toMatch(/amber-/);
    });

    it('never repeats the contact just typed', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan]} flagged={new Set()} onView={() => {}} />);
        expect(text(html)).toContain('Ya está en otro perfil');
        expect(html).not.toContain('1333');
        expect(html).not.toContain('data-testid="dup-hint-contact"');
    });

    it('«No es esta persona» drops that row for the same typed value', () => {
        const dismissed = dismissDupHintMatch(NO_DISMISSED, TYPED, 'b');
        const html = renderToStaticMarkup(<DupHintBox matches={visibleDupHintMatches([jonathan, jonatan], dismissed, TYPED)} flagged={new Set()} onView={() => {}} />);
        expect(html.match(/data-testid="dup-hint-row"/g)).toHaveLength(1);
        expect(html).toContain('data-adopter-id="a"');
        expect(html).not.toContain('data-adopter-id="b"');
        expect(text(html)).toContain('Ya está en otro perfil');
        // Both answered → no box at all.
        const none = visibleDupHintMatches([jonathan, jonatan], dismissDupHintMatch(dismissed, TYPED, 'a'), TYPED);
        expect(renderToStaticMarkup(<DupHintBox matches={none} flagged={new Set()} onView={() => {}} />)).toBe('');
    });

    it('a flagged pair shows «Marcado» instead of «Ver perfil»', () => {
        const html = renderToStaticMarkup(<DupHintBox matches={[jonathan, jonatan]} flagged={new Set(['a'])} onView={() => {}} />);
        expect(html.match(/data-testid="dup-hint-flagged"/g)).toHaveLength(1);
        expect(html.match(/data-testid="dup-hint-view"/g)).toHaveLength(1);
    });
});

describe('DupHintProfile — the window', () => {
    const noop = () => {};

    it('the match card: header with the household line, contacts with the typed one «coincide», activity, the three answers in order', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonatan} canFlag onSame={noop} onNotThis={noop} onOpenFull={noop} />);
        expect(html).toContain('data-testid="dup-hint-window-head"');
        expect(html).toContain('data-testid="card-household-line"');
        expect(html.match(/data-testid="dup-hint-contact"/g)).toHaveLength(2);
        expect(html.match(/data-testid="contact-matches"/g)).toHaveLength(1);
        expect(html).toContain('data-testid="dup-hint-activity"');
        const order = ['dup-hint-same', 'dup-hint-not-this', 'dup-hint-open-full'].map(id => html.indexOf(`data-testid="${id}"`));
        expect(order.every(i => i > 0)).toBe(true);
        expect([...order].sort((x, y) => x - y)).toEqual(order);
        expect(text(html)).toContain('Es la misma persona');
        expect(text(html)).toContain('No es esta persona');
        expect(text(html)).toContain('Abrir perfil completo en otra pestaña');
    });

    it('«Es la misma persona» only when a saved profile is being edited', () => {
        const html = renderToStaticMarkup(<DupHintProfile match={jonathan} canFlag={false} onSame={noop} onNotThis={noop} onOpenFull={noop} />);
        expect(html).not.toContain('data-testid="dup-hint-same"');
        expect(html).toContain('data-testid="dup-hint-not-this"');
        expect(html).toContain('data-testid="dup-hint-open-full"');
    });
});
