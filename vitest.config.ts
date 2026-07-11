import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Scoped to src/**/*.test.ts so Vitest never picks up the Playwright e2e
// specs in tests/ (which import @playwright/test and must not run here).
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
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
