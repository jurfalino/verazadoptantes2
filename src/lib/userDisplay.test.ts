import { describe, it, expect } from 'vitest';
import { actorLabel, emailHandle } from './userDisplay';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

// Resolve against the REAL locale objects, so a key missing from a locale file
// fails here instead of rendering the raw key path to users.
const tFor = (dict: object) => (path: string): string => {
    const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
    return typeof v === 'string' ? v : path;
};
const tEs = tFor(es);
const tEn = tFor(en);
const tPt = tFor(pt);

describe('actorLabel', () => {
    it("shows the 'contract' system actor as a localized label, never the raw code", () => {
        expect(actorLabel('contract', null, tEs)).toBe('contrato digital');
        expect(actorLabel('contract', null, tEn)).toBe('digital contract');
        expect(actorLabel('contract', null, tPt)).toBe('contrato digital');
    });

    it('labels the other contract-path sentinels the same way', () => {
        expect(actorLabel('contract-signed-via-invitation', null, tEs)).toBe('contrato digital');
        expect(actorLabel('contract-submission', null, tEn)).toBe('digital contract');
    });

    it('a system label wins even if a name lookup returned something for it', () => {
        expect(actorLabel('contract', 'contract', tEs)).toBe('contrato digital');
    });

    it('a known email with a resolved name shows the name', () => {
        expect(actorLabel('ana@gmail.com', 'Ana Pérez', tEs)).toBe('Ana Pérez');
    });

    it('an unknown email shows its handle, never the domain', () => {
        expect(actorLabel('jonathan@gmail.com', null, tEs)).toBe('jonathan');
        expect(actorLabel('jonathan@gmail.com', undefined, tEs)).toBe('jonathan');
        expect(actorLabel('jonathan@gmail.com', '', tEs)).toBe('jonathan');
    });

    it('null / undefined keep the current emailHandle behaviour (empty)', () => {
        expect(actorLabel(null, null, tEs)).toBe(emailHandle(null));
        expect(actorLabel(undefined, undefined, tEs)).toBe(emailHandle(undefined));
        expect(actorLabel(null, null, tEs)).toBe('');
    });

    it('unrecognized non-email values still fall back unchanged', () => {
        expect(actorLabel('anonymous', null, tEs)).toBe('anonymous');
    });
});
