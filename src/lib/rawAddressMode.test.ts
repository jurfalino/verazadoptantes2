import { describe, it, expect } from 'vitest';
import { isRawAddress, isStructuredAddress, joinedAddressValue, type ContactEntry } from './contactEntries';

/**
 * The "Pegar como texto" toggle switches an address between structured
 * (street + locality) and raw-paste modes. `isRawAddress` is the mode predicate
 * the editor renders from.
 *
 * Regression: it tested `!!entry.raw`, so `raw: ''` — the state produced by
 * toggling a freshly added, still-empty address — read as false. The editor kept
 * showing the structured fields and the button appeared to do nothing. It only
 * worked on an address that already had text, which is the case least likely to
 * be tried first.
 */
const address = (over: Partial<ContactEntry> = {}): ContactEntry =>
    ({ id: 'a1', type: 'address', value: '', ...over }) as ContactEntry;

describe('isRawAddress — raw-paste mode', () => {
    // The bug, stated directly.
    it('treats an EMPTY raw string as raw mode', () => {
        expect(isRawAddress(address({ raw: '' }))).toBe(true);
    });

    it('treats a filled raw string as raw mode', () => {
        expect(isRawAddress(address({ raw: 'Av. Siempreviva 742, Springfield' }))).toBe(true);
    });

    it('is not raw mode when raw is absent', () => {
        expect(isRawAddress(address())).toBe(false);
    });

    it('is not raw mode while structured fields are populated', () => {
        expect(isRawAddress(address({ raw: 'x', streetAndNumber: 'Av. Siempreviva 742' }))).toBe(false);
        expect(isRawAddress(address({ raw: 'x', locality: 'Springfield' }))).toBe(false);
    });

    it('only applies to addresses', () => {
        expect(isRawAddress({ id: 'p1', type: 'phone', value: '1122334455', raw: '' } as ContactEntry)).toBe(false);
    });
});

describe('address mode round-trip', () => {
    // Mirrors toggleAddressMode: structured -> raw -> structured.
    it('an empty address survives a toggle into raw and back', () => {
        const start = address();
        expect(isRawAddress(start)).toBe(false);

        const raw = { ...start, raw: start.value || joinedAddressValue(start.streetAndNumber, start.locality), value: '' };
        delete (raw as Partial<ContactEntry>).streetAndNumber;
        delete (raw as Partial<ContactEntry>).locality;
        expect(raw.raw).toBe('');
        expect(isRawAddress(raw)).toBe(true); // ← previously false: the dead button

        const r = (raw.raw || '').trim();
        const comma = r.indexOf(',');
        const back = {
            ...raw,
            streetAndNumber: comma > 0 ? r.slice(0, comma).trim() : r,
            locality: comma > 0 ? r.slice(comma + 1).trim() : '',
        };
        delete (back as Partial<ContactEntry>).raw;
        expect(isRawAddress(back)).toBe(false);
    });

    it('splits a pasted address on the first comma when leaving raw mode', () => {
        const r = 'Av. Siempreviva 742, Springfield, Oregon';
        const comma = r.indexOf(',');
        expect(r.slice(0, comma).trim()).toBe('Av. Siempreviva 742');
        expect(r.slice(comma + 1).trim()).toBe('Springfield, Oregon');
    });

    it('structured and raw modes stay mutually exclusive', () => {
        const structured = address({ streetAndNumber: 'Av. Siempreviva 742', locality: 'Springfield' });
        expect(isStructuredAddress(structured)).toBe(true);
        expect(isRawAddress(structured)).toBe(false);
    });
});
