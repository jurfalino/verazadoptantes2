---
name: NEXT_PUBLIC_* and VITE_* are build-time inlines, not runtime reads
description: Build-time-prefixed env vars cannot be set per-environment from Cloudflare runtime variables. For client-visible URLs that must differ per env, use a server-side resolver + API endpoint instead.
type: project
originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---
In this repo, **`NEXT_PUBLIC_*` (Next.js) and `VITE_*` (contract-app) env vars are inlined into the client bundle at build time.** Cloudflare's per-environment runtime variables/secrets are invisible to them — Cloudflare isn't doing the build, GitHub Actions is.

This has already burned us twice:
- `NEXT_PUBLIC_CONTRACT_URL` baked the same value into both staging and prod bundles → staging dashboards generated prod share URLs.
- `VITE_API_URL` baked staging into the prod contract-app bundle → prod contract page called staging API and 404'd.

**Why:** the CI (`.github/workflows/ci.yml`) and contract-app workflow run `next build` / `vite build` on GitHub Actions runners. Whatever those build steps see in `process.env` / `import.meta.env` gets compiled into string literals. Cloudflare env vars set in the Pages dashboard are runtime values, available only to server code (route handlers, middleware, Workers) via `getRequestContext().env`.

**How to apply:**
- For any client-visible URL or config that must differ per environment, do NOT use `NEXT_PUBLIC_*` / `VITE_*`. Instead: read from `CONTRACT_BASE_URL`-style runtime binding via a server resolver (`src/lib/contractUrl.ts` pattern) + tiny API endpoint (`/api/contract-base`) + client hook (`src/hooks/useContractBase.ts`).
- If a build-time inline is unavoidable, forward the value from a GH repo variable into the build step's `env:` block, with branch-conditional logic. See `.github/workflows/contract-app.yml` Build step for the pattern.
- Cloudflare's CONTRACT_BASE_URL setting only works on the *Next.js project* (`verazadoptantes2`) — it does nothing on the *contract-app project* (`adoptions` / `adoptions-staging`), since that's a static SPA with no server.
