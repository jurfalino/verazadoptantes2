# Multi-Domain Branding (white-label by host)

**Status:** Not scheduled — reference plan, captured 2026-06-14. Do not start without re-confirming.

## Goal

Serve the **same** BuenAdoptante app from one or more **additional custom domains** (besides
`buenadoptante.org`), where the **branding shown depends on the domain used to access it**
(logo, app name, colors, page titles/metadata, favicon, OG image).

## Decision record

- **Scope chosen: "Same data, different skin" (cosmetic re-skin).** All domains share the same
  D1 database, the same adopters/records, and the same users. Only presentation changes per host.
  This is **not** multi-tenancy — no per-domain data isolation. (If isolation is ever wanted later,
  that's a separate, much larger project built on the existing `organizations` / `org_members`
  tables.)
- **Public surface is unaffected.** The showcase + form + contract flows already live on their own
  separate domain (see memory `project_public_surface_separation`). This plan is only about the
  authenticated main Next app. Do **not** fold the public surface into this.

## Why this fits the stack (context)

- Deployed to **Cloudflare Pages**, project **`verazadoptantes2`** (`wrangler.toml:1`). Pages allows
  **multiple custom domains on one project/deployment** — both domains serve the identical build,
  so branding is a pure runtime concern.
- There is already a clean precedent for resolving config at **request time** (to avoid the
  `NEXT_PUBLIC_*` build-time-inline trap): `src/lib/contractUrl.ts` reads from the Cloudflare worker
  context. Brand-by-host is the same pattern keyed on the `Host` header.
- `Host` header is already read in `src/middleware.ts` and several API routes — established ground.
- `trustHost: true` is already set (`src/auth.config.ts:122`), so NextAuth infers the host from
  request headers and builds callbacks against the requesting domain automatically.

---

## PART A — Manual steps (cannot be done in code)

These are one-time, per-new-domain operations done in external dashboards. Do them **before** or
alongside the code work; the code is harmless until a domain actually points at it.

### A1. Acquire the domain
- Register/own the new domain (registrar of choice, or buy through Cloudflare Registrar).
- **Constraint to honor:** the new branding domain must NOT be `buenadoptante.org` and must NOT be
  the public-surface domain (showcase/form/contract). It is a third, independent domain.

### A2. Add the domain to Cloudflare (DNS)
- In the Cloudflare dashboard, add the domain as a **zone** (if not bought via Cloudflare Registrar),
  or confirm it's already in the account.
- Update the registrar's nameservers to Cloudflare's if it's a new zone.

### A3. Attach the domain to the Pages project
- Cloudflare Dashboard → **Pages → `verazadoptantes2` → Custom domains → Set up a custom domain**.
- Add the new domain (and `www.` variant if desired).
- **CRITICAL — production branch gotcha** (memory `project_pages_production_branch`): the custom
  domain must be attached to the **production** deployment. For this project, production = the
  `master` branch build. If the domain ends up aliased to a Preview deployment it will silently
  serve stale/preview builds. Verify after setup that the domain resolves to the production
  deployment, not a preview.
- Cloudflare provisions the SSL cert automatically (can take a few minutes).

### A4. Google OAuth — register the new domain's callback
NextAuth uses Google OAuth (`src/auth.config.ts`). Each domain needs its callback URL whitelisted.
- Google Cloud Console → **APIs & Services → Credentials → the OAuth 2.0 Client ID** used by the app.
- Under **Authorized redirect URIs**, add:
  - `https://<newdomain>/api/auth/callback/google`
  - (and `https://www.<newdomain>/api/auth/callback/google` if `www` is used)
- Under **Authorized JavaScript origins**, add `https://<newdomain>`.
- Save. Google changes can take 5 min–several hours to propagate.
- Because `trustHost: true` is already set, **no `AUTH_URL` change is needed** — NextAuth builds the
  callback from the incoming host. Just make sure no hardcoded `AUTH_URL` / `NEXTAUTH_URL` env var
  pins the callback to `buenadoptante.org` (check Pages env vars; if present, it must be unset or
  the host-trust path used).

### A5. Accept the cross-domain auth behavior (or mitigate)
- **Cookies are per-domain.** A Google session on `buenadoptante.org` is NOT shared with the new
  domain — same user, same data, but they sign in **separately on each domain**.
- For a re-skin aimed at a distinct audience this is normally fine. If you want one login shared
  across domains, that's a bigger change (central auth domain + redirect dance / SSO) — out of scope
  for this plan; note it as a follow-up if it becomes a requirement.

### A6. Per-environment env vars (if the brand needs any runtime config)
- If brand resolution needs any server-side env (it shouldn't for a static brand map), set it in
  **Pages → Settings → Environment variables**, per environment (production vs preview), the same
  way `CONTRACT_BASE_URL` is set today. Do NOT use `NEXT_PUBLIC_*` for anything host-dependent.

### A7. Optional polish
- **Favicon / icons:** today these are static file-convention icons in `src/app/`
  (`icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`). Per-brand favicons require
  either dynamic icon routes or host-served assets (see B5). If acceptable, all brands can share the
  current favicon initially and this becomes a later refinement.
- **SEO:** decide whether the new domain should be indexable. Update `src/app/robots.ts` and
  `src/app/sitemap.ts` (both currently hardcode `buenadoptante.org`) so each host emits its own
  canonical / sitemap, or canonicalize everything to the primary domain to avoid duplicate-content
  penalties.
- **Analytics:** Clarity is loaded via Zaraz (memory `project_clarity_via_zaraz`), not app code — if
  per-domain analytics separation is wanted, configure it in Zaraz, not in the app.

---

## PART B — Code implementation plan (~3–4 focused days, skin-only)

Build order. Each step is independently shippable and harmless until a second domain exists.

### B1. Brand config + resolver  (~½ day)
- New `src/config/brands.ts`: a map `hostname → BrandConfig`:
  ```
  { key, name, tagline, logoSrc, faviconSrc, themeKey, ogImageSrc, metadataBase, supportEmail, indexable }
  ```
  with `buenadoptante.org` as the **default/fallback** entry (so unknown hosts and local dev render
  the canonical brand).
- New server resolver `getBrand()` — reads `headers().get('host')` (strip port), normalizes
  `www.`, looks up the map, returns default on miss. Model it on `src/lib/contractUrl.ts`.
- Client access: either a root **server-context provider** (preferred — root layout is a server
  component) injecting the resolved brand, or a `/api/brand` endpoint + `useBrand()` hook (mirrors
  the existing contract-url client-hook pattern). Prefer the provider to avoid an extra fetch.
- **Do NOT** route brand through `NEXT_PUBLIC_*` — build-time inline trap
  (memory `project_buildtime_envvars`).

### B2. Dynamic metadata  (~½ day)
- `src/app/layout.tsx` currently exports a **static** `metadata` object with `metadataBase` hardcoded
  to `https://buenadoptante.org` and `BuenAdoptante` in title/OG/twitter/authors/siteName.
  Convert to **`generateMetadata()`** that reads the host and returns brand-specific title template,
  description, `metadataBase`, openGraph, twitter, icons.
- Repeat for the per-page `layout.tsx` files that set their own static metadata (quienes-somos,
  privacy, terms, guia, invite, adopter, contract-results, demo-profile, health, …). Grep for
  `export const metadata` to enumerate.

### B3. Extract hardcoded brand strings  (THE BULK — ~1–2 days)
- ~145 occurrences of `BuenAdoptante` / `buenadoptante` across `src/` (excluding tests). Each
  visible one becomes `brand.name` (server) or `useBrand().name` (client).
- **Categorize first** — not all should be rebranded:
  - **Rebrand:** visible UI copy, page titles, alt text, `siteName`, header/footer name.
  - **Keep literal (audit before touching):** legal entity name in `terms`/`privacy`, structured-data
    `author`/`creator` if it must stay the legal owner, audit/source attribution, any DB-stored value,
    canonical primary-domain URLs.
  - **i18n:** strings already going through `t()` may need a brand-name interpolation token rather
    than a hardcoded name inside `en.ts`/`es.ts` — update **both** locale files together
    (default locale is `es`).
- Verify Playwright selectors that assert on brand text — update specs in the same commit as any
  visible-text change (memory `feedback_grep_tests_before_deletion`).

### B4. Brand-default theme  (~½ day; more if a new palette)
- Theme is applied today via an inline script in `src/app/layout.tsx` that reads `localStorage` and
  sets `data-theme` on `<html>` (user-chosen; `ThemeContext` + `ThemeSelector`).
- For brand-by-domain: inject the brand's `themeKey` **server-side** as the initial `data-theme`,
  so first paint is already branded. Decide per brand whether the user theme override
  (`ThemeSelector`) stays enabled or is locked.
- A genuinely new color scheme = a new `[data-theme="<brandKey>"]` block in `globals.css`. Honor the
  theming rules (memories): palette is remapped under `[data-theme]` selectors, NOT Tailwind `dark:`
  variants; only **themed** Tailwind colors are theme-safe — gradient stops, `ring-*`, hover variants,
  literal hex, and out-of-palette shades render raw. **Grep `globals.css` before adding any class.**
  `ThemeSelector` labels are not i18n'd.

### B5. Per-brand assets  (~½ day)
- Logo component reads `brand.logoSrc`. Store brand assets under `public/brands/<key>/`.
- Favicon/OG per brand: simplest first cut is a dynamic `icon`/`opengraph-image` route that resolves
  the brand from host; or accept a shared favicon initially (see A7).

### B6. Caching / correctness  (~¼ day)
- The homepage (`src/app/page.tsx`) is **edge runtime** (`export const runtime = 'edge'`). Ensure its
  response is NOT cached cross-host (Vary on `Host`, or confirm Cloudflare's per-host cache keying)
  so brand A's HTML is never served on brand B's domain. Audit any other statically-cached/ISR route
  the same way. Auth-gated dynamic pages are inherently safe.

---

## Testing checklist
- [ ] `npx tsc --noEmit` clean; lint under ratchet (125).
- [ ] On staging, simulate the second host (e.g. `Host` header override or a staging custom domain)
      and confirm name, theme, metadata, favicon all switch.
- [ ] Default/unknown host renders the canonical BuenAdoptante brand (fallback works).
- [ ] OAuth sign-in completes on the new domain (after A4 done) and lands authenticated.
- [ ] `view-source` on each domain shows correct `<title>`, OG tags, canonical, `metadataBase`.
- [ ] No `BuenAdoptante` literal leaks on the second brand's visible surfaces.
- [ ] Playwright `authed` / `user` / `unauthed` projects still green.
- [ ] No cross-host cache bleed on the edge homepage.

## Open questions to resolve before starting
1. **How many additional domains**, and are their brands known up front (static map fine) or should
   brand config be DB-backed/admin-editable (use the `appConfig` pattern)?
2. **Theme override:** locked per brand, or user can still switch via `ThemeSelector`?
3. **SEO/indexing:** index each domain independently, or canonicalize all to the primary domain?
4. **Legal copy:** does `terms`/`privacy` legal-entity naming stay BuenAdoptante on all brands, or
   vary per brand? (Drives how much of B3 is rebrand vs keep-literal.)
5. **Shared login** ever required across domains? If yes, scope a central-auth follow-up.

## Effort summary
- Manual (Part A): ~1–2 hours of dashboard work per domain + DNS/SSL/OAuth propagation wait.
- Code (Part B): ~3–4 focused days, dominated by B3 (string extraction). New palette adds ~½–1 day.

## Explicitly out of scope
- Per-domain data isolation / multi-tenancy.
- Merging or splitting the public showcase/form/contract surface.
- Shared single-sign-on across domains.
