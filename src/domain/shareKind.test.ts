import { describe, it, expect } from 'vitest';
import { shouldAskShareKind } from './shareKind';

const q = (s: string) => new URLSearchParams(s);

describe('shouldAskShareKind', () => {
    it('asks for a shared link, text or photos', () => {
        expect(shouldAskShareKind(q('shared=true&shared_url=https://instagram.com/p/x'))).toBe(true);
        expect(shouldAskShareKind(q('shared=true&shared_text=hola'))).toBe(true);
        expect(shouldAskShareKind(q('shared=true&shared_images=true'))).toBe(true);
    });
    it('never for a contact card, a chosen person import, or a plain visit', () => {
        expect(shouldAskShareKind(q('shared=true&shared_vcard=true&shared_url=x'))).toBe(false);
        expect(shouldAskShareKind(q('shared=true&shared_vcard_lost=true'))).toBe(false);
        expect(shouldAskShareKind(q('contact_import=1&shared=true&shared_text=x'))).toBe(false);
        expect(shouldAskShareKind(q('shared=true&shared_url=x&kind=person'))).toBe(false);
        expect(shouldAskShareKind(q(''))).toBe(false);
        expect(shouldAskShareKind(q('shared=true'))).toBe(false);
    });
});
