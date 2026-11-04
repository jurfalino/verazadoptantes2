/**
 * One place for aliases (Jon, 2026-11-04): a previous name kept by a rename or a
 * merge is listed with the other «Conocido/a como» in the contact details — it
 * used to sit alone under the name, the same concept shown two ways. Its edit
 * and remove stay with the profile's team: its author is the rename sentinel,
 * never a viewer.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import { RENAME_ALIAS_AUTHOR, type ContactEntry } from '@/lib/contactEntries';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: tFor(es as unknown as Record<string, unknown>), locale: 'es' }) }));
vi.mock('@/app/actions/addContactEntry', () => ({ addContactEntry: vi.fn() }));
vi.mock('@/app/actions/updateContactEntry', () => ({ updateContactEntry: vi.fn() }));
vi.mock('@/app/actions/removeContactEntry', () => ({ removeContactEntry: vi.fn() }));
vi.mock('@/components/DuplicateHint', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/ui/Toast', async (orig) => ({ ...(await orig()), useShowToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import ContactEntriesDisplay from './ContactEntriesDisplay';
import ContactEntriesSection from './ContactEntriesSection';

const VIEWER = 'helper@example.com';
const entries: ContactEntry[] = [
    { id: 'k1', type: 'alias', value: 'Elena de Troya', addedBy: RENAME_ALIAS_AUTHOR, fromRename: true },
    { id: 't1', type: 'alias', value: 'Ele', addedBy: VIEWER },
];

const section = (canEditAll: boolean) => renderToStaticMarkup(
    <ContactEntriesSection entries={entries} adopterId="a1" canEditAll={canEditAll} currentUser={VIEWER} startComposer="closed" />,
);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('«Conocido/a como» — kept previous names are listed with the typed aliases', () => {
    it('the read-only list shows both', () => {
        const html = renderToStaticMarkup(<ContactEntriesDisplay entries={entries} />);
        expect(html).toContain('Elena de Troya');
        expect(html).toContain('Ele');
    });

    it('the editable list shows both; the profile team may edit and remove each', () => {
        const html = section(true);
        expect(html).toContain('Elena de Troya');
        expect(count(html, 'data-testid="ce-delete-btn"')).toBe(2);
    });

    it('someone outside the team keeps the controls of the alias they typed, never of the kept name', () => {
        const html = section(false);
        expect(html).toContain('Elena de Troya');
        expect(count(html, 'data-testid="ce-delete-btn"')).toBe(1);
        expect(count(html, 'data-testid="ce-edit-btn"')).toBe(1);
    });
});
