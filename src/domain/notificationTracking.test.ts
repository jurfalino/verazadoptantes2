import { describe, it, expect } from 'vitest';
import {
    withTrackingParams,
    notificationEmailLink,
    followupDigestLink,
    parseEmailLanding,
    notificationAgeHours,
    notificationClickProps,
    FOLLOWUP_DIGEST_KIND,
    DEFAULT_EMAIL_KIND,
} from './notificationTracking';

describe('withTrackingParams — tags a link without breaking it', () => {
    it('plain path → adds a query', () => {
        expect(withTrackingParams('/adopter/a1', { n: 'id1', ch: 'email' })).toBe('/adopter/a1?n=id1&ch=email');
    });

    it('an existing query → appends with &', () => {
        expect(withTrackingParams('/my-animals?view=pendientes', { ch: 'email' })).toBe('/my-animals?view=pendientes&ch=email');
    });

    it('a #hash stays last, after the query', () => {
        expect(withTrackingParams('/my-animals/a1#next-action', { ch: 'email' })).toBe('/my-animals/a1?ch=email#next-action');
    });

    it('query + hash', () => {
        expect(withTrackingParams('/x?a=1#top', { n: 'id1' })).toBe('/x?a=1&n=id1#top');
    });

    it('a trailing ? or & is not doubled', () => {
        expect(withTrackingParams('/x?', { n: 'id1' })).toBe('/x?n=id1');
        expect(withTrackingParams('/x?a=1&', { n: 'id1' })).toBe('/x?a=1&n=id1');
    });

    it('absolute URLs keep scheme and host', () => {
        expect(withTrackingParams('https://buenadoptante.org/a?b=c#d', { ch: 'email' }))
            .toBe('https://buenadoptante.org/a?b=c&ch=email#d');
    });

    it('a bare origin (notification without a url) is still tagged', () => {
        expect(withTrackingParams('https://buenadoptante.org', { ch: 'email' })).toBe('https://buenadoptante.org?ch=email');
    });

    it('values are URI-encoded', () => {
        expect(withTrackingParams('/x', { n: 'a b&c' })).toBe('/x?n=a%20b%26c');
    });

    it('replaces an existing param of the same name instead of duplicating it, keeping others verbatim', () => {
        expect(withTrackingParams('/x?ch=sms&q=a%2Bb&n=old', { n: 'new', ch: 'email' })).toBe('/x?q=a%2Bb&n=new&ch=email');
    });
});

describe('notificationEmailLink / followupDigestLink', () => {
    it('a notification email link carries its id, the channel and the notice type as kind', () => {
        expect(notificationEmailLink('https://x.org/adopter/a1', 'n-123', 'merge_request'))
            .toBe('https://x.org/adopter/a1?n=n-123&ch=email&kind=merge_request');
    });

    it('the follow-up digest carries channel + kind only (no notification id)', () => {
        expect(followupDigestLink('https://x.org/my-animals/a1#next-action'))
            .toBe(`https://x.org/my-animals/a1?ch=email&kind=${FOLLOWUP_DIGEST_KIND}#next-action`);
    });
});

describe('parseEmailLanding — reads the email params and cleans the address bar', () => {
    const loc = (search: string, hash = '', pathname = '/adopter/a1') => ({ pathname, search, hash });

    it('no ch=email → null (the URL is left alone)', () => {
        expect(parseEmailLanding(loc(''))).toBeNull();
        expect(parseEmailLanding(loc('?n=abc'))).toBeNull();
        expect(parseEmailLanding(loc('?ch=sms&n=abc'))).toBeNull();
    });

    it('notification email: id + kind, and the cleaned URL keeps the other params and the hash', () => {
        expect(parseEmailLanding(loc('?view=x&n=n-123&ch=email&kind=merge_request', '#top'))).toEqual({
            notificationId: 'n-123',
            kind: 'merge_request',
            viaLogin: false,
            cleanedUrl: '/adopter/a1?view=x#top',
        });
    });

    it('only tracking params → the cleaned URL has no ?', () => {
        expect(parseEmailLanding(loc('?n=n-1&ch=email'))?.cleanedUrl).toBe('/adopter/a1');
    });

    it('a missing kind defaults; the digest has no id', () => {
        expect(parseEmailLanding(loc('?n=n-1&ch=email'))?.kind).toBe(DEFAULT_EMAIL_KIND);
        expect(parseEmailLanding(loc(`?ch=email&kind=${FOLLOWUP_DIGEST_KIND}`, '#next-action', '/my-animals/a1'))).toEqual({
            notificationId: undefined,
            kind: FOLLOWUP_DIGEST_KIND,
            viaLogin: false,
            cleanedUrl: '/my-animals/a1#next-action',
        });
    });

    it('a crafted link is shape-checked: a malformed id or kind is dropped', () => {
        const r = parseEmailLanding(loc('?ch=email&n=someone%40example.com&kind=Pedro%20Paez'));
        expect(r?.notificationId).toBeUndefined();
        expect(r?.kind).toBe(DEFAULT_EMAIL_KIND);
        // …and both are still removed from the address bar.
        expect(r?.cleanedUrl).toBe('/adopter/a1');
        expect(parseEmailLanding(loc(`?ch=email&n=${'a'.repeat(65)}`))?.notificationId).toBeUndefined();
    });

    it('kind is an allowlist of real notification types: arbitrary text never reaches an event', () => {
        expect(parseEmailLanding(loc('?ch=email&n=abc-1&kind=juan_perez'))?.kind).toBe(DEFAULT_EMAIL_KIND);
        expect(parseEmailLanding(loc('?ch=email&n=abc-1&kind=form_submission'))?.kind).toBe('form_submission');
        expect(parseEmailLanding(loc('?ch=email&kind=follow_up_digest'))?.kind).toBe(FOLLOWUP_DIGEST_KIND);
    });

    it('signed out: the tags arrive inside the sign-in callbackUrl — counted once, via_login, and stripped there', () => {
        const cb = encodeURIComponent('/my-animals?view=pendientes&ch=email&kind=follow_up_digest#h');
        const r = parseEmailLanding(loc(`?callbackUrl=${cb}&authRequired=true`, '', '/'));
        expect(r).toEqual({
            notificationId: undefined,
            kind: FOLLOWUP_DIGEST_KIND,
            viaLogin: true,
            cleanedUrl: `/?callbackUrl=${encodeURIComponent('/my-animals?view=pendientes#h')}&authRequired=true`,
        });
        // a path without our tags is not a landing
        expect(parseEmailLanding(loc('?view=pendientes', '#h', '/my-animals'))).toBeNull();
    });

    it('a callbackUrl without our tags, or pointing off-site, is left alone', () => {
        expect(parseEmailLanding(loc(`?callbackUrl=${encodeURIComponent('/my-animals')}`, '', '/'))).toBeNull();
        expect(parseEmailLanding(loc(`?callbackUrl=${encodeURIComponent('//evil.org/x?ch=email')}`, '', '/'))).toBeNull();
        expect(parseEmailLanding(loc(`?callbackUrl=${encodeURIComponent('https://evil.org/x?ch=email')}`, '', '/'))).toBeNull();
    });

    it('a direct landing is not via_login', () => {
        expect(parseEmailLanding(loc('?ch=email&n=abc-1&kind=form_submission'))?.viaLogin).toBe(false);
    });

    it('round-trips with notificationEmailLink', () => {
        const tagged = new URL(notificationEmailLink('https://x.org/my-animals?view=pendientes#h', 'abc-1', 'follow_up_due'));
        expect(parseEmailLanding(tagged)).toEqual({
            notificationId: 'abc-1',
            kind: 'follow_up_due',
            viaLogin: false,
            cleanedUrl: '/my-animals?view=pendientes#h',
        });
    });
});

describe('notificationAgeHours', () => {
    const now = Date.UTC(2026, 10, 11, 12, 0, 0);

    it('a Date', () => {
        expect(notificationAgeHours(new Date(now - 3 * 3600_000), now)).toBe(3);
    });

    it('an ISO string (what the JSON API returns)', () => {
        expect(notificationAgeHours(new Date(now - 90 * 60_000).toISOString(), now)).toBe(1.5);
    });

    it('a number is unix SECONDS (legacy rows)', () => {
        expect(notificationAgeHours(Math.floor(now / 1000) - 7200, now)).toBe(2);
    });

    it('rounds to one decimal', () => {
        expect(notificationAgeHours(new Date(now - 10 * 60_000), now)).toBe(0.2);
    });

    it('a future timestamp (clock skew) clamps to 0', () => {
        expect(notificationAgeHours(new Date(now + 60_000), now)).toBe(0);
    });

    it('invalid → undefined', () => {
        expect(notificationAgeHours('not a date', now)).toBeUndefined();
        expect(notificationAgeHours(null, now)).toBeUndefined();
    });
});

describe('notificationClickProps — only type, id, source, read state and age', () => {
    const now = Date.UTC(2026, 10, 11, 12, 0, 0);
    const item = {
        id: 'n-1', type: 'merge_request', read: 0, createdAt: new Date(now - 3600_000).toISOString(),
        title: 'Pedro Paez', body: 'someone@example.com', url: '/adopter/a1',
    };

    it('builds the event properties', () => {
        expect(notificationClickProps(item, 'bell', now)).toEqual({
            type: 'merge_request', notification_id: 'n-1', source: 'bell', was_unread: true, age_hours: 1,
        });
        expect(notificationClickProps({ ...item, read: 1 }, 'page', now)).toMatchObject({ source: 'page', was_unread: false });
    });

    it('never carries title, body or url', () => {
        const props = notificationClickProps(item, 'bell', now);
        expect(Object.keys(props).sort()).toEqual(['age_hours', 'notification_id', 'source', 'type', 'was_unread']);
        expect(JSON.stringify(props)).not.toContain('Pedro');
        expect(JSON.stringify(props)).not.toContain('@');
    });

    it('omits age_hours when createdAt is unusable', () => {
        expect(notificationClickProps({ ...item, createdAt: 'garbage' }, 'bell', now)).not.toHaveProperty('age_hours');
    });
});
