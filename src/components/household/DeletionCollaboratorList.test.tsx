/** Audit C4: «• 1 ediciones» → «• 1 edición», in every locale. */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const dict = { current: es as unknown as Record<string, unknown> };
const t = (path: string) => {
    const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict.current);
    return typeof v === 'string' ? v : path;
};
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t }) }));

import { DeletionCollaboratorList } from './HouseholdDialogs';

const text = (c: { adoptions: number; images: number; edits: number; flags: number; forms: number }) =>
    renderToStaticMarkup(<DeletionCollaboratorList collaborators={c} />).replace(/<[^>]+>/g, '|');

describe('DeletionCollaboratorList', () => {
    it.each([
        ['es', es, '• 1 edición', '• 3 fotos', '• 1 formulario'],
        ['en', en, '• 1 edit', '• 3 photos', '• 1 form'],
        ['pt', pt, '• 1 edição', '• 3 fotos', '• 1 formulário'],
    ])('%s: singular for one, plural otherwise', (_l, locale, one, many, form) => {
        dict.current = locale as unknown as Record<string, unknown>;
        const out = text({ adoptions: 0, images: 3, edits: 1, flags: 0, forms: 1 });
        expect(out).toContain(one);
        expect(out).toContain(many);
        expect(out).toContain(form);
        expect(out).not.toContain('delete_collab');
    });
});
