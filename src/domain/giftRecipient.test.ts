import { describe, it, expect } from 'vitest';
import { parseGiftRecipient, recipientFullName } from './giftRecipient';

describe('parseGiftRecipient', () => {
    it('keeps a valid recipient, trimming', () => {
        expect(parseGiftRecipient({ relationship: 'child', firstName: ' Laura ', lastName: ' Pérez ', phone: ' 11 5555-1234 ' }))
            .toEqual({ relationship: 'child', firstName: 'Laura', lastName: 'Pérez', phone: '11 5555-1234' });
    });
    it('needs a known relationship and a first name', () => {
        expect(parseGiftRecipient({ relationship: 'boss', firstName: 'Laura' })).toBeNull();
        expect(parseGiftRecipient({ relationship: 'child', firstName: '  ' })).toBeNull();
        expect(parseGiftRecipient('x')).toBeNull();
        expect(parseGiftRecipient(null)).toBeNull();
    });
    it('accepts exactly what the form accepts: 7+ digits/spaces/+()-', () => {
        expect(parseGiftRecipient({ relationship: 'child', firstName: 'L', phone: '123456' })!.phone).toBeUndefined();
        expect(parseGiftRecipient({ relationship: 'child', firstName: 'L', phone: '+54 (11) 5555-1234' })!.phone).toBe('+54 (11) 5555-1234');
    });
    it('drops a malformed phone, caps names', () => {
        const r = parseGiftRecipient({ relationship: 'partner', firstName: 'x'.repeat(80), phone: 'call me maybe' })!;
        expect(r.firstName).toHaveLength(60);
        expect(r.phone).toBeUndefined();
    });
});

describe('recipientFullName', () => {
    it('needs both names', () => {
        expect(recipientFullName({ relationship: 'child', firstName: 'Laura', lastName: 'Pérez' })).toBe('Laura Pérez');
        expect(recipientFullName({ relationship: 'child', firstName: 'Laura' })).toBeNull();
    });
});
