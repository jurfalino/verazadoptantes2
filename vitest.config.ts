import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Scoped to src/**/*.test.{ts,tsx} so Vitest never picks up the Playwright e2e
// specs in tests/ (which import @playwright/test and must not run here).
export default defineConfig({
    // Vite 8's default transform (oxc) parses .tsx type annotations fine, but
    // its SSR import-rewrite pass (used when a test does `renderToStaticMarkup`)
    // fails on raw JSX unless the JSX runtime is configured explicitly. Without
    // this, any .test.tsx file that renders JSX throws "Unexpected JSX
    // expression" from vite's ssrTransformScript. (`esbuild.jsx` is a no-op
    // here since Vite 8 auto-converts it to `oxc` only when `oxc` is unset —
    // setting `oxc` directly is clearer.)
    oxc: {
        jsx: { runtime: 'automatic' },
    },
    test: {
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        // Pin the suite to a zone that is neither UTC (what the Cloudflare
        // Worker runs in) nor America/Argentina/Buenos_Aires (what most viewers
        // run in, and our DEFAULT_TIMEZONE). Any formatter that reads the host
        // zone instead of taking an explicit `timeZone` then produces a visibly
        // wrong string and fails src/lib/dates.test.ts.
        //
        // This is the guardrail for the React #418 hydration bug of 2026-09-07
        // (errorId 43d67f9e): SSR in UTC and hydration in the viewer's zone
        // rendered different days for the same value. Picking a test zone that
        // matched either side would have let that bug pass green.
        env: { TZ: 'Pacific/Kiritimati' }, // UTC+14
    },
    resolve: {
        alias: {
            // Mirror the `@/*` → `src/*` path alias from tsconfig so unit-tested
            // modules can use the same imports as the rest of the app.
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            // `server-only` isn't resolvable under vitest (not installed at
            // root, and Next's own compiled copy throws unconditionally
            // unless webpack-aliased server-side). See test/stubs/server-only.ts.
            'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
            // `@cloudflare/next-on-pages` requires `server-only` via Node's
            // native require() (node_modules deps are externalized by vitest,
            // which bypasses the alias above). Stub the whole package instead
            // so libs like axiom.ts that import getRequestContext can load
            // under vitest. See test/stubs/cloudflare-next-on-pages.ts.
            '@cloudflare/next-on-pages': fileURLToPath(new URL('./test/stubs/cloudflare-next-on-pages.ts', import.meta.url)),
        },
    },
});
