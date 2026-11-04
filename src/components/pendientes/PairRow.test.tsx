/**
 * D49 on the row: after a rejection (or an admin's ruling) keeping the other
 * rescuer's profile is «Pedir revisión a un administrador», never a merge —
 * the button and the line explaining it say so, in es/en/pt.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingDedupPair, PendingDedupSide } from '@/app/actions/duplicates';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

// The comparison card reads the session and calls actions; the row's own text is what is tested —
// plus the two side heads the row hands it (drawn here as they are, so their rows can be read).
vi.mock('@/components/MatchCompare', () => ({
    default: ({ sourceHead, targetHead }: { sourceHead?: unknown; targetHead?: unknown }) => (
        <>{sourceHead as never}{targetHead as never}</>
    ),
    AdminScore: () => null,
    entriesAsShown: () => [],
}));

// The heads' own pieces (RatingBadge, the housemate chips, «Abrir perfil ↗») read the language themselves: es.
vi.mock('@/context/LanguageContext', async () => {
    const { es: dict } = await import('@/i18n/locales/es');
    const t = (path: string): string => {
        let cur: unknown = dict;
        for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
        return typeof cur === 'string' ? cur : path;
    };
    return { useLanguage: () => ({ t, locale: 'es' }) };
});

const { default: PairRow } = await import('./PairRow');

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};

const side = (id: string, over: Partial<PendingDedupSide> = {}): PendingDedupSide => ({
    id, name: 'Carla Gómez', contactInfo: null, contactEntries: null, source: 'form', createdAt: null,
    canSeeContact: true, createdByName: null, createdByAnonymous: false, isMine: false, teamOwned: false, ...over,
});

const pair = (over: Partial<PendingDedupPair>): PendingDedupPair => ({
    candidateId: 'c1',
    source: 'detected',
    newAdopter: side('mine', { isMine: true, teamOwned: true }),
    existingAdopter: side('theirs', { createdByName: 'María' }),
    matchTypes: ['name'],
    matchValues: {},
    confidence: 'high',
    confidencePercent: null,
    adminScore: null,
    group: 'pair',
    summary: { same: [], diff: [], flagged: false },
    mergeAction: 'merge',
    keepOptions: { new: true, existing: true },
    actionByKeep: { new: 'merge', existing: 'merge' },
    defaultKeep: 'existing',
    identityChoice: false,
    request: null,
    ...over,
});

const declinedSent = (theirsAction: 'merge' | 'dispute'): PendingDedupPair => pair({
    group: 'declined',
    keepOptions: { new: false, existing: true },
    actionByKeep: { new: null, existing: theirsAction },
    request: {
        id: 'r1', status: 'declined', direction: 'sent', createdAt: 1, counterpartName: 'María', toAdmins: false, dispute: false,
        canMessage: true, declinedAt: 2, declinedByName: 'María', keepId: 'mine',
    },
});

const render = (p: PendingDedupPair, dict: Record<string, unknown>) => renderToStaticMarkup(
    <PairRow pair={p} open onToggle={() => undefined} keep={p.defaultKeep} onKeep={() => undefined} busy={false} locked={false} isAdmin={false}
        t={tFor(dict)} formatShortDate={() => ''} age={() => 'hace 1 día'} onAction={() => undefined} onRequestAccess={() => undefined} />,
);
const dicts = [['es', es], ['en', en], ['pt', pt]] as const;
const as = (d: unknown) => d as Record<string, unknown>;

describe('PairRow — «Pedir revisión a un administrador» (D49)', () => {
    it.each(dicts)('%s: a rejected requester keeping theirs asks the admins, and the row says why', (_l, dict) => {
        const html = render(declinedSent('dispute'), as(dict));
        expect(html).toContain(dict.myAdopters.pending_d_action_dispute);
        expect(html).toContain(dict.myAdopters.pending_d_explain_declined_requester_dispute.replace('{name}', 'María'));
        expect(html).not.toContain(dict.myAdopters.pending_d_action_combine_theirs.replace('{name}', 'María'));
    });

    it('an admin who was rejected still merges keeping theirs (D43)', () => {
        const html = render(declinedSent('merge'), as(es));
        expect(html).toContain('Unir conservando el de María');
        expect(html).not.toContain(es.myAdopters.pending_d_action_dispute);
    });

    it.each(dicts)('%s: a possible duplicate an admin ruled separate offers the review, not «Combinar perfiles»', (_l, dict) => {
        const html = render(pair({ actionByKeep: { new: 'dispute', existing: 'dispute' } }), as(dict));
        expect(html).toContain(dict.myAdopters.pending_d_action_dispute);
        expect(html).toContain(dict.myAdopters.pending_d_explain_dispute);
        expect(html).not.toContain(dict.myAdopters.pending_dedup_action_merge);
    });

    it.each(dicts)('%s: a dispute that was sent reads as a review the admins have', (_l, dict) => {
        const html = render(pair({
            group: 'sent',
            request: {
                id: 'r2', status: 'pending', direction: 'sent', createdAt: 1, counterpartName: null, toAdmins: true, dispute: true,
                canMessage: false, declinedAt: null, declinedByName: null, keepId: 'theirs',
            },
        }), as(dict));
        expect(html).toContain(dict.myAdopters.pending_d_line_sent_dispute.replace('{when}', 'hace 1 día'));
        expect(html).toContain(dict.myAdopters.pending_d_explain_sent_dispute);
    });
});

describe('PairRow — each side\'s standing row (dedup-side-standing, point C)', () => {
    // Each side's standing row, in order (mine, theirs): its HTML up to the next side row.
    // (The row after it — who loaded it, source, date — is the side's 12px meta line.)
    const rows = (html: string) => html.split('data-testid="dedup-side-standing"').slice(1).map(chunk => chunk.slice(0, chunk.indexOf('text-[12px]')));

    it('the side\'s own rating first, then its housemate chips; a side with neither draws an empty row (hidden by CSS)', () => {
        const p = pair({
            newAdopter: side('mine', {
                isMine: true, teamOwned: true, rating: 4.25,
                households: { lines: [], more: 0, alert: { lowRating: 1.5, hasAlerts: true } },
            }),
            existingAdopter: side('theirs', { createdByName: 'María' }),
        });
        const html = render(p, as(es));
        const [mine, theirs] = rows(html);
        expect(rows(html)).toHaveLength(2);
        // Mine: «★ 4.3 · Bueno», then both chips (the lowest rating, one decimal), in that order.
        expect(mine).toContain('data-testid="rating-value"');
        expect(mine).toContain('4.3');
        const rating = mine.indexOf('data-testid="rating-value"');
        const low = mine.indexOf('data-testid="dedup-housemate-alert-mine-rating"');
        const alerts = mine.indexOf('data-testid="dedup-housemate-alert-mine-alerts"');
        expect(rating).toBeLessThan(low);
        expect(low).toBeLessThan(alerts);
        expect(html).toContain(es.flags.housemate_low_rating.replace('{rating}', '1.5'));
        // Theirs: rating not read (undefined) and no homes → nothing in the row, not «Sin calificación».
        expect(theirs).not.toContain('data-testid="rating-value"');
        expect(theirs).not.toContain('person-unrated');
        expect(theirs).not.toContain('dedup-housemate-alert');
    });

    it('a side read as unrated (null) says «Sin calificación»', () => {
        const html = render(pair({ existingAdopter: side('theirs', { rating: null }) }), as(es));
        const theirs = rows(html)[1];
        expect(theirs).toContain('person-unrated');
    });
});
