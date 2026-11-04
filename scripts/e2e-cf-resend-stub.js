// E2E ONLY — never part of a deployed build. scripts/e2e-cf-prepare.mjs copies
// this file into a COPY of the Cloudflare build (.vercel/e2e-cf-static) and
// imports it ahead of the real worker entry, so it runs before next-on-pages
// wraps globalThis.fetch.
//
// Why: the Cloudflare build is a production build, so requestEmailOtp has no
// "dev: skip the send" branch — without a Resend key it fails the request.
// The e2e server therefore gets a dummy key (playwright.cf.config.ts), and
// this stub answers Resend's API locally, so the OTP flow runs its REAL send
// path (sendEmailViaResend) and nothing ever leaves the machine. Every other
// fetch goes to the real fetch untouched.
const RESEND_API = 'https://api.resend.com/';
const realFetch = globalThis.fetch;

globalThis.fetch = function e2eResendStub(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(RESEND_API)) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'e2e-resend-stub' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
    }
    return realFetch.call(globalThis, input, init);
};
