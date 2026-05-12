# Next.js + dep security upgrade

**Status:** pending — user to run manually
**Date drafted:** 2026-05-12
**Triggered by:** 34 Dependabot alerts on the staging branch (2 critical, 11 high, 18 moderate, 3 low) flagged on push of v2.14.10-7.

## TL;DR

One coordinated upgrade resolves ~33 of the 34 alerts:
- **`next` 15.1.6 → 15.5.18** clears all 25 next-related advisories, including two that are highly relevant to this app's surface: the **Middleware Authorization Bypass (GHSA-f82v-jwr5-mffw, critical)** and the **React flight RCE (GHSA-9qr9-h5gf-34mp, critical)**. Fix also covers postcss and several DoS / SSRF / cache-poisoning issues.
- **`@cloudflare/next-on-pages` → latest** clears the undici + esbuild chain. These are build/dev-tool transitive deps; they do not ship to Cloudflare's Workers runtime, but cleaning them quiets the audit and removes a dev-server XSS class.

## Why this is a separate PR

The Dependabot alerts surfaced right after the v2.14.10-7 push (UX change). Mixing a Next minor-version bump into a UX PR would muddy the blast radius if anything regresses. Sequence: land the UX PR on staging → verify → ship this dep upgrade as its own staging-first PR.

## Runtime exposure (why this isn't theoretical)

The app's `src/middleware.ts` gates `/my-animals`, `/my-adopters`, `/my-adoptions`, `/settings`, `/admin`. The Authorization Bypass advisory hits exactly this surface. The RCE advisory hits React Server Components, which the app uses extensively. Both are critical, both are reachable.

## Commands

Run from the repo root (`/mnt/c/dev/test`):

```bash
# 1. Upgrade Next
npm install next@15.5.18

# 2. Upgrade Cloudflare adapter (clears undici + esbuild transitive deps)
npm install -D @cloudflare/next-on-pages@latest

# 3. Verify
npx tsc --noEmit
npm run lint                          # must stay ≤125 warnings
npm run build                         # this is the real signal — Next minor bumps can break build config
npx playwright test --project=authed  # quick smoke; full suite runs in CI

# 4. Re-audit
npm audit --omit=dev                  # expect: near zero alerts

# 5. Version-bump + commit + push to staging (see .agents/workflows/deploy.md)
npm version <next-build-suffix> --no-git-tag-version   # use whatever build suffix is current
# Update CHANGELOG.md
git add package.json package-lock.json CHANGELOG.md
git commit -m "v<version>: bump Next 15.1.6 → 15.5.18 + @cloudflare/next-on-pages (security)"
git push origin HEAD:staging
```

## What to watch for during build / e2e

Next 15.1 → 15.5 is a minor bump within v15. Generally drop-in safe, but historically these are areas to verify:

1. **Middleware matcher semantics** — one of the fixed advisories (GHSA-36qx-fr4f-26g5) is in the Pages Router middleware path. App Router is what we use, but middleware matcher changes have leaked across before. Sanity-check that `/my-animals` still requires auth, that `/admin/*` still gates on admin role, and that the `/keystatic` CMS route still works.
2. **CSP nonce behavior** — GHSA-ffhc-5mcf-pf4q tightened nonce handling. If the app sets a CSP header anywhere, verify inline scripts still execute.
3. **`<Image>` component** — multiple Image-Optimizer advisories were fixed; the API surface didn't change but the `remotePatterns` validator got stricter. Check the homepage hero, animal photos, and adopter thumbnails.
4. **Edge runtime** — homepage (`src/app/page.tsx`) uses `export const runtime = 'edge'`. Confirm cold-start still works after the upgrade.
5. **`async_hooks` webpack alias** in `next.config.ts` — the workaround for Cloudflare Workers compat. Sometimes Next refactors webpack internals across minor versions; if build complains about `async_hooks`, the alias config may need to move.

## Bundled reminder — GitHub Actions Node 20 → Node 24

The deploy pipelines log this warning on every run:

> Node.js 20 actions are deprecated. … `actions/checkout@v4`, `actions/setup-node@v4` are running on Node.js 20. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026.

**Action when convenient (before June 2026):** bump pinned versions in `.github/workflows/ci.yml` and `.github/workflows/contract-app.yml` to whichever tag of `actions/checkout` and `actions/setup-node` runs on Node 24 (likely `@v5` by the time this is read). Low urgency — September 2026 is the actual removal date — but might as well roll it in with the next CI touch.

## What's left after this upgrade

After `npm audit --omit=dev`, the remaining alerts (if any) should be:
- Dev-only tooling (lower urgency, run `npm audit` for the full picture including devDependencies).
- Anything Dependabot raised against `master` that hasn't been merged from staging yet.

Re-run `gh api repos/jurfalino/verazadoptantes2/dependabot/alerts` after the deploy to confirm the count dropped.

## If the upgrade breaks

Fastest rollback: Cloudflare Pages dashboard → Deployments → "Rollback to this deployment" on the previous v2.14.10-7 build. Reverting the `package.json` and `package-lock.json` changes via `git revert` is also clean since this PR is dependency-only.
