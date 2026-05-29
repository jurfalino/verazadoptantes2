---
name: project-buildtime-vs-runtime-deps
description: Which BuenAdoptante npm deps ship to Cloudflare Workers runtime vs. only run at build/dev time — relevant for security triage
metadata: 
  node_type: memory
  type: project
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

When triaging dep security alerts on this project, separate runtime-reachable deps from build-time-only deps.

**Runtime (ships to Cloudflare Workers):**
- `next` (App Router code)
- `react`, `react-dom`
- `drizzle-orm`, `next-auth`, `zod`
- Anything inside `src/` that gets bundled

**Build / dev only (does NOT ship to production Workers):**
- `@cloudflare/next-on-pages` — adapter that transforms the Next build into Workers-compatible output. Runs in CI, not at runtime.
- `wrangler` + `miniflare` — local emulator + deploy CLI.
- Transitive `undici` (pulled in by `@cloudflare/next-on-pages` and `miniflare`) — Workers runtime has its own `fetch` impl, not Node's undici. Undici advisories don't reach production traffic, even when they look scary at high severity.
- `esbuild` (transitive) — only used by the adapter at build time.
- `postcss` (transitive) — Next CSS pipeline at build time.

**Why:** Cloudflare Workers uses its own runtime, not Node.js. Transitive deps that exist only for the Node toolchain don't get shipped. When `npm audit` flags `undici` or `esbuild` at "high" severity, they're real for local dev (XSS-on-dev-server class) but not for users hitting production. This changes urgency.

**How to apply:** when prioritizing security PRs, upgrade the runtime deps urgently and the build-time deps when convenient. Don't conflate "high CVSS" with "high user impact" — the Workers boundary catches a lot of it.

Related: [[project-security-exposure]], [[project-buildtime-envvars]]
