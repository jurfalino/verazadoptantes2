import { describe, it, expect } from 'vitest';
import { signUnsubscribe, verifyUnsubscribe, unsubscribeUrl } from './emailUnsubscribe';
import { hashOtpCode } from './otp';

const SECRET = 'test-secret';

describe('emailUnsubscribe', () => {
    it('verifies a signature it signed', async () => {
        const sig = await signUnsubscribe('a@b.com', 'forms', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'forms', sig, SECRET)).toBe(true);
    });

    it('rejects another email, another category, another secret', async () => {
        const sig = await signUnsubscribe('a@b.com', 'forms', SECRET);
        expect(await verifyUnsubscribe('x@b.com', 'forms', sig, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'merges', sig, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'forms', sig, 'other')).toBe(false);
    });

    it('rejects a flipped hex char, wrong length and empty', async () => {
        const sig = await signUnsubscribe('a@b.com', 'forms', SECRET);
        const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
        expect(await verifyUnsubscribe('a@b.com', 'forms', flipped, SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'forms', sig.slice(1), SECRET)).toBe(false);
        expect(await verifyUnsubscribe('a@b.com', 'forms', '', SECRET)).toBe(false);
    });

    it('is false for always-on and unknown categories even with a matching HMAC', async () => {
        const sig = await hashOtpCode('unsub:v1:a@b.com:requests', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'requests', sig, SECRET)).toBe(false);
        const sig2 = await hashOtpCode('unsub:v1:a@b.com:bogus', SECRET);
        expect(await verifyUnsubscribe('a@b.com', 'bogus', sig2, SECRET)).toBe(false);
    });

    it('is email case-insensitive', async () => {
        const sig = await signUnsubscribe('A@B.com', 'merges', SECRET);
        expect(await verifyUnsubscribe('a@b.COM', 'merges', sig, SECRET)).toBe(true);
    });

    it('builds the url', async () => {
        const url = await unsubscribeUrl('https://x.org', 'a+b@c.com', 'forms', SECRET);
        const u = new URL(url);
        expect(u.origin + u.pathname).toBe('https://x.org/email/unsubscribe');
        expect(u.searchParams.get('e')).toBe('a+b@c.com');
        expect(u.searchParams.get('c')).toBe('forms');
        expect(await verifyUnsubscribe(u.searchParams.get('e')!, 'forms', u.searchParams.get('s')!, SECRET)).toBe(true);
    });
});
