/**
 * «Qué coincide y qué no» on the admin merge rows (review of audit A4): an
 * admin sees every value, so a matched field missing from the other profile's
 * typed list is «en otro campo» — never a padlock and the «Con candado: dato
 * protegido de otro equipo» footnote, which said something false to an admin.
 * Elsewhere (a rescuer who may not see the value) the padlock stays.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { isAdmin: true } } }) }));
vi.mock('@/app/actions', () => ({ getMatchContext: vi.fn(async () => ({ ok: false })) }));
vi.mock('@/lib/clientErrorReporter', () => ({ reportClientError: vi.fn() }));

import MatchCompare from './MatchCompare';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
const t = tFor(es as unknown as Record<string, unknown>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Matched on the phone's last digits; the absorbed profile's typed list has no phone (it sits in an old text field).
const props = {
    adopterId: 'b', matchTypes: ['phone_suffix'], profileName: 'Ana Díaz', bare: true, t,
    source: { kind: 'profile' as const, name: 'Ana Diaz', entries: [{ type: 'phone', value: '11 2345-6789' }] },
    profileEntries: [] as Array<{ type: string; value: string }>,
};

describe('MatchCompare — full visibility (admin merge rows)', () => {
    it('a matched field with no value on the other side reads «en otro campo», with no padlock footnote', () => {
        const html = renderToStaticMarkup(<MatchCompare {...props} fullVisibility />);
        expect(text(html)).toContain(es.matchCompare.elsewhere);
        expect(text(html)).not.toContain(es.matchCompare.privacy_locked);
        expect(text(html)).not.toContain(es.matchCompare.has_one);
    });

    it('without it (a rescuer who may not see the value) the padlock and its footnote stay', () => {
        const html = renderToStaticMarkup(<MatchCompare {...props} />);
        expect(text(html)).toContain(es.matchCompare.privacy_locked);
    });
});
