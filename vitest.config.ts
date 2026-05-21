import { defineConfig } from 'vitest/config';

// Scoped to src/**/*.test.ts so Vitest never picks up the Playwright e2e
// specs in tests/ (which import @playwright/test and must not run here).
export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
    },
});
