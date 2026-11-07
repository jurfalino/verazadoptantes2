/**
 * Re-review I-1: a card whose household was never read (households off, or the
 * query budget cut it) says nothing about a home — neither «elsewhere» nor
 * «No convive con nadie registrado». Only a read, empty home says the latter.
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

// The contact editor drags in server actions (next-auth); the card never renders it here.
vi.mock('@/components/ContactEntriesSection', () => ({ default: () => null }));

import { HouseholdCandidateCard } from './HouseholdCandidateCard';
import { NO_CARD_HOUSEHOLD } from '@/domain/households';
import type { HouseholdMatchCandidate } from '@/app/actions/households';

const base = {
    adopterId: 'a1', adopter: { id: 'a1', name: 'Marta Paez', contactEntries: null }, matchTypes: ['name'], matchValues: [],
    openFlags: [], activity: {}, rating: null,
} as unknown as HouseholdMatchCandidate;

const render = (c: HouseholdMatchCandidate) => renderToStaticMarkup(<HouseholdCandidateCard candidate={c} busy={false} onYes={() => {}} onNo={() => {}} />);

describe('HouseholdCandidateCard — household unknown vs empty', () => {
    it('a card with no household read renders neither the elsewhere line nor «No convive…»', () => {
        const html = render({ ...base, household: undefined });
        expect(html).not.toContain(es.adopter.hh_no_housemates);
        expect(html).not.toContain('hh-candidate-elsewhere');
    });

    it('a read, empty home says so', () => {
        expect(render({ ...base, household: NO_CARD_HOUSEHOLD })).toContain(es.adopter.hh_no_housemates);
    });
});
