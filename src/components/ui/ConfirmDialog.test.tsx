/**
 * Final review M6: ConfirmDialog renders itself on <body> (a portal) so no
 * ancestor stacking context can trap it under the page. A portal needs the
 * client: server rendering an OPEN dialog must not throw (createPortal has no
 * `document` there) and renders nothing until mounted.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog on the server', () => {
    it('open: renders nothing (the portal waits for the client) and does not throw', () => {
        expect(renderToStaticMarkup(<ConfirmDialog open title="¿Seguro?" onConfirm={() => undefined} onCancel={() => undefined} />)).toBe('');
    });

    it('closed: renders nothing', () => {
        expect(renderToStaticMarkup(<ConfirmDialog open={false} title="¿Seguro?" onConfirm={() => undefined} onCancel={() => undefined} />)).toBe('');
    });
});
