/**
 * D52: a pair combined in «Pendientes» stays as «✓ Combinados — se conservó
 * {nombre} (de {dueño}) · Ver perfil ↗» — naming the profile that stayed and
 * whose it is, with a link to it.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingDedupPair, PendingDedupSide } from '@/app/actions/duplicates';
import MergedRow, { keptSentence, mergedInfo } from './MergedRow';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};

const side = (id: string, over: Partial<PendingDedupSide> = {}): PendingDedupSide => ({
    id, name: 'Carla Gómez', contactInfo: null, contactEntries: null, source: 'form', createdAt: null,
    canSeeContact: true, createdByName: null, createdByAnonymous: false, isMine: false, teamOwned: false, ...over,
});
const pair = { candidateId: 'c1', group: 'pair' } as PendingDedupPair;
const theirs = side('theirs-id', { createdByName: 'María' });
const mine = side('mine-id', { isMine: true, teamOwned: true });

describe('MergedRow (D52)', () => {
    it.each([
        ['es', es, 'Se conservó Carla Gómez (de María)', 'Se conservó Carla Gómez (el tuyo)'],
        ['en', en, 'Carla Gómez was kept (María’s)', 'Carla Gómez was kept (yours)'],
        ['pt', pt, 'Ficou Carla Gómez (de María)', 'Ficou Carla Gómez (o seu)'],
    ])('%s: names the kept profile and its owner', (_l, dict, theirsLine, mineLine) => {
        const t = tFor(dict as unknown as Record<string, unknown>);
        expect(keptSentence(mergedInfo(pair, theirs, t), t)).toBe(theirsLine);
        expect(keptSentence(mergedInfo(pair, mine, t), t)).toBe(mineLine);
    });

    it('renders the confirmation row with a link to the kept profile — not a dedup-row', () => {
        const t = tFor(es as unknown as Record<string, unknown>);
        const html = renderToStaticMarkup(<MergedRow info={mergedInfo(pair, theirs, t)} t={t} />);
        expect(html).toContain('data-testid="dedup-merged-row"');
        expect(html).not.toContain('data-testid="dedup-row"');
        expect(html).toContain('Combinados');
        expect(html).toContain('Se conservó Carla Gómez (de María)');
        expect(html).toContain('data-testid="dedup-merged-view"');
        expect(html).toContain('href="/adopter/theirs-id"');
        expect(html).toContain('Ver perfil');
    });

    it('keeps the group, so a list reload leaves it under the same heading', () => {
        const t = tFor(es as unknown as Record<string, unknown>);
        expect(mergedInfo({ ...pair, group: 'received' }, theirs, t)).toMatchObject({ candidateId: 'c1', group: 'received', keptId: 'theirs-id' });
    });
});
