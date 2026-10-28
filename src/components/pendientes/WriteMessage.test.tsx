/**
 * Final review M1: a «Escribirle» message goes to the other rescuer AND their
 * team, so the box warns that all of them will see the sender's email.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

// The shared dialog renders on <body> once mounted (nothing on the server): render its body in place here.
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
import WriteMessage from './WriteMessage';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : '';
};
const render = (dict: Record<string, unknown>) => renderToStaticMarkup(
    <WriteMessage toName="María" aboutName="Carla" busy={false} onSend={() => undefined} onCancel={() => undefined} t={tFor(dict)} />,
);

describe('WriteMessage warning', () => {
    it.each([
        ['es', es, 'María y su equipo verán tu email para responderte.'],
        ['en', en, 'María and their team will see your email to reply to you.'],
        ['pt', pt, 'María e sua equipe verão seu email para responder.'],
    ])('%s: names the rescuer and their team', (_l, dict, text) => {
        expect(render(dict as unknown as Record<string, unknown>)).toContain(text);
    });

    it('the fallback (a missing key) says so too', () => {
        expect(render({})).toContain('María y su equipo verán tu email para responderte.');
    });
});
