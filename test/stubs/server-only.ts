// Test-only stub for the `server-only` marker package.
//
// The real `server-only` package's index.js unconditionally throws ("cannot
// be imported from a Client Component module") and only no-ops when bundled
// with Next's webpack, which resolves the package's `react-server` export
// condition to `empty.js`. Vitest doesn't apply that condition, and the
// package isn't even present in root node_modules in this repo, so any
// lib that transitively imports `@cloudflare/next-on-pages` (which requires
// `server-only`) fails to load under vitest.
//
// This file is aliased in vitest.config.ts so those imports resolve to a
// no-op, mirroring what Next does server-side. It has no effect on the real
// build — Next's own bundler never sees this file.
export {};
