// Test-only stub for `@cloudflare/next-on-pages`.
//
// The real package's compiled entry does `require("server-only")`, which
// throws/fails to resolve outside of Next's webpack build (see
// test/stubs/server-only.ts for detail — aliasing just that inner import
// isn't enough because vitest treats node_modules deps as external and lets
// Node's own `require()` resolve them, bypassing Vite's alias resolution).
//
// Aliasing the whole package to this stub sidesteps the chain entirely.
// `getRequestContext` throwing here is safe: every call site in this repo
// (see src/lib/axiom.ts, db.ts, logger.ts, etc.) already wraps it in
// try/catch and falls back to `process.env`, which is exactly the runtime
// behavior outside of a Cloudflare Workers request (e.g. in tests).
export function getRequestContext(): never {
    throw new Error('getRequestContext: no Cloudflare request context (test stub)');
}
