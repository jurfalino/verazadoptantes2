import { describe, it, expect } from 'vitest';
import {
    detectBrowserEnv, parseHandoffMarker, buildHandoffMarker, withHandoffMarker,
    withoutHandoffMarker, buildChromeIntentUrl, LOGIN_HANDOFF_TTL_MS, inAppDisplayName,
    safeNextPath, isAppHandoffReferrer,
} from './inAppBrowser';

// Real user agents from production PostHog pageviews (Aug–Oct 2026) unless noted.
const UA = {
    // The visitor whose Google sign-in vanished on 2026-10-08.
    instagramAndroidHonor: 'Mozilla/5.0 (Linux; Android 14; LLY-LX3 Build/HONORLLY-L33; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.61 Mobile Safari/537.36 Instagram 449.0.0.52.84 Android (34/14; 480dpi; 1080x2412; HONOR; LLY-LX3; HNLLY-Q; qcom; es_AR; 1079242191; IABMV/1)',
    // Instagram without the `; wv)` flag — the app token has to carry it.
    instagramAndroidNoWv: 'Mozilla/5.0 (Linux; Android 16; SM-A065M Build/BP2A.250605.031.A3; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.8037.49 Mobile Safari/537.36 Instagram 448.0.0.52.84 Android (36/16; 300dpi; 720x1600; samsung; SM-A065M; a06; mt6768; es_US; 1073357578; IABMV/1)',
    instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/24A437 Instagram 448.0.0.39.66 (iPhone18,1; iOS 27_0; es_LA; es; scale=3.00; 1206x2622; IABMV/1; 1072661960) Safari/604.1',
    // Facebook on Android has no `; wv)` either.
    facebookAndroid: 'Mozilla/5.0 (Linux; Android 12; moto g(60)s Build/S3RLS32.114-25-13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.33 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/578.0.0.40.75;IABMV/1;]',
    // Not from our data: the documented shapes of these apps' UAs.
    facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108;FBBV/650000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/es_LA;FBOP/5]',
    messengerAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A135M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.36 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/470.0.0.50.109;]',
    // Unnamed app WebView (seen in production).
    genericWebView: 'Mozilla/5.0 (Linux; Android 6.0; CAM-L03 Build/HUAWEICAM-L03; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36',
    // Real browsers — including Chrome Custom Tabs, which is what WhatsApp opens.
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
    samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
};

describe('detectBrowserEnv — which embedded browser Google will refuse', () => {
    it('flags Instagram on Android, with or without the wv flag', () => {
        expect(detectBrowserEnv(UA.instagramAndroidHonor)).toEqual({ inApp: 'instagram', os: 'android' });
        expect(detectBrowserEnv(UA.instagramAndroidNoWv)).toEqual({ inApp: 'instagram', os: 'android' });
    });

    it('flags Instagram on iOS', () => {
        expect(detectBrowserEnv(UA.instagramIos)).toEqual({ inApp: 'instagram', os: 'ios' });
    });

    it('flags Facebook on both platforms and tells Messenger apart', () => {
        expect(detectBrowserEnv(UA.facebookAndroid)).toEqual({ inApp: 'facebook', os: 'android' });
        expect(detectBrowserEnv(UA.facebookIos)).toEqual({ inApp: 'facebook', os: 'ios' });
        expect(detectBrowserEnv(UA.messengerAndroid)).toEqual({ inApp: 'messenger', os: 'android' });
    });

    it('flags an unnamed Android WebView', () => {
        expect(detectBrowserEnv(UA.genericWebView)).toEqual({ inApp: 'webview', os: 'android' });
    });

    it('leaves real browsers alone', () => {
        expect(detectBrowserEnv(UA.chromeAndroid)).toEqual({ inApp: null, os: 'android' });
        expect(detectBrowserEnv(UA.samsungInternet)).toEqual({ inApp: null, os: 'android' });
        expect(detectBrowserEnv(UA.safariIos)).toEqual({ inApp: null, os: 'ios' });
        expect(detectBrowserEnv(UA.chromeIos)).toEqual({ inApp: null, os: 'ios' });
        expect(detectBrowserEnv(UA.desktopChrome)).toEqual({ inApp: null, os: 'other' });
        expect(detectBrowserEnv('')).toEqual({ inApp: null, os: 'other' });
    });

    it('names the app for the visitor, but not an unnamed webview', () => {
        expect(inAppDisplayName('instagram')).toBe('Instagram');
        expect(inAppDisplayName('webview')).toBeNull();
        expect(inAppDisplayName(null)).toBeNull();
    });
});

describe('hand-off marker', () => {
    const now = 1_791_500_000_000;

    it('round-trips both kinds while fresh', () => {
        expect(parseHandoffMarker(buildHandoffMarker('google', now), now + 5_000)).toBe('google');
        expect(parseHandoffMarker(buildHandoffMarker('email', now), now)).toBe('email');
    });

    it('expires, so a shared link cannot bounce a stranger to Google', () => {
        expect(parseHandoffMarker(buildHandoffMarker('google', now), now + LOGIN_HANDOFF_TTL_MS + 1)).toBeNull();
        expect(parseHandoffMarker(buildHandoffMarker('google', now), now - 60_000)).toBeNull();
    });

    it('rejects anything else', () => {
        for (const raw of [null, undefined, '', 'google', 'google.', 'google.abc', 'admin.1791500000000', 'google.1791500000000.1']) {
            expect(parseHandoffMarker(raw, now)).toBeNull();
        }
    });

    it('adds and removes the marker without touching the rest of the query', () => {
        const marked = withHandoffMarker('/?q=Mechi%20G', 'google', now);
        expect(marked).toBe(`/?q=Mechi+G&login=google.${now}`);
        expect(withoutHandoffMarker(marked)).toBe('/?q=Mechi+G');
        expect(withoutHandoffMarker('/adopters/abc')).toBe('/adopters/abc');
    });

    it('canonicalizes, so two spellings of one page compare equal', () => {
        expect(withoutHandoffMarker('/?q=Juan%20Perez')).toBe(withoutHandoffMarker('/?q=Juan+Perez'));
        expect(withoutHandoffMarker('/?b=2&a=1')).toBe(withoutHandoffMarker('/?a=1&b=2'));
    });

    it('carries a different destination as login_next, and strips it again', () => {
        const marked = withHandoffMarker('/?q=Mechi', 'google', now, '/adopter/abc?q=Mechi');
        expect(new URLSearchParams(marked.split('?')[1]).get('login_next')).toBe('/adopter/abc?q=Mechi');
        expect(withoutHandoffMarker(marked)).toBe('/?q=Mechi');
        // Same page: nothing extra.
        expect(withHandoffMarker('/?q=Mechi', 'google', now, '/?q=Mechi')).toBe(`/?q=Mechi&login=google.${now}`);
    });
});

describe('safeNextPath — where to land after sign-in', () => {
    it('keeps same-site paths', () => {
        expect(safeNextPath('/adopter/abc?q=Mechi')).toBe('/adopter/abc?q=Mechi');
        expect(safeNextPath('/my-animals')).toBe('/my-animals');
    });

    it('refuses anything that could leave the site', () => {
        for (const raw of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'evil.com/x', 'javascript:alert(1)']) {
            expect(safeNextPath(raw)).toBeNull();
        }
    });
});

describe('isAppHandoffReferrer', () => {
    it('accepts what an intent looks like, not another website', () => {
        expect(isAppHandoffReferrer('')).toBe(true);
        expect(isAppHandoffReferrer('android-app://com.instagram.android/')).toBe(true);
        expect(isAppHandoffReferrer('https://evil.example/')).toBe(false);
        expect(isAppHandoffReferrer('https://buenadoptante.org/')).toBe(false);
    });
});

describe('buildChromeIntentUrl', () => {
    const now = 1_791_500_000_000;

    it('reopens the same page in Chrome, falling back to the email login', () => {
        const url = buildChromeIntentUrl('https://buenadoptante.org', '/adopters/abc?tab=history', now);
        expect(url).toBe(
            `intent://buenadoptante.org/adopters/abc?tab=history&login=google.${now}`
            + '#Intent;scheme=https;package=com.android.chrome;'
            + `S.browser_fallback_url=${encodeURIComponent(`https://buenadoptante.org/adopters/abc?tab=history&login=email.${now}`)};end`,
        );
    });

    it('opens the public page the visitor is on, with the members-only destination alongside', () => {
        const url = buildChromeIntentUrl('https://buenadoptante.org', '/?q=Mechi', now, '/adopter/abc?q=Mechi');
        expect(url.startsWith(`intent://buenadoptante.org/?q=Mechi&login=google.${now}&login_next=`)).toBe(true);
        expect(url).toContain(encodeURIComponent('/adopter/abc?q=Mechi'));
    });
});
