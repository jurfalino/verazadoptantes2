import { describe, it, expect } from 'vitest';
import { signUnsubscribe, verifyUnsubscribe, unsubscribeUrl } from './emailUnsubscribe';
import { hashOtpCode } from './otp';

const SECRET = 'test-secret';

describe('emailUnsubscribe', () => {
    it('verifies a signature it signed', async () => {
        const sig = await signUnsubscribe('a@b.com', 'form', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'form', sig, SECRET)).toBe(true);
    });

    it('rejects another email, another category, another secret', async () => {
        const sig = await signUnsubscribe('a@b.com', 'form', SECRET);
        expect(await verifyUnsubscribe('x@b.com', 'form', sig, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'duplicates', sig, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'form', sig, 'other')).toBe(false);
    });

    it('rejects a flipped hex char, wrong length and empty', async () => {
        const sig = await signUnsubscribe('a@b.com', 'form', SECRET);
        const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
        expect(await verifyUnsubscribe('a@b.com', 'form', flipped, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'form', sig.slice(1), SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'form', '', SECRET)).toBe(false);
    });

    it('is false for always-on and unknown categories even with a matching HMAC', async () => {
        const sig = await hashOtpCode('unsub:v1:a@b.com:merge_request', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'merge_request', sig, SECRET)).toBe(false);
        const sig2 = await hashOtpCode('unsub:v1:a@b.com:bogus', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'bogus', sig2, SECRET)).toBe(false);
    });

    it('is email case-insensitive', async () => {
        const sig = await signUnsubscribe('A@B.com', 'duplicates', SECRET);
        expect(await verifyUnsubscribe('a@b.COM', 'duplicates', sig, SECRET)).toBe(true);
    });

    it('builds the url', async () => {
        const url = await unsubscribeUrl('https://x.org', 'a+b@c.com', 'form', SECRET);
        const u = new URL(url);
        expect(u.origin + u.pathname).toBe('https://x.org/email/unsubscribe');
        expect(u.searchParams.get('e')).toBe('a+b@c.com');
        expect(u.searchParams.get('c')).toBe('form');
        expect(await verifyUnsubscribe(u.searchParams.get('e')!, 'form', u.searchParams.get('s')!, SECRET)).toBe(true);
    });
});
