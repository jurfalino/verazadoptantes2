// The e2e suite against the CLOUDFLARE build: next-on-pages output served by
// `wrangler pages dev` (workerd + local D1), not `next dev`. Same projects,
// tests and DB seed as playwright.config.ts, so the CI matrix strings
// (--project / --shard / --grep) work unchanged.
//
//   APP_BUILD_ID=e2e-build npx @cloudflare/next-on-pages   # once per code change
//   npx playwright test --config=playwright.cf.config.ts --project=unauthed
//
// Why: `next dev` compiles routes on demand and restarts when its heap nears
// the limit, killing the test in flight (.agents/audits/2026-11-03-e2e-ci-reliability.md, S1).
// `next start` is no alternative: the edge routes get no D1 binding there.
//
// The worker's env is its BINDINGS, never the parent's process.env. `pages dev`
// ignores --env-file (wrangler 4.59 hard-codes it off) and would otherwise read
// .env/.env.local, which on a developer's machine can hold a real Resend key:
// CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false turns that off, and every var the
// worker needs is passed as --binding (bindings win over a .dev.vars too).
//
// E2E_CF_PORT: CI uses 3000. Locally pick a free port (other checkouts sit on 3000).
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_CF_PORT || 3000);
const ORIGIN = `http://localhost:${PORT}`;
const baseWs = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;

// Runtime vars for the worker. Build-time values (APP_BUILD_ID, NODE_ENV,
// APP_ENVIRONMENT) are inlined by the build, not set here.
const workerVars: Record<string, string> = {
    // Signs and verifies the test JWTs (tests/auth.setup.ts).
    AUTH_SECRET: process.env.AUTH_SECRET ?? '',
    AUTH_URL: ORIGIN,
    NEXTAUTH_URL: ORIGIN,
    // Dummy key: the production build has no "skip the send" branch, so the OTP
    // flow sends — scripts/e2e-cf-resend-stub.js answers api.resend.com locally.
    RESEND_API_KEY: 're_e2e_stub_not_a_real_key',
    // Same as the dev path (see playwright.config.ts webServer.env).
    FOLLOWUPS_EPOCH: '2020-01-01T00:00:00Z',
};
// The values travel in the server's env and are expanded by its shell, so no
// secret is written into the command string (or a file) and none needs quoting.
const bindings = Object.keys(workerVars).map((k) => `--binding "${k}=$E2E_CF_${k}"`).join(' ');
const bindingEnv = Object.fromEntries(Object.entries(workerVars).map(([k, v]) => [`E2E_CF_${k}`, v]));

export default defineConfig({
    ...base,
    use: { ...base.use, baseURL: ORIGIN },
    webServer: {
        ...baseWs,
        command: [
            // Checked here, not at config load, so `--list` works without it.
            'test -n "$E2E_CF_AUTH_SECRET" || { echo "AUTH_SECRET is required (.env.local locally, the workflow env in CI)" >&2; exit 1; }',
            'node scripts/setup-test-db.js',
            'node scripts/e2e-cf-prepare.mjs',
            // D1 binding `DB` comes from wrangler.toml; --persist-to is the same
            // state dir `wrangler d1 execute DB --local` uses (tests/db.ts).
            `npx wrangler pages dev .vercel/e2e-cf-static --port ${PORT} --persist-to .wrangler/state ${bindings} --show-interactive-dev-session=false`,
        ].join(' && '),
        url: `${ORIGIN}/api/ready`,
        reuseExistingServer: false,
        env: {
            ...bindingEnv,
            CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
            WRANGLER_SEND_METRICS: 'false',
        },
    },
});
