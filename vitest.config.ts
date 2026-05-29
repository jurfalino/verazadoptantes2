import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Scoped to src/**/*.test.ts so Vitest never picks up the Playwright e2e
// specs in tests/ (which import @playwright/test and must not run here).
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
    },
    resolve: {
        // Mirror the `@/*` → `src/*` path alias from tsconfig so unit-tested
        // modules can use the same imports as the rest of the app.
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
