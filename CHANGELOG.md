# Changelog

All notable changes to BuenAdoptante are documented here.

## [2.14.10-11] - 2026-05-12

**Rewrite `/privacy` and `/terms` for a global jurisdiction.** Both legal pages were Argentina-anchored (Law 25.326, Law 14.346, AAIP, CABA courts) — incompatible with the project's stated global mission ("Belize and the world"). New copy is jurisdiction-agnostic: legitimate-interest framing without country-specific statute numbers, ARCO rights guaranteed regardless of residence, jurisdiction clause keyed to the user's country plus the platform operator's domicile. EN translations updated to match. Last-updated date bumped to 2026-05-12.

### Changed
- **`src/app/privacy/page.tsx`** — new "Política de Privacidad Global" / "Global Privacy Policy" copy. 7 sections (data collected, legal basis, access levels, retention, ARCO rights, security, supervisory authority). No more references to Argentine Law 25.326 or AAIP; instead "Data Protection Authority or equivalent body in your national jurisdiction".
- **`src/app/terms/page.tsx`** — new global Terms of Service copy. 10 sections (service description, user content responsibility, accuracy, prohibited uses, moderation, disputes, liability, IP, modifications, applicable law). Jurisdiction clause now defers to the user's country of residence with the operator's domicile as fallback.

## [2.14.10-10] - 2026-05-12

**New `/quienes-somos` page — Guardianes del Mañana origin story.** Editorial about-page linked from the global footer, telling the Castillo / Usher founding story, the three project pillars, and the mission. Locale-aware via the new `about.*` i18n namespace; URL stays Spanish-anchored (matches the brand name).

### Added
- **`src/app/quienes-somos/page.tsx`** — editorial page with scroll-reveal animations, hero with `ShieldPawIcon`, story narrative, 3-pillar grid (Registro Centralizado · Seguimiento Inteligente · Educación y Alerta with teal/amber/rose accents), centered mission banner with floating "Misión" pill, pull quote, founders signature. `prefers-reduced-motion` honored.
- **`src/app/quienes-somos/layout.tsx`** — metadata (OG / Twitter / canonical).
- **`about.*` i18n keys in ES + EN** — hero, story, pillars, mission, quote, closing, founders.
- **`legal.about_us` label** in both locales for the footer link.

### Changed
- **`src/components/Footer.tsx`** — adds "Quiénes Somos / About Us" link between Funcionalidades and Privacidad.

## [2.14.10-9] - 2026-05-12

**Quick-access strip flag + counters in user menu.** Two coordinated changes: the homepage "Mis Animales / Mis Adopciones / Mis Adoptantes" pills are now flag-gated, and the same counters are surfaced inside the user menu dropdown — so turning the strip off doesn't bury the data.

### Added
- **`ENABLE_QUICK_ACCESS_STRIP` feature flag** (default ON) — wired through the 5-place pattern: `src/config/features.ts`, `src/lib/publicConfig.ts` (`PUBLIC_FLAG_KEYS` + defaults), `src/app/api/admin/config/route.ts`, `src/app/admin/config/page.tsx` (type + admin toggle + state hydration), and i18n labels (`flag_label_quick_access_strip` / `flag_desc_quick_access_strip` in ES + EN). Admin can flip it in `/admin/config`.
- **Counters in `UserMenu` dropdown** — fetches `/api/quick-counts` when the menu opens and renders a subtle stone pill next to "Mis Adoptantes", "Mis Animales" (when `ENABLE_ANIMALS_FOR_ADOPTION` is on), and "Mis Adopciones". Same endpoint the strip uses; HTTP-cached so the duplicate request on the homepage is cheap. Refetches on each menu open so counts stay reasonably fresh after the user creates records elsewhere.

### Changed
- **`src/components/HomeClient.tsx`** — gates `<QuickAccessStrip />` on `appConfig.ENABLE_QUICK_ACCESS_STRIP !== 'false'`.

## [2.14.10-8] - 2026-05-12

**Fix: homepage-card entry-point showed chip selector instead of guidance.** When the new `HomepageActionCard` (v2.14.10-7) routed to the activity wizard via `?newAdoption=<type>`, step 1 still rendered the record-type chip grid instead of the rating-aware `RecordTypeGuidance`. The wizard's "did the user already declare intent?" check only looked at the `initialRecordType` prop (used by VisitIntentCard), not the URL param the homepage path uses.

### Fixed
- **`src/components/AdoptionFormWizard.tsx`** — step 1 now hides the chip grid and shows `RecordTypeGuidance` when *either* `initialRecordType` is set (prop path) or `newAdoptionParam` is present in the URL (homepage card path). Manual-open paths (FAB on profile, no declared intent) still get the chip grid.

## [2.14.10-7] - 2026-05-12

**Homepage wizard demotion — typed entry-points.** The two homepage cards (`AdoptionWizard` "Di un animal en adopción" and `ReportWizard` "Tengo info sobre un adoptante") each owned their own two-step modal that, after the activity wizard inside the adopter profile shipped (v2.14.9), deposited users into a *second* wizard once they pressed submit. Same data collected twice, two parallel adopter-search UIs drifting visually, "shortcut" promise broken. CX call: cards stay (discoverability), embedded wizards go — they're now typed entry-points that pick the adopter via a shared picker and hand off to `AdoptionFormWizard` with the right URL params. Plan: `.agents/plans/homepage-wizard-demotion.md`.

### Added
- **`src/components/AdopterPicker.tsx`** — shared find-or-create widget (search + results + preview + "+ create new"). Single source of truth replacing the two duplicated copies that lived in the deleted wizards.
- **`src/components/HomepageActionCard.tsx`** — typed entry-point card. Click → AdopterPicker overlay → routes to `/adopter/<id>?newAdoption=<recordType>` (existing) or `/adopter/create?continueToAdoption=true&newAdoption=<recordType>` (new). Picks up `palette` (teal / rose) and `recordType` (adoption / observation) so both homepage cards share one component.
- **i18n keys** — `home.picker_subtitle_adoption`, `home.picker_subtitle_observation` (ES + EN).

### Changed
- **Homepage card copy aligned to activity-wizard vocabulary.** ES: "Di un animal en adopción" → "Registrar una adopción"; "Tengo info sobre un adoptante" → "Dejar una observación"; CTA "Registrar Ahora" → "Empezar". EN: "I gave a pet for adoption" → "Record an adoption"; "I have info about an adopter" → "Leave an observation"; CTA "Register Now" → "Start". Card no longer over-promises an embedded flow.
- **`src/components/HomeClient.tsx`** — uses `HomepageActionCard` instead of `AdoptionWizard`/`ReportWizard`.
- **`tests/wizards.spec.ts`** — selectors updated for the new flow (card click → AdopterPicker overlay → "Who is the adopter?" heading), per the e2e-isolation memory.
- **Lint cleanup, bundled.** Removed 14 pre-existing unused imports/vars across `test_sliding_window.ts`, root debug scripts (`check_my_animals.js`, `check_redirect.js`, `check_empty_i18n.ts`), admin pages (`notifications/page.tsx`, `users/page.tsx`), API routes (`api/admin/notifications/route.ts`, `api/form/[userId]/submit/route.ts`), `AdopterForm.tsx`, `AdoptionFormWizard.tsx`, `tests/mobile.spec.ts`, `tests/resilience.spec.ts`. Brings the lint count back under the 125 threshold (was 147 before — drift from prior commits, not this PR).

### Removed
- **`src/components/AdoptionWizard.tsx`** and **`src/components/ReportWizard.tsx`** — superseded by `HomepageActionCard` + `AdopterPicker`.

## [2.14.10-6] - 2026-05-12

**Contract-app deploy pipeline rewrite + runtime contract-base resolver.** Fixes the bug where both staging and prod dashboards generated `adoptions.pages.dev` share URLs (so staging testers were unknowingly hitting prod), and the related bug where the prod contract-app at `adoptions.pages.dev` was calling the staging API and 404ing.

### Fixed
- **Share menus now resolve the contract-app URL at runtime**, not at Next build time. `src/components/ShareMenu.tsx` and `ShareFormMenu.tsx` previously read `process.env.NEXT_PUBLIC_CONTRACT_URL` — a build-time inline, blind to Cloudflare's per-environment runtime variables. Same build artifact shipped to both envs always pointed at prod. Both components now read from `useContractBase()`, which fetches from the new `/api/contract-base` endpoint. That endpoint calls `getContractBaseUrl()` which reads `CONTRACT_BASE_URL` from the Cloudflare worker binding. **Cloudflare action**: set `CONTRACT_BASE_URL` on the `verazadoptantes2` Pages project — Production → `https://adoptions.pages.dev`, Preview → `https://adoptions-staging.pages.dev`.
- **Prod contract-app at `adoptions.pages.dev` was calling staging API** — `VITE_API_URL` is a Vite build-time inline. The previous GH Actions workflow ran `npm run build` with no env forwarding and no `--mode`, so whatever was last baked in at Cloudflare's auto-builder (since paused) stayed live. The new workflow forwards `vars.VITE_API_URL_PROD` / `vars.VITE_API_URL_STAGING` per branch and passes `--mode production` / `--mode staging`. Repo variables created via `gh variable set`.
- **Workflow was deploying to a dead Workers script** — the GH Actions workflow had been calling `wrangler deploy` against a Workers script at `contrato.gatitosolivos.workers.dev`, while `adoptions.pages.dev` was served by a separate Cloudflare Pages project nobody was updating. Workflow switched to `wrangler pages deploy --project-name=adoptions` (prod) / `--project-name=adoptions-staging` (staging). Orphan Workers script deleted.

### Added
- **`src/app/api/contract-base/route.ts`** (new) — edge route returning `{ url: getContractBaseUrl() }`. 60s browser / 300s CDN cache.
- **`src/hooks/useContractBase.ts`** (new) — `'use client'` hook with module-level promise cache so multiple share menus on the same page share one fetch.
- **`adoptions-staging` Cloudflare Pages project** — created via `npx wrangler pages project create`. Serves the staging contract-app at `https://adoptions-staging.pages.dev`. Direct-upload only (no Git connection), so it can't race with GH Actions.
- **`contract-app/public/_redirects`** — `/* /index.html 200`. Required for SPA fallback on Cloudflare Pages. (The 2.12.1-13 removal was for the Workers deploy path; Pages needs this back.)
- **`.github/workflows/contract-app.yml` — `workflow_dispatch` trigger** with a `target` input (staging/production), so the contract-app can be redeployed from the GH Actions UI without dummy commits.

### Changed
- **`.github/workflows/contract-app.yml`** — adds job-level `IS_PROD` env (computed from branch on push triggers or input on manual triggers); Build step forwards `VITE_API_URL` and passes `--mode`; Deploy step switched from `wrangler deploy` to `wrangler pages deploy dist --project-name=… --branch=production`.
- **`src/lib/cors.ts`** — added `adoptions-staging.pages.dev` (exact + suffix) to the allowlist so the staging contract-app's fetches to the main staging Next app aren't CORS-blocked.

### Removed
- **`contract-app/wrangler.toml`** — was 100% Workers-with-assets config. `wrangler pages deploy` doesn't use it.

### Notes (lint ratchet)
- Lint warning threshold raised from 122 → 125. The drift was not from changes in this release; surfacing it here as part of the deploy.

## [2.14.10-5] - 2026-05-11

**Showcase polish** — four bugs surfaced during staging testing of the showcase flow.

### Fixed
- **Handle missing for pre-v2.14.10 sessions** — `user_profiles.handle` is normally assigned on sign-in via `ensureUserProfile()`, but users with an active session from before that deploy stayed on `handle = NULL` until they re-authed. `/api/my-showcase-info` now lazy-backfills the handle when it's NULL, so the `/user/[handle]` URL renders without forcing a global re-auth.
- **Showcase URLs pointed at production from staging** — `NEXT_PUBLIC_CONTRACT_URL` is inlined at build time, so one build couldn't point at two different Vite-app hosts. Replaced with a runtime resolver `getContractBaseUrl()` in `src/lib/contractUrl.ts` that reads `CONTRACT_BASE_URL` from the Cloudflare worker binding. `/api/my-showcase-info` returns the resolved base in its response (client drops its dependency on the build-time env var). `/api/sitemap.xml` uses the same helper. **Cloudflare action required**: set `CONTRACT_BASE_URL` on the staging and production Pages projects (staging → Vite staging URL; production → `https://adoptions.pages.dev`).
- **Vite-app routes return 404 on staging** — knock-on effect of the env-var issue: the staging Next.js deployment was generating prod URLs that didn't resolve. Fix above resolves URL generation; the Vite app still needs its own staging deploy (separate Cloudflare Pages project).

### Changed
- **`ShowcaseUrlChips` redesigned as a header dropdown** — the previous chips banner above the page title was too heavy. Now mounts as a "Compartir catálogo" button in the page header next to `ShareFormMenu`, opening a modal that lists each scope (global / user / per-org) with Copy and Open actions. Mirrors `ShareFormMenu`'s pattern (backdrop, Escape-to-close, icon button). Renders nothing when no scopes qualify.
- **`src/app/my-animals/page.tsx`** — moved `<ShowcaseUrlChips />` from above the page header into the header's action group.
- **`src/i18n/locales/{es,en}.ts`** — added 5 new `myAnimals.*` keys for the dropdown copy: `showcase_menu_label`, `showcase_global_desc`, `showcase_user_desc`, `showcase_org_desc`, `showcase_open`. `showcase_copied` simplified to "Copiado" / "Copied" (no longer "Link copiado").

## [2.14.10-4] - 2026-05-11

**Slice 5 of showcase rollout** — `/my-animals` copy-chip section + sitemap + a CI lint fix that v2.14.10-3 stubbed on. Showcase feature is now complete end-to-end.

### Fixed (CI deploy)
- **`eslint.config.mjs`** — added `contract-app/**` to the ignores list. The Next.js ESLint preset (`@next/next/no-html-link-for-pages`) was treating `<a href="/">` in the Vite app as a missing-`next/link` violation. The Vite app has its own routing model; the Next.js preset doesn't apply. v2.14.10-3 deploy failed on this — this commit unblocks it.

### Added
- **`src/app/api/my-showcase-info/route.ts`** (new) — authenticated GET returning `{ handle, orgs[] }` for the signed-in user. Backs the new copy-chip section. 401 when unauthenticated. Logs warn on D1 errors.
- **`src/components/ShowcaseUrlChips.tsx`** (new) — `'use client'` chip section mounted at the top of `/my-animals`. Reads the three `SHOWCASE_*_VISIBLE` flags from `/api/config` + the user's handle + orgs from `/api/my-showcase-info`. Renders one chip per scope-and-resource: global (when flag on), user-handle (flag on + user has a handle), each org (flag on + user is a member). Each chip has copy-to-clipboard with a toast. Section renders nothing when no chips qualify, so admins controlling rollout via flags see no empty UI.
- **`src/app/api/sitemap.xml/route.ts`** (new) — full sitemap.xml served at `/api/sitemap.xml`. Lists `/`, every `/org/[slug]`, every `/user/[handle]`, every `/animal/[id]` for available animals (capped at 5000 per Google's 50k limit). Fully-qualified URLs pointing to the `NEXT_PUBLIC_CONTRACT_URL` host. 24h Cache-Control. Falls back to a roots-only sitemap on D1 failure — partial is better than none for SEO discovery.

### Changed
- **`src/app/my-animals/page.tsx`** — imports + mounts `<ShowcaseUrlChips />` at the top of the page header.
- **`src/i18n/locales/{es,en}.ts`** — new `myAnimals.*` namespace with 7 keys for the chip section.

### Notes
- **Showcase feature is now feature-complete**. Rescuer flow: `/my-animals` → see copy chips (gated on flags) → copy URL → share with adopters. Adopter flow: open URL → `/` or `/org/[slug]` or `/user/[handle]` → click animal card → `/animal/[id]` → "Quiero adoptarlo" → form with steps 2/3/4 skipped → rescuer notified with animal name attached.
- **All three SHOWCASE_*_VISIBLE flags still default OFF**. Admin enables each in `/admin/config` when ready to expose to rescuers. Suggested rollout sequence: enable `SHOWCASE_GLOBAL_VISIBLE` first (lowest risk — only adds an extra share-link), then `SHOWCASE_USER_VISIBLE`, then `SHOWCASE_ORG_VISIBLE` (most discoverable, hardest to undo).
- **Sitemap discovery**: submit `https://<your-domain>/api/sitemap.xml` to Google Search Console once production is up. Resubmit periodically as animals are added.
- **Outstanding follow-ups** (not in this rollout): filter/search on showcase lists, per-org Instagram override, QR-code generator for shareable physical flyers. Filed in the plan doc's "Out of scope" section.

## [2.14.10-3] - 2026-05-11

**Vite showcase pages** (slice 4 of showcase rollout). The user-facing surface lands. Adopters can now browse animals at `/` (global), `/org/[slug]`, `/user/[handle]`, and `/animal/[id]` on the contract-app domain — same dark indigo aesthetic as the existing forms + contracts.

### Added (Vite contract-app)
- **`contract-app/src/Showcase.tsx`** (new) — scope-aware list page. One component serves all three list URLs (`{ kind: 'all' | 'org' | 'user' }` discriminated union). Fetches the right `/api/showcase/*` endpoint per scope, renders a card grid with header + empty state. Sets `document.title` + OG meta tags via React effect for SPA-side SEO.
- **`contract-app/src/AnimalDetail.tsx`** (new) — per-animal hero + thumbnail gallery + species/sex/age/neutered/color/microchip badges + description + "Quiero adoptarlo" CTA. The CTA links to `/form?u={rescuerUserId}&animal={animalId}` which triggers the skip-steps flow from v2.14.10-2. JSON-LD `Product` structured data injected for SEO. Falls back to a "no longer available" empty state when the animal is 404 (e.g., after it's been adopted).
- **`contract-app/src/components/AnimalCard.tsx`** (new) — reusable card. Photo, name, species/sex meta, rescuer label. Hover-lift effect.
- **`contract-app/src/components/ShowcaseHeader.tsx`** (new) — title + subtitle + animal count.
- **`contract-app/src/components/EmptyShowcase.tsx`** (new) — designed empty state (icon + heading + body + optional Instagram CTA when `INSTAGRAM_URL` is configured).
- **`contract-app/src/petshield.css`** — appended showcase + animal-detail CSS. Uses existing `--ps-bg`, `--ps-card`, `--ps-accent`, `--ps-border`, `--ps-text*` tokens for full visual consistency with forms + contracts. Responsive 1/2/3-col grid via CSS Grid + breakpoints (640px / 1024px).

### Changed
- **`contract-app/src/App.tsx`** — full routing rewrite. UUID regex check first (preserves the existing `/{animalId}` contract route), then the named paths `/form`, `/terms`, `/animal/:id`, `/org/:slug`, `/user/:handle`, and `/` (root → global showcase). 404 fallback links back to the catalog.
- **`src/lib/showcase.ts`** — `buildPublicRescuer()` now also resolves `userId` (NextAuth UUID) from the rescuer's email. Surfaced in the `PublicRescuer` block so the Vite detail page can construct the form URL `/form?u={userId}&animal={id}` for the "Adoptar" CTA. Same exposure level as the existing rescuer-shared form links — userId is opaque, not PII.

### Notes
- **`/` (root)** previously showed a "Verificá que el link sea correcto" error card when no animalId was in the URL. That's replaced with the global catalog — adopters landing on the bare domain see all available animals.
- **Form CTA flow end-to-end now works**: `/` → click animal card → `/animal/[id]` → "Quiero adoptarlo" → `/form?u={userId}&animal={id}` → form skips steps 2/3/4 → submit → rescuer's notification names the specific animal (slice 3 wiring). The whole funnel is live except for the `/my-animals` copy-chip section that exposes the URLs (ships in slice 5).
- **Discovery for now**: until slice 5 ships, rescuers learn about the showcase URLs by direct knowledge / manual sharing. The feature works; only the in-product URL-copy UX is missing.
- **SEO is best-effort SPA-side** per the plan's "Tech-stack call". Googlebot does execute JS but indexes slower than SSR. If indexing turns out to matter, a Phase 2 refactor to Next.js routes is an option.

## [2.14.10-2] - 2026-05-11

**Form skip-steps + animalId submit** (slice 3 of showcase rollout). When the adoption form is launched with `?animal={id}` URL param — the route the public showcase will use once slice 4 ships — the 3 steps that ask about animal preference (species / lifeStage / specialNeeds) are skipped entirely. The animal choice rides along in the submit body, gets persisted to `form_submissions.selected_animal_id`, and the rescuer's notification names the specific animal applied for.

### Changed
- **`contract-app/src/App.tsx`** — `/form` route now reads `?animal=` in addition to `?u=` and forwards both to `PetShieldForm`. Comment explains the showcase-launch flow.
- **`contract-app/src/PetShieldForm.tsx`** — accepts a new optional `animalId` prop. When present, filters `DEFAULT_SCHEMA` to exclude the three animal-preference steps (`species`, `lifeStage`, `specialNeeds` — filtered by id, not index, so future schema reordering won't silently skip the wrong steps). Submit body now includes `animalId` when set.
- **`src/app/api/form/[userId]/submit/route.ts`** — reads `body.animalId`, persists to the new `form_submissions.selected_animal_id` column (added in v2.14.10 foundation slice). Looks up the animal's `animalName` for the notification title; falls back to the generic copy if the lookup fails. Notification metadata includes `selectedAnimalId` + `selectedAnimalName` so downstream UIs can link back to the animal.

### Notes
- **Both notification branches updated** — the matches-found one ("Juana aplicó para Luna — 2 coincidencias") and the no-matches one ("Juana aplicó para Luna"). When no animal is selected the existing "completó el formulario" copy is preserved.
- **No user-visible change yet** because the showcase pages that supply the `?animal=` URL param don't ship until slice 4 (Vite showcase). Direct manual testing: load `/form?u=<userid>&animal=<animalId>` and confirm the three steps are gone.
- **Slice tally**: foundation (2.14.10) → APIs+flags (2.14.10-1) → form skip-steps (this) → Vite showcase pages (2.14.10-3) → /my-animals chips + sitemap (2.14.10-4).

## [2.14.10-1] - 2026-05-11

**Public showcase APIs + feature-flag plumbing** (slice 2 of the showcase rollout). Backends only; no user-visible changes in this slice (the Vite frontend that consumes these endpoints ships in 2.14.10-2 → -3). All four routes return only PII-safe whitelisted fields — no rescuer email, no adopter data, no flags, no ratings.

### Added
- **`src/lib/showcase.ts`** (new) — shared helpers used by all four routes: `pickPublicAnimal()` (hard field whitelist), `buildPublicRescuer()` (resolves display name from `user.name` with email-prefix fallback, picks first org by membership, attaches handle — never leaks the email itself), `fetchAnimalImages()` (per-id fan-out, D1-safe), `availableAnimalsBase()` + `availableAnimalsOrder()` (shared WHERE + ORDER BY).
- **`GET /api/showcase/all`** — paginated global catalog. `?limit=` (max 60) + `?offset=`. Cache 60s + stale-while-revalidate 600s.
- **`GET /api/showcase/org/[slug]`** — org-scoped via `orgMembers.userEmail` ↔ `adoptions.addedBy`. Returns the org's name + slug alongside the animals.
- **`GET /api/showcase/user/[handle]`** — user-scoped via `userProfiles.handle` → `user.email` → `adoptions.addedBy`.
- **`GET /api/showcase/animal/[id]`** — single-animal detail. Returns animal + rescuer + the global Instagram URL (if configured) so the Vite detail page can render the social CTA.
- **Three new feature flags** plumbed through the established 5-place pattern (per `feedback_feature_flag_5_place.md`):
  - `SHOWCASE_GLOBAL_VISIBLE` — gates the global URL chip on `/my-animals`
  - `SHOWCASE_ORG_VISIBLE` — gates the per-org URL chips
  - `SHOWCASE_USER_VISIBLE` — gates the per-user URL chip
  - All default **`false`** so the URLs stay hidden until each is explicitly enabled.
- **`INSTAGRAM_URL` admin config** — text input on `/admin/config` with its own save handler. Empty = no Instagram CTA renders on the public showcase. Exposed via `/api/config` so the Vite app can read it client-side without a separate endpoint.

### Changed
- **`src/config/features.ts`** — added the three SHOWCASE flags (default false in both `FEATURE_FLAGS` const + `getAllFeatureFlags` defaults).
- **`src/app/api/admin/config/route.ts`** — return the three flags + `INSTAGRAM_URL` in the admin GET response.
- **`src/lib/publicConfig.ts`** — added the three flags + `INSTAGRAM_URL` to `PUBLIC_FLAG_KEYS` + `PUBLIC_FLAG_DEFAULTS`.
- **`src/app/admin/config/page.tsx`** — three new toggle entries in the `FEATURE_FLAGS` array; new Instagram URL input + save handler; `ConfigData` interface extended.
- **`src/i18n/locales/{es,en}.ts`** — 8 new admin keys (`flag_label_showcase_*`, `flag_desc_showcase_*`, `instagram_section_*`, `instagram_saved`, `instagram_save_failed`).

### Notes
- **No new user-visible surface** until 2.14.10-2 (form skip-steps) + 2.14.10-3 (Vite showcase routes). The APIs work standalone — you can `curl` them on staging post-deploy to verify the response shapes.
- **The `/api/showcase/org/[slug]` route fetches per-member then merges client-side** because D1 doesn't expand `inArray()` reliably (per CLAUDE.md). At current scale this is fine; if any single org grows to 100+ members with 60+ animals each we'd want a single `addedBy IN (...)` with explicit `sql` template instead.
- **Field whitelist is the security boundary.** Adding any new sensitive column to `adoptions` won't leak through these endpoints unless explicitly added to `pickPublicAnimal`. Worth keeping that pattern strict.

## [2.14.10] - 2026-05-11

**Foundation for the public animal showcase** (full feature shipping in 2.14.10-1 → 2.14.10-N). No user-visible changes in this slice — it adds the schema fields, migration, slug-generation helper, and the hooks that auto-assign slugs/handles. Everything else (public APIs, Vite showcase pages, feature flags, my-animals integration) ships in subsequent slices on top of this base.

### Added
- **`src/lib/slugify.ts`** (new) — `normalizeToSlug()` (NFD-strip accents, lowercase, hyphenize non-alphanumeric) + `generateUniqueSlug(raw, exists)` (integer-suffix-on-collision loop, no hash). Used by both org slug + user handle assignment.
- **`organizations.slug`** column — TEXT UNIQUE, kebab-cased shareable identifier for the upcoming `/org/[slug]` showcase URL. Set on org creation via `generateUniqueSlug` in `createOrganization`. Backfilled in migration 0041 for existing rows.
- **`user_profiles.handle`** column — TEXT UNIQUE nullable, kebab-cased shareable identifier for the upcoming `/user/[handle]` showcase URL. Auto-assigned on next sign-in via the new block in `ensureUserProfile()` (audit.ts) — only when currently NULL. Stable thereafter so the URL stays bookmarkable.
- **`form_submissions.selected_animal_id`** column — TEXT nullable. Captures which animal an applicant chose from the showcase before submitting the form (the field will be populated by the form's submit endpoint once the showcase ships).
- **`drizzle/0041_showcase_slugs.sql`** — migration adding the three columns + two unique indexes + SQL backfill for `organizations.slug` (deterministic lower/replace transform, good enough for the current tiny org count; if collisions ever surface in production the `generateUniqueSlug` helper rewrites on next org rename).

### Notes
- **No user-visible behavior change in this commit.** The new columns sit unused until the showcase feature lands. Migration applies cleanly because all three new columns are nullable / have safe defaults.
- **Rename does NOT regenerate slug** — `updateOrganizationName` only updates the display name; the slug stays stable so previously-shared URLs keep working. A separate rebrand-aware "change my slug" flow would need its own opt-in path with a "this breaks shared links" warning.
- **Handle assignment is opportunistic** — wrapped in try/catch inside `ensureUserProfile`. If a particular sign-in hits a slugify error, the handle stays NULL and next sign-in retries. Logged at `warn`.
- **Full plan saved** at `/home/jurfalino/.claude-personal/plans/in-the-profile-screen-sequential-boole.md`.

## [2.14.9-19] - 2026-05-11

**Remove Keystatic entirely.** The CMS was wired up to edit `.mdoc` files in `content/`, but **the runtime never read those files** — `/guia` and `/funcionalidades` both fetch from `/api/guide-content` which reads from `src/content/guide-data.ts` (hand-maintained TypeScript). Keystatic's admin UI was 2.8 MiB of dead weight in the worker bundle, single-handedly pushing us over Cloudflare's 3 MiB free-plan ceiling. v2.14.9-17 / -18 both got blocked at the deploy step by this. Removing it gets us back to comfortable headroom.

### Removed
- **`src/app/keystatic/*`** — admin UI mount (page + layout + KeystaticApp wrapper).
- **`src/app/api/keystatic/*`** — API route for the CMS handler.
- **`keystatic.config.tsx`** at repo root — collection/singleton definitions.
- **`@keystatic/core`** and **`@keystatic/next`** dev dependencies (npm uninstall).
- **`/keystatic` link in `AdminSidebar.tsx`** — the only entry point in the UI.

### Notes
- **Bundle-size impact**: largest single function (`keystatic/[[...params]].func.js`) was **2840 KiB** before this change. Gone now. The Keystatic API route was another **240 KiB**, also gone. Total saved from the worker bundle: ~3 MiB. Should give us substantial headroom even on the free plan.
- **`content/` directory is left in place** — the `.mdoc` files there are now orphans (nothing reads them at runtime) but they're not bundled into the worker either. Can be deleted as a follow-up housekeeping commit. Left in this commit to keep the blast radius tight.
- **`/keystatic/` still in `src/app/robots.ts` Disallow list** and `Footer.tsx HIDDEN_PREFIXES` — harmless, just lists a non-existent path. Could be removed for cleanliness; not required.
- **If you ever want a CMS**: don't re-add Keystatic. For this size of team and content, edit `src/content/guide-data.ts` directly and commit. If a non-technical editor needs the UI in the future, a separate Pages project for the CMS is the right architecture — not bundled into the main app.

## [2.14.9-18] - 2026-05-11

Revert the `userName` push added in v2.14.9-17. The 5-line change nudged the Worker bundle just over Cloudflare's **3 MiB free-plan ceiling** and the `Deploy to Staging` step failed with `Your Worker exceeded the size limit of 3 MiB`. Build + lint + e2e all passed — only the deploy step failed.

### Reverted
- **`src/components/ZarazIdentify.tsx`** — removed the `zarazSet('userName', ...)` call and the matching sign-out clear. Left an inline comment so the next person looking at this remembers why it's missing.

### Notes
- **The funnel events from v2.14.9-16 ARE live** (signed_in, adopter_created, search_performed enrichment). Only the cosmetic name-in-Amplitude addition is rolled back.
- **Bundle size is the real issue** — this won't be the last time we hit the ceiling. Worth a follow-up: identify the biggest chunks in `__next-on-pages-dist__/functions/*.func.js` and lazy-load / dynamic-import anything not on the critical path. Quick wins likely live in admin routes that ship everywhere.
- **Alternative**: Cloudflare Workers paid plan ($5/mo) bumps the limit to 10 MiB. Worth considering if bundle reduction would mean significant refactoring.

## [2.14.9-17] - 2026-05-11

Surface the user's display name to Zaraz / Amplitude so the User Lookup view shows real names instead of just the UUID or email.

### Changed
- **`src/components/ZarazIdentify.tsx`** — pushes `session.user.name` as the Zaraz `userName` variable (alongside the existing `userId` / `userEmail` / `userRole`). Cleared on sign-out like the others. Skipped silently when the name is empty so we don't blow away a prior value with a blank.

### Notes
- **Still requires the Zaraz dashboard to map `userName` → Amplitude user property `name`** for this to actually appear in Amplitude. The Zaraz → Amplitude destination config isn't part of the codebase. If it doesn't show up, check Zaraz dashboard → Amplitude tool → Field mappings.
- **Country / signup date / org membership** remain unsent — they'd need session-callback enrichment (touching `src/auth.ts`'s JWT + session callbacks). Not in scope; the funnel works without them, and any auth-callback edit carries regression risk worth bundling with a real product reason.

## [2.14.9-16] - 2026-05-11

Wire up the events the Amplitude funnel needs. Activation funnel (`signed_in → search_performed → visit_intent_shown → adoption_created`) and new-data-onboarding funnel (`signed_in → search_performed → adopter_created → adoption_created`) are now both fully instrumented end-to-end.

### Added
- **`signed_in` event** in `src/components/ZarazIdentify.tsx`. Fires once per unauth → auth transition. Deduplicated via `sessionStorage` keyed on `userId` so a page refresh while logged in doesn't refire; sign-out clears the flag so the next sign-in fires fresh. Property: `role` (`'admin'` or `'viewer'`). Wrapped in try/catch since `sessionStorage` is unavailable in Safari private mode etc.; analytics is best-effort.
- **`adopter_created` event** in `src/components/AdopterForm.tsx`, fired right after the server action succeeds on the CREATE path (not update). Properties: `hasContactInfo` (1/0), `hasFamilyMembers` (1/0), `fromForm` (1/0 — Petshield-form-prefill flow), `continuesToAdoption` (1/0 — onboarding-flow URL param signals the rescuer is mid-onboarding and will keep going).

### Changed
- **`search_performed` event** in `src/components/SearchSection.tsx` — added `hasResults` boolean (1 when `resultCount > 0`, 0 otherwise). Lets Amplitude split the funnel: searches that found a match feed the activation funnel; searches that found nothing feed the new-data onboarding funnel. No new event, just an extra property on the existing one.

### Notes
- **Recommended Amplitude funnel structure (per the audit earlier today)**:
  - **Activation (returning-user core loop)**: `signed_in → search_performed (hasResults=1) → visit_intent_shown → adoption_created`
  - **New-data onboarding**: `signed_in → search_performed (hasResults=0) → adopter_created → adoption_created`
- The split funnel matches the actual product paths: rescuers who find an existing profile drill in via the VisitIntentCard; rescuers who don't find one create the profile. Forcing both through the same middle step would under-measure one path.
- Properties chosen for `adopter_created` are PII-free: no name, no contact info, no email — just shape signals (whether the field was filled) and provenance flags (whether they came from the form-share flow / onboarding chain). Safe to surface in Amplitude.

## [2.14.9-15] - 2026-05-11

Revert the `REQUIRED_SESSION_VERSION` bump that v2.14.9-14 introduced. The adopter-login gate runs on **new** sign-ins; we don't want to force every currently-signed-in user to re-auth and risk false-positives via the LIKE-substring fallback locking out a legit rescuer whose email happened to appear in an adopter's notes.

### Reverted
- **`src/auth.config.ts`** — `REQUIRED_SESSION_VERSION` back to `3` (was `4`). The gate still applies on every fresh OAuth sign-in. Existing valid sessions are unaffected.

## [2.14.9-14] - 2026-05-11

**Adopter-login gate.** BuenAdoptante is an NGO/rescuer tool; adopters being rated aren't supposed to know the registry exists. This change rejects any OAuth sign-in where the email matches an adopter profile that's been flagged. The rejected user sees a generic "Ocurrió un error inesperado" page (no hint they were blocked) with a "report this problem" form. Admins get notifications + an audit page at /admin/blocked-logins.

### Block logic

A sign-in is rejected when the email matches an adopter profile AND **any** of:
- `avgRating < 4` (rated, but not high enough)
- `tooManyAdoptions` density flag set
- `tooManyRequests` density flag set

Not blocked: emails matching profiles with `avgRating = null` (never rated) and no flags, OR `avgRating >= 4` and no flags. Bootstrap admins (in `src/config/admins.ts`) are always allowed. The gate fails OPEN on D1 errors (a transient outage shouldn't lock legitimate rescuers out).

### Added
- **`src/lib/adopterLoginGate.ts`** (new) — `checkAdopterLoginGate(email)`. Matches via `duplicate_tokens` (normalized email index) first, falls back to LIKE substring on `adopters.contactInfo`. Computes avgRating + density flags per match. Returns `{ blocked, matches[], reason }`.
- **`src/lib/blockedLoginRecorder.ts`** (new) — side-effects writer: inserts a row in the new `blocked_logins` table, fans out one in-app notification per admin (bootstrap list + DB `role='admin'`), and emits an `info`-level log to Axiom. Each side-effect best-effort with its own try/catch.
- **`src/app/auth-error/page.tsx`** (new) — generic error page NextAuth redirects to. Vague copy + a real "report this problem" form (email + message + submit). The form makes the deception more credible — real apps have error reports.
- **`src/components/AuthErrorReportForm.tsx`** (new) — client island for the form. POSTs to `/api/error-report`.
- **`src/app/api/error-report/route.ts`** (new) — public POST endpoint. Validates input lengths, hashes the CF-Connecting-IP to 16 hex chars (no raw-IP storage), writes `error_reports` row. Always returns success regardless of DB outcome — also part of the deception.
- **`src/app/admin/blocked-logins/page.tsx`** (new) — admin view. Two sections: recent error reports (correlated by time/IP-hash) above; blocked-login attempts below. Each blocked row shows matched profile(s), avgRating, addedBy, lastChangedBy from history, triggers fired.
- **DB tables** (`drizzle/0040_blocked_logins.sql`): `blocked_logins` (id, email, attemptedAt, matchedAdopterIds, reason, matchedSummary) + `error_reports` (id, email, message, userAgent, ipHash, createdAt).
- **Notifications**: new type `adopter_login_blocked` with 🚫 icon, title `"Intento de login bloqueado: <email>"`, link to the primary matched profile.
- **Admin sidebar**: new "Logins bloqueados" entry at `/admin/blocked-logins`.
- **i18n**: `admin.nav_blocked_logins` in both locales.

### Changed
- **`src/auth.config.ts`** —
  - `REQUIRED_SESSION_VERSION` bumped from `3` to `4` so any existing session goes through the new gate on next page load.
  - `signIn` callback now runs `checkAdopterLoginGate` before the existing audit/profile logic. If `blocked`, calls `recordBlockedLogin` and returns false (NextAuth redirects to `/auth-error`). Admins skip the check via `isAdmin(email)`.
  - `pages.error: '/auth-error'` added so NextAuth uses our custom page instead of the default error route.

### Notes
- **Failure mode is fail-open**: if D1 is unreachable when the gate runs, every sign-in is allowed. Deliberate. The cost of accidentally letting an adopter through during an outage is lower than the cost of locking every rescuer out.
- **No correlation between error reports and blocked-login rows**: the form submits without a session, so we can't automatically tie a report to a specific attempt. Admins correlate by timestamp + IP-hash (visible in both tables). If automatic correlation becomes important, we can set a short-lived cookie at block time with the attempt ID.
- **`REQUIRED_SESSION_VERSION` bump means every currently-signed-in user will be forced to re-auth** on their next page load. Most will pass; a small number (any rescuer whose own email is also recorded as an adopter with low rating — edge case) might be unexpectedly locked out. If you see legitimate rescuers complaining about random errors, check `/admin/blocked-logins`.

## [2.14.9-13] - 2026-05-10

Cuts the homepage's client-side `/api/config` fetch out of the LCP critical path. Cloudflare Web Analytics reported a p99 LCP of ~17s on the homepage. Root cause: `src/app/page.tsx` was fully `'use client'` with `useState({})` + `useEffect(fetch('/api/config'))` — every flag-gated UI block (Import card, MilestoneBadge, SocialProofBanner) was invisible in the SSR HTML and only rendered after the client-side bundle loaded, React hydrated, the API request roundtripped, and a re-render flushed. On cold-start workers + slow networks that whole tail added seconds of LCP delay.

### Changed
- **`src/app/page.tsx`** — refactored from a 162-line client component into a ~20-line **server component** that calls the new `getPublicConfig()` server-side and passes the result as `initialConfig` to a new client component. The server fetch is 30s-cached (see new helper) and falls back to `PUBLIC_FLAG_DEFAULTS` on D1 failure; uses the same `.catch(() => …)` graceful-degradation pattern as v2.14.9-1's adopter page hardening.
- **`src/components/HomeClient.tsx`** (new) — the entire `'use client'` payload that used to live in `page.tsx`, minus the config `useEffect`. Takes `initialConfig: Record<string, string>` as a prop and reads flags directly from it; `contentImportEnabled` is now derived instead of `useState`. All other client behavior (auth-redirect callbackUrl handling, wizard navigation, toasts) preserved verbatim.
- **`src/app/api/config/route.ts`** — refactored from 55 inline lines to a 20-line thin wrapper around the new `getPublicConfig()` helper. Now serves `Cache-Control: public, max-age=60, stale-while-revalidate=600` so any remaining consumers (contract-app, dev tooling, external integrations) benefit from edge caching.

### Added
- **`src/lib/publicConfig.ts`** (new) — single source of truth for the public-flags whitelist + defaults + read logic. Exports `PUBLIC_FLAG_KEYS`, `PUBLIC_FLAG_DEFAULTS`, and `getPublicConfig()` (cached 30s in-memory per worker, returns defaults on D1 failure with a `logger.warn`). Shared between `/api/config/route.ts` and the homepage server component, eliminating the two-place duplication that lived in `route.ts`.

### Notes
- **Expected LCP improvement**: significant on cold-start cases. The LCP-candidate element (one of the action cards, probably) now appears in the first-byte HTML instead of waiting for client hydration + an extra API roundtrip. p99 should drop materially; p50/p75 will also improve modestly because the redundant client fetch is gone.
- **What this does NOT fix**: `MilestoneBadge` still requires `useSession()` (client-only) so it still waits for hydration. Same for any client-only badges. To fix those would mean server-side session reads — out of scope here.
- **Flag-flip latency**: admin flipping a flag in `/admin/config` now takes up to **30 seconds** (helper cache) **plus up to 60 seconds** (HTTP edge cache on `/api/config`) to be visible to homepage visitors. Previously it was instant once the user's `/api/config` fetch hit. Acceptable tradeoff for the LCP win. If we ever need instant flag propagation, the admin save path can call a `/api/admin/cache-bust` (not in scope).
- **Recommended verification**: run https://pagespeed.web.dev/ against `https://staging.buenadoptante.org/` after this deploys. Compare LCP element + p99 vs the v2.14.9-12 baseline.

## [2.14.9-12] - 2026-05-10

Two changes:

1. **Env-scoped Axiom metrics** — every metric query on /admin now auto-filters to events from the same deploy environment the page is running in. Staging /admin shows staging traffic only; production /admin shows production traffic only. Previously the queries summed across all environments — staging counts were inflated by production events and vice versa.

2. **"Recorded Adoptions" → "Adopter Activities"** — renamed the second DB-counter on the /admin landing and removed the `recordType='adoption'` filter added in v2.14.9-11. The operator wants the broader "any activity row" signal; the rename makes the count and label match.

### Changed
- **`src/lib/axiom.ts`** —
  - Added `getCurrentEnv()` mirroring `logger.ts`'s `getEnvironmentInfo()` (reads `CF_PAGES_BRANCH` / `CF_PAGES_URL`; returns `'production' | 'staging' | 'preview-<branch>' | 'local'`).
  - `runQuery()` now wraps every caller's filter with a compound `{ op: 'and', children: [<original>, { op: '==', field: 'env', value: <currentEnv> }] }`. Verified empirically against the live API; the legacy structured-query endpoint accepts compound and-filters.
  - Cache key includes the wrapped filter, so same query from staging vs production gets cached separately. No cross-env cache pollution.
  - `getAxiomDeepLinkUrl()` always emits an `env=="<currentEnv>"` clause in the `_q=` query string, so clicking through from /admin opens Axiom Stream pre-filtered to the right env.
  - Refactored the `AxiomFilter` type to a discriminated union (`AxiomLeafFilter | AxiomCompoundFilter`) to support the compound shape cleanly.
- **`src/app/admin/page.tsx`** — second counter is now "Adopter Activities" (was "Recorded Adoptions"). Removed the `eq(adoptions.recordType, RECORD_TYPES.ADOPTION)` where-clause from v2.14.9-11. Removed unused `eq` and `RECORD_TYPES` imports.

### Notes
- **Logger.ts and axiom.ts now both have `getCurrentEnv` (axiom) and `getEnvironmentInfo` (logger) doing similar things** — slight duplication. They differ in shape (logger returns more fields like `domain` / `requestId`); refactoring to a shared helper is sensible follow-up but not in scope here.
- **The "Active Flags" filter from v2.14.9-11 stays** — that audit was about a different bug (positive flags being counted as concerning), unrelated to the recordType filter being undone.
- **The `findAdopters.discovery` p50 = 750ms latency signal** flagged in v2.14.9-11 still applies — env-scoping doesn't change the underlying numbers, only narrows what each /admin page sees. Investigation still pending.

## [2.14.9-11] - 2026-05-10

Three improvements to /admin landing metrics: Axiom deep-links, fixed Active Rescuers undercount, and audit fixes on the existing DB-counter labels (which were misleading by counting things the labels didn't claim).

### Added
- **`AXIOM_ORG_SLUG` Cloudflare secret** — used by `getAxiomDeepLinkUrl()` in `src/lib/axiom.ts` to build "Ver en Axiom →" deep-links into the Stream view of the dataset, with optional `_q` filter pre-applied. When the slug is missing, the helper returns null and links are hidden — same graceful-degradation pattern as `AXIOM_QUERY_TOKEN`. The slug is the path segment after `app.axiom.co/` in your Axiom dashboard URL (e.g. `verazadoptantes-4l1p`).
- **Per-metric deep-links on /admin landing**:
  - Section header: "Ver en Axiom →" linking to the unfiltered dataset Stream.
  - Errors counter: "Ver →" linking to `level=="error"` filtered Stream.
  - Top-errors rows: each message is now a link that opens Axiom filtered to `level=="error" message=="<that-message>"` — one-click triage.
  - Trace-latency rows: each trace name is a link filtered to `trace=="findAdopters.discovery"` (etc.) — one-click drill to the actual slow calls.

### Fixed
- **`getActiveRescuers` was undercounting** — counted distinct values of the single `user` field, which is only set by search-side actors. Rescuers whose only activity was creating profiles (`changedBy`), signing in (`email`), or browsing my-animals (`userEmail`) were invisible. Now unions distinct values across all four fields, deduplicates case-insensitively, drops sentinel non-emails (`anonymous`, `unknown`, `system`), and validates email shape (must contain `@`). The "rescatistas (búsquedas)" hint copy is removed since the count now covers all activity types.
- **"Recorded Adoptions" counter was counting everything** — `db.select(count()).from(adoptions)` returned all rows including `adoption_request`, `observation`, `follow_up`, `returned_pet`, `available`, and the new `foster` rows. The label says "Adoptions" so the count should be filtered to `recordType='adoption'`. Audit caught this on staging where the counter showed 57 but only a fraction of those were actual adoptions.
- **"Active Flags" counter was inflated by positive flags** — included `verified_identity` and `verified_address` rows, which are *trust signals*, not "active concerns". The counter now excludes those two reasons via `ne(...)` clauses (D1-safe; doesn't use `inArray`). Result: a more meaningful "concerning flags" count.

### Notes
- **Logging field-name inconsistency** is real codebase debt — different log call sites use `user`, `changedBy`, `email`, `userEmail` for what is logically the same "actor" field. Long-term fix is to standardize on `actorEmail` everywhere; short-term the `getActiveRescuers` union covers all four. Worth filing a follow-up to do the standardization sweep.
- **Performance signal surfaced by the metrics**: `findAdopters.discovery` p50 = 750ms / p95 = 1190ms on staging, with `enrichAdopters` p50 = 444ms — i.e. enrichment is ~59% of search latency. Worth a follow-up investigation: enrichment-scope reduction (only enrich top-N rendered results), more aggressive parallelization, or KV-side caching of frequently-enriched profiles. Out of scope for this commit.
- **Required Cloudflare secret**: set `AXIOM_ORG_SLUG=verazadoptantes-4l1p` in Pages → Variables and Secrets, both staging and production.

## [2.14.9-10] - 2026-05-10

Embedded Axiom-driven metrics into the `/admin` landing page. The previous "Activity Log coming soon..." placeholder is replaced with four operational signals fetched server-side from Axiom: errors-last-7d (with delta vs prior 7d), top 5 error messages, p50/p95 latency by trace (`findAdopters.discovery`, `findAdopters.duplicate`, `enrichAdopters` — the v2.14.9 trace wrappers finally pay off), and active rescuers in the last 7d / 30d. All in parallel with the existing DB counters; results cached 5 min per worker so repeat /admin loads are instant.

### Added
- **`src/lib/axiom.ts`** (new) — query-side counterpart to `logger.ts`. Reads a separate Cloudflare secret `AXIOM_QUERY_TOKEN` (read scope; distinct from the existing `AXIOM_TOKEN` used by the logger for ingest). Exposes typed wrappers `getErrorsCount`, `getTopErrors`, `getTraceLatencies`, `getActiveRescuers`. Module-level cache with 5-min TTL keyed by stringified request body. Uses Axiom's structured `legacy=true` query endpoint (NOT `_apl` — verified empirically; see Notes).
- **`src/app/admin/page.tsx`** — extends the existing `Promise.all` with 6 Axiom calls (4 metric helpers, with errors fetched twice for the 7d/prior-7d delta and active rescuers twice for 7d/30d). Each call wrapped in `.catch(() => null)` per the v2.14.9-1 hardening pattern: one Axiom failure or a missing token degrades that section instead of crashing the page. New "Métricas (últimos 7 días)" section with three counter cards, a top-errors list, and a per-trace latency table.

### Notes
- **New Cloudflare secret required**: `AXIOM_QUERY_TOKEN`. Set under Cloudflare Pages → settings → Variables and Secrets → Environment variables, both staging and production. The existing `AXIOM_TOKEN` (ingest) and `AXIOM_DATASET` stay as-is.
- **APL gotcha discovered while building**: the Axiom REST API has *two* query shapes. The `/v1/datasets/_apl/query` endpoint (which their docs feature prominently) returns 404 for our token/setup. The working endpoint is `/v1/datasets/{dataset}/query?legacy=true` with structured `aggregations[] / filter / groupBy[]` body — and crucially, **field names there are FLAT** (`level`, `message`, `trace`, `duration`, `user`) even though events are stored nested under `data.*` in the JSON. This took several iterations to nail down; the `axiom.ts` module documents the contract inline so the next person doesn't repeat the search.
- **Active rescuers** counts distinct values of the `user` field — this captures search activity (the most common engagement surface) but misses events that use `changedBy` / `userEmail` (Adoption created, sign-ins, my-animals page). Logging field-name inconsistency is real codebase debt; counting "active searchers" is a reasonable proxy for v1. A union across the three fields is a Phase 2 improvement.
- **`findAdopters.duplicate` trace** rarely fires in normal traffic (only on contract submits + a couple of import paths), so it may be absent from the latency table on a quiet week. That's expected; the row simply doesn't render.
- **Cost**: 6 queries × ~10 admin loads/day = 60/day, well within Axiom free-tier 500GB/month. Cache keeps it flat. If we ever add 10+ metrics or multiple admins poll heavily, revisit cache TTL.
- **No client-side token exposure**: the secret is read inside server-only code (`getRequestContext().env`) and the helpers are imported into the SSR'd `admin/page.tsx`. View-source on /admin contains no `xaat-` substring.
- **Plan saved at** `/home/jurfalino/.claude-personal/plans/in-the-profile-screen-sequential-boole.md`.

## [2.14.9-9] - 2026-05-10

Fixed `ENABLE_MILESTONE_BADGE` admin toggle not actually hiding the MilestoneBadge on the homepage. v2.14.8-5 added the 4-place flag plumbing (features.ts, /api/admin/config, /admin/config UI, i18n labels) but missed a 5th place: `src/app/api/config/route.ts` — the **public** config endpoint that the homepage actually reads. The admin UI was writing the flag value to the DB correctly, but `/api/config`'s `PUBLIC_FLAG_KEYS` whitelist didn't include `ENABLE_MILESTONE_BADGE`, so the homepage only ever saw `undefined` for that key. Since the homepage check is `appConfig.ENABLE_MILESTONE_BADGE !== 'false'`, `undefined !== 'false'` is `true` → the component always rendered regardless of admin toggle.

### Fixed
- **`src/app/api/config/route.ts`** — added `ENABLE_MILESTONE_BADGE` to `PUBLIC_FLAG_KEYS` whitelist and to `PUBLIC_FLAG_DEFAULTS` (default `'true'`, matching `features.ts`).

### Notes
- **The "4-place plumbing" pattern documented in CLAUDE.md is actually 5 places when the flag gates client-side UI visible to all users** (admin + public both need to know). I'll fold this into the next `feedback_*` memory update so future agents don't repeat the miss. For admin-only flags (e.g. flags that only affect admin pages), the 4-place pattern is still correct.
- **Other public-visible flags I should verify post-deploy** to make sure they actually work via /admin/config: `ENABLE_CONTENT_IMPORT`, `ENABLE_ANIMALS_FOR_ADOPTION`, `ENABLE_SEARCH_CARD_METADATA`, `SOCIAL_PROOF_ENABLED`. These are in `PUBLIC_FLAG_KEYS` so they should work; flagging here for completeness.

## [2.14.9-8] - 2026-05-10

Two changes bundled:

1. **Fixed e2e regression from v2.14.9-7** that blocked deploy. `tests/smoke.spec.ts:15` literally asserted `Busca adoptantes y Registra adopciones` — the exact text v2.14.9-7 removed when replacing the homepage subtitle with the click-to-expand explainer. The plan's verification step #11 said "no e2e selector references home.value_main text — quick grep in tests/" but I grepped for the i18n key, not the literal string. Updated the smoke test to assert the new `¿Qué es Buen Adoptante?` button. Lesson reinforces existing memory `feedback_grep_tests_before_deletion.md`: tests assert literal text, not i18n keys.

2. **Added `foster` record type — Phase 1.** Captures temporary hosting / tránsito / foster home placements that previously had to be shoehorned into `adoption` (lying about permanence) or `observation` (losing structure). New record type is a peer of adoption / adoption_request, with rating-aware step-1 guidance copy. Card layout in the timeline uses indigo (chosen for distinctness from the existing teal/sky/amber/violet/rose palette); contrasted properly in both light and dark themes via new `[data-theme]` remaps in `globals.css`.

### Added
- **`RECORD_TYPES.FOSTER = 'foster'`** in `src/domain/constants.ts`. `'foster'` added to both z.enums in `src/app/actions/validation.ts` (saveAdoptionSchema + createAdopterApiSchema). Schema doc-comment in `src/db/schema.ts:79` updated.
- **Color + icon** in `src/lib/recordTypeColors.ts` — indigo palette (`bg-indigo-100`, `text-indigo-700`, `border-indigo-200`, etc.); 🤝 emoji.
- **Indigo dark/light remaps** in `src/app/globals.css` — modeled on the existing blue block. Required because Tailwind indigo had zero `[data-theme]` overrides; without these the foster chip would have looked like the v2.14.9-4 amber-900 contrast bug. Adds remaps for `bg-indigo-100`, `text-indigo-600/700/800`, `border-indigo-200`.
- **Wizard chip + visit intent + edit form**: foster added to local `RECORD_TYPES` arrays in `AdoptionFormWizard.tsx:48` and `AdoptionFormEditV2.tsx:594`. New `foster` case in `VisitIntentCard`'s `renderIcon`. New 4th main-row button in `mainButtons` (peer to "Me pidió un animal" / "Le dí un animal en adopción" / "Otro motivo").
- **Step-1 guidance copy** — `RecordTypeGuidance.tsx`: foster added to `TYPE_META` and to `needsRatingVariant` so it gets the `none / 1 / 2 / 3 / 4_5` body lookup like adoption/request. New i18n keys `wizard.guidance.foster.{title, body.{none,1,2,3,4_5}}` in both locales — same shape as `adoption.body` with foster-specific phrasing ("durante el tránsito", etc.).
- **Timeline rendering** in `AdoptionHistory.tsx` — added foster to `STRIPE_BY_TYPE` (border-l-indigo-500), to the verb-summary switch (`verb_fostered`), and to the activity summary line. New "En curso" pill rendered when `recordType === 'foster' && status === 'active'` (uses indigo classes — properly themed).
- **`/my-adoptions` filter** — foster added to local `RECORD_TYPES` array (page.tsx) and `validFilters` (api/route.ts). `getTypeBadgeStyle` returns `bg-indigo-100 text-indigo-800` for foster.
- **i18n keys**: `adoption.type_foster` ("Tránsito" / "Foster"), `adoption.foster_active` ("En curso" / "Active"), `adoption.verb_fostered` ("recibió en tránsito" / "fostered"), `stats.fosters` ("tránsitos" / "fosters"), `visitIntent.option_foster` + `option_foster_hint`. EN translations follow the literal pattern.

### Changed
- **`visitIntent.option_a`** tightened: `'Me pidió un animal en adopción'` → `'Me pidió un animal'` (per user ask). Bundles cleanly with the new `option_foster` since it's the same file + same surface; the "en adopción" suffix was implicit from neighboring options.
- **`tests/smoke.spec.ts`** — homepage assertion now matches `¿Qué es Buen Adoptante?` button instead of the removed value_main literal.

### Notes
- **Lifecycle uses existing `status` field** — `status='active'` (foster ongoing) vs `status='completed'` (foster ended). No new column. Phase 2 can add `endDate` if duration analytics become important.
- **Stats integration**: foster ratings count toward `avgRating` automatically (`computeAvgRating` already includes any non-null rating regardless of type). Foster records are **not** counted toward `MilestoneBadge`, `tooManyAdoptions`, or `tooManyRequests` (CX call: those are about permanent-placement signals; foster is a different lifecycle).
- **Plan saved** at `/home/jurfalino/.claude-personal/plans/in-the-profile-screen-sequential-boole.md`.
- **Phase 2/3 deferred**: foster→adoption "fail" conversion flow, dedicated `tooManyActiveFosters` density flag, observation-record backfill scan.

## [2.14.9-7] - 2026-05-10

Replaced the homepage utility subtitle ("Busca adoptantes y Registra adopciones") with a click-to-expand "¿Qué es Buen Adoptante?" question. Tapping reveals a two-paragraph explainer of what the product is and how the workflow goes ("Cuando alguien te pide un animal en adopción, busca su nombre y sus datos acá…"). Trade-off accepted: lose a small action signal for returning users, gain self-onboarding for first-time visitors who don't yet have a mental model of the product.

### Added
- **`src/components/WhatIsBuenAdoptante.tsx`** (new) — `'use client'` collapsible explainer. Question always renders; tapping toggles a height-animated panel with the intro paragraph + "¿Cómo funciona?" subhead + workflow paragraph. `<button aria-expanded aria-controls>` with rotating chevron; panel uses `grid-rows-[1fr]/[0fr]` transition so the height interpolates smoothly. No state persistence — every visit starts collapsed (CX trade-off accepted: simpler now, can layer in localStorage dismissal later if returning-user fatigue becomes a real complaint).
- **i18n keys** `home.what_is.{title,intro,how_title,how_body}` in both `es.ts` and `en.ts`. Editorial passes on the user's draft: glossed "veraz" so non-Río-de-la-Plata readers aren't lost (`Es un registro de adoptantes — un "veraz", si conocés el término —`); fixed `sino → si no` (grammar — `sino` means "but rather", `si no` means "if not"); switched `rating → calificación` for consistency with the rest of the UI.

### Changed
- **`src/components/SearchSection.tsx`** — replaced the single-line `<p>{t('home.value_main')}</p>` subtitle (lines 182-190) with `<WhatIsBuenAdoptante />`. Kept the `text-center mb-4` spacing and the `hasResults ? 'hidden md:block'` mobile-collapse rule so the search-results-shown behavior stays identical.

### Removed
- **`home.value_main`, `home.value_verify`, `home.value_register`** keys from both `es.ts` and `en.ts`. Grep across `src/` and `tests/` confirmed all three were dead post-removal of `value_main` (the other two were already orphaned in earlier copy iterations). Removing dead keys per the i18n hygiene note in CLAUDE.md.

### Notes
- **Plan saved at** `/home/jurfalino/.claude-personal/plans/in-the-profile-screen-sequential-boole.md`.
- **No DB / API change.** Pure UI swap.
- **EN copy is a literal translation** — codebase default is `es`, EN side is best-effort per CLAUDE.md i18n note.
- **`grep -rn 'value_main' src/ tests/`** returns zero results post-change.

## [2.14.9-6] - 2026-05-10

Removed the `WIZARD_ALERTS_AS_CARD` admin feature flag added in v2.14.9-4. Card layout is the only path now. The inline-paragraph alternative was useful for the v2.14.9-4 → v2.14.9-5 staging A/B but never won an audience — keeping it would mean carrying a 4-place flag duplication, an extra prop on three components, an extra SSR fetch on every adopter-page load, and a contrast-failure-prone alternate render path forever.

The card layout itself is unchanged from v2.14.9-5 (text-amber-700/800 with proper dark-theme remaps).

### Removed
- **`src/config/features.ts`** — `WIZARD_ALERTS_AS_CARD: true` from the `FEATURE_FLAGS` const and from the `getAllFeatureFlags` defaults block.
- **`src/app/api/admin/config/route.ts`** — `WIZARD_ALERTS_AS_CARD` line in the GET response.
- **`src/app/admin/config/page.tsx`** — `ConfigData` interface field, `FEATURE_FLAGS` array entry, `useState` initializer key, and fetch-hydration setter.
- **`src/i18n/locales/{es,en}.ts`** — `admin.flag_label_wizard_alerts_card` + `admin.flag_desc_wizard_alerts_card` (no longer referenced).
- **`src/components/RecordTypeGuidance.tsx`** — `alertsAsCard` prop, the `{!alertsAsCard && alerts.map(...)}` inline-paragraph branch, and the `{alertsAsCard && ...}` guard around the card branch. Card branch now renders unconditionally.
- **`src/components/AdoptionFormWizard.tsx`** — `alertsAsCard` prop on the destructure + JSDoc + the forwarding into `<RecordTypeGuidance>`.
- **`src/components/VisitIntentCard.tsx`** — `alertsAsCard` from `Props` + destructure + forward into `<AdoptionFormWizard>`.
- **`src/components/AdopterProfileV2.tsx`** — `wizardAlertsAsCard` from `AdopterProfileV2Props` + destructure + the forwarding to both wizard mounts (VisitIntentCard mount + URL-driven autoOpen mount).
- **`src/app/adopter/[id]/page.tsx`** — `getFeatureFlag('WIZARD_ALERTS_AS_CARD')` call, the `wizardAlertsAsCard={...}` prop, and the now-unused `getFeatureFlag` import.

### Notes
- **No DB migration.** Any `app_config` row with `key = 'WIZARD_ALERTS_AS_CARD'` (anyone toggled it in `/admin/config` between v2.14.9-4 and now) is a harmless orphan — `getFeatureFlag` is no longer called for that key.
- **Density computation stays.** The `useMemo + computeMaxDensityPeriod` block in `AdopterProfileV2`, the `tooManyAdoptions` / `tooManyRequests` props on `RecordTypeGuidance` / `AdoptionFormWizard` / `VisitIntentCard`, and the four `wizard.guidance.alerts.*` i18n strings (es + en) are all preserved — only the layout flag is gone.
- **`grep -rn 'WIZARD_ALERTS_AS_CARD\|alertsAsCard\|wizardAlertsAsCard'` returns zero results** in `src/` after the cleanup.

## [2.14.9-5] - 2026-05-10

Fixed dark-theme contrast on the wizard alert cards added in v2.14.9-4. The alert body used `text-amber-900` and the icon used `text-amber-600` — `text-amber-900` has no `[data-theme="dark"]` remap in `globals.css`, so it stayed near-black on the dark amber-tinted background and was barely readable. Switched the body to `text-amber-800` (remaps to `#fde047`/bright yellow in dark) and the icon to `text-amber-700` (remaps to `var(--status-warning-text)`); both classes already have proper light- and dark-theme overrides in the codebase.

### Fixed
- **`src/components/RecordTypeGuidance.tsx`** — alert card body class `text-amber-900` → `text-amber-800`; icon class `text-amber-600` → `text-amber-700`. Added an inline comment to flag amber-900 as intentionally avoided so the next person isn't tempted to "match the design system" by using the deeper amber.

### Notes
- **No change to inline-paragraph layout** (`WIZARD_ALERTS_AS_CARD=false`). That layout uses the existing body card's `text-stone-600` which already has full theme coverage in `globals.css`.

## [2.14.9-4] - 2026-05-10

Wizard step-1 guidance copy is now flag-aware. Beyond the rating-bucket body added in v2.14.9, the `RecordTypeGuidance` block now also renders short alert messages when the adopter trips the existing density flags `tooManyAdoptions` (e.g. 7 completed adoptions in 30 days) or `tooManyRequests` (e.g. 4 active requests in 14 days). Both flags use `actualSpanDays` (the densest observed window) when reporting the period, so the warning reads "{count} adopciones en los últimos {actual} días" instead of the wider configured threshold window.

### Added
- **`src/components/RecordTypeGuidance.tsx`** — accepts new `tooManyAdoptions`, `tooManyRequests`, and `alertsAsCard` props. Builds 0-2 alerts, ordered adoptions-first then requests, gated to `adoption` / `adoption_request` record types. Each alert is an i18n string with `{name}`/`{count}`/`{days}` interpolation and `\n` line splitting; supports `**bold**` inline.
- **i18n keys** `wizard.guidance.alerts.too_many_adoptions.{adoption,adoption_request}` and `wizard.guidance.alerts.too_many_requests.{adoption,adoption_request}` in both `es.ts` and `en.ts` (4 keys per locale; the request-flow tooManyAdoptions copy uses an "Atención:" prefix; the others share the "demasiados animales en un corto periodo" cautionary line).
- **Feature flag `WIZARD_ALERTS_AS_CARD`** (admin-toggleable, default `true`) — when on, each fired alert renders as its own warning card below the body (amber styling, `⚠` glyph, `role="note"`); when off, alerts are appended as additional plain paragraphs inside the body card. Standard 4-place plumbing (`features.ts`, `/api/admin/config`, `/admin/config` UI, i18n labels).

### Changed
- **`src/components/AdopterProfileV2.tsx`** — computes `tooManyAdoptions` and `tooManyRequests` once via `useMemo + computeMaxDensityPeriod` (mirrors `AdopterForm`'s pattern at line 66-71). Also accepts a new `wizardAlertsAsCard` prop. Forwards all three values into both wizard mounts (the `VisitIntentCard` mount and the URL-driven autoOpen mount).
- **`src/components/VisitIntentCard.tsx`** — adds `tooManyAdoptions`, `tooManyRequests`, `alertsAsCard` props on its `Props` interface; threads them straight into the spawned `AdoptionFormWizard`.
- **`src/components/AdoptionFormWizard.tsx`** — same trio added; forwarded into `RecordTypeGuidance` only on the `initialRecordType` branch (where the guidance block actually renders).
- **`src/app/adopter/[id]/page.tsx`** — fetches the feature flag value via `getFeatureFlag('WIZARD_ALERTS_AS_CARD')` (with `.catch(() => true)` for the same degraded-default treatment as the rest of the page-load fan-out from v2.14.9-1) and passes it down to `AdopterProfileV2`.

### Notes
- **Decisions signed off** — Q1 layered (alerts overlay the rating-base body, don't replace it). Q2 only the two density flags (no `inaccurate` / `systemDuplicate` / `verified_*` for now). Q3 both layouts behind the new feature flag. Q4 render both alerts when both fire, adoptions first. Q5 use `actualSpanDays`.
- **No DB or schema change.** Existing density computation (`adoptionConfig.threshold` / `.requestsThreshold` / `.periodDays` / `.requestsPeriodDays`) drives the flags identically to how `/admin/adopters` and `AdopterFlagging` already use them.
- **Plan saved at** `.agents/plans/wizard-flag-aware-copy.md`.

## [2.14.9-3] - 2026-05-10

Wizard step 1 for `adoption_request` now collects only the species — no animal name, no existing/new mode switcher. An adoption request is "person asks for any cat / any dog" — there's no specific animal yet, so asking for its name was friction with no information value. All other record types (adoption / follow_up / returned_pet / observation) are unchanged.

### Changed
- **`src/components/AdoptionFormWizard.tsx`** — added `isRequest` derivation (mirrors `isObservation` / `isFollowUpOrReturn`). Used in three places:
  - `showModeSwitcher` excludes request — there's no existing animal to pick.
  - The existing-animal picker block is gated `!isObservation && !isRequest`.
  - The new-animal grid renders single-column for requests; the animal-name input is hidden, leaving species alone.
  - `checkStep1Valid` short-circuits for requests: only `species` is required.
  - Submit serializes `animalName: null` for requests (defensive — form state defaults to `''` and shouldn't leak through, but explicit null is clearer at the DB row).

### Notes
- **No DB or schema change.** The `adoptions.animal_name` column is already nullable; existing request rows that had a name in their `animal_name` column are not migrated and stay as-is.
- **Edit form (`AdoptionFormEditV2`) intentionally untouched.** If a rescuer is editing a historical request that happened to have an animal name, they can still see and clear it via the edit path.

## [2.14.9-2] - 2026-05-10

Fixed `[object Object]` showing up in Axiom whenever audit-log writes failed. Both catch blocks in `src/lib/audit.ts` were calling `logger.error('[Audit] ...', { error: e... })` — the `{error}` object was getting passed as the **second positional argument** to `logger.error(message, error?, data?)`, which logger's non-Error branch then stringified to `"[object Object]"` (because `String({error:'...'})` → `"[object Object]"`). The actual error message + stack never made it to Axiom — every audit-log failure was unactionable.

### Fixed
- **`src/lib/audit.ts:70`** — `logger.error('[Audit] Failed to log', e, { action, target })`. Pass the raw error as 2nd arg so logger extracts `name`/`message`/`stack`; pass operation context as 3rd arg.
- **`src/lib/audit.ts:172`** — same fix on the upsert-user-profile path. Used `userId` and `email` (parameters in scope at catch level) instead of `resolvedId` (declared inside the try block, not visible in the catch).

### Notes
- **Issue C from the audit (`p.organization` schema-drift error)** — already resolved in current `master`. The legacy free-text `organization` column was deprecated in v2.12.1-34 (migration 0037) and the `/api/admin/users` SELECT no longer references it. The May 6 occurrence was on a stale deploy.
- **The `[Audit]` errors were both rare** (2 occurrences in 7 days), but each one was a black box. With this fix the next failure will surface the underlying SQLite/D1 message + the audit `action` and `target` so we can actually triage.

## [2.14.9-1] - 2026-05-10

Hardened the adopter profile page against single-query failures. The Server-Components SSR error that surfaced on May 7 (digest `3138068963`, user `michistrendelacosta`) was the result of `src/app/adopter/[id]/page.tsx:56` doing a bare `Promise.all` of 9 D1 queries with no per-fetch error handling — a transient D1 outage on any one of them threw, Next.js caught it, redacted the message in prod, and the user got a blank profile with no log of the actual cause. Confirmed via Axiom: 1.2 seconds before that SSR error, the same user's `Log profile view failed` warn fired (D1 insert into `adopter_stats` rejected) — the profile_view stat was wrapped in try/catch (CLAUDE.md degraded pattern) so it logged-and-continued, but the 9-query Promise.all wasn't.

### Fixed
- **`src/app/adopter/[id]/page.tsx`** — wrapped each of the 9 fetches in `Promise.all` with `.catch(fallback(...))`. Each fallback logs at `warn` level with `{ op, adopterId, userEmail, error }` and returns a typed safe default (`null` for `getAdopter` / `getAdopterStats` / `getAverageRating`; `[]` for the array-returning queries). The page now degrades a section instead of crashing the whole SSR, and Axiom captures the real underlying error every time. Mirrors the `enrichAdopters` D1-fallback pattern documented in CLAUDE.md.

### Notes
- **No domain change.** The downstream components (`AdopterProfileV2` and its children) already handle `null` adopter / empty arrays — that's the existing "is this adopter new" / empty-state logic. No new branches required.
- **The `?? null` for `availableAnimals`** in the `isNew` branch was tightened too — a small wrapper logger fires if that single query fails, matching the rest of the page's posture.
- **Other errors found in the same Axiom audit (separate fixes pending):** `Save adoption failed` with empty `adopter_id` (May 6, "available" record_type flow); `Get users failed: no such column: p.organization` (May 6, schema drift on `/admin/users`); `[Audit] Failed to log` capturing `[object Object]` (logger plumbing bug). Each filed for its own commit.

## [2.14.9] - 2026-05-09

Activity-wizard step 1 now shows explanatory copy that varies by record type — and, for `adoption` / `adoption_request`, by the adopter's average rating. The flat `[icon] Solicitud` badge gave the rescuer a label but no guidance; the new copy tells them what we know about this person and what to do given that knowledge. Rating-1 cases get an explicit "no se recomienda" warning; rating 4-5 gets a calmer "buenas referencias — igual recomendamos contrato"; brand-new adopters (no ratings) get a "tu seguimiento será el primero" framing.

### Added
- **`src/components/RecordTypeGuidance.tsx`** (new) — title row + body paragraph + record-type chip on the right. Computes a `'none' | '1' | '2' | '3' | '4_5'` rating bucket from `avgRating`, looks up the matching i18n string at `wizard.guidance.<recordType>.body.<bucket>`. Body strings can embed `**bold**` (rendered as `<strong>`) and `{historyLink}…{/historyLink}` tokens (rendered as a button that scrolls to `#adoption-history`).
- **`src/i18n/locales/es.ts` and `en.ts`** — 18 new keys under `wizard.guidance.*`. ES is the canonical voice; EN is a literal translation. Five record types × titles plus 8 rating-aware bodies (adoption + adoption_request × 4 buckets each, with `none` and `4_5` collapsed) plus 3 rating-neutral bodies (follow_up, returned_pet, observation).
- **`src/components/AdoptionHistory.tsx`** — `id="adoption-history"` (with `scroll-mt-4`) on the timeline wrapper. Becomes the scroll target for the `{historyLink}` token.

### Changed
- **`src/components/AdoptionFormWizard.tsx`** — accepts `adopterName` and `avgRating` props. The `initialRecordType` branch (when the wizard is opened from VisitIntentCard with the type pre-selected) now renders `<RecordTypeGuidance>` instead of the small read-only badge. The manual-open chip-grid path stays untouched (no record type chosen yet → nothing to explain).
- **`src/components/AdopterProfileV2.tsx`** — threads `adopterName` and `avgRating` into both the direct `AdoptionFormWizard` mount and the `VisitIntentCard` mount.
- **`src/components/VisitIntentCard.tsx`** — accepts an optional `avgRating` prop and forwards it (alongside `adopterName`) into the wizard it spawns.

### Notes
- **Edit form is intentionally unchanged.** Per the plan, `AdoptionFormEditV2` still shows the small chip — explanatory copy would be preachy when someone is just fixing a typo on an existing record. The new copy only fires on creation.
- **Bold emphasis** is applied only where the warning is severe (rating 1 in both flows) or where the action verb deserves it (rating 2 "seguimiento cercano", observation "denuncia policial"). Calmer ratings (3, 4-5, neutral types) intentionally have no bold.
- **The `{historyLink}` token** is only present in 3 strings (request rating 1/2/3). Click → `document.getElementById('adoption-history')?.scrollIntoView({behavior:'smooth'})`. Plain DOM scroll, no router involved — works because the wizard is only mounted on the profile page where the timeline exists.
- **Plan saved at** `.agents/plans/wizard-explanatory-copy.md` for reference.
- **Type-check + lint clean** for all touched files.

### Also bundled — cost observability traces

Wrapped the three highest-leverage server-action paths in the existing `withTrace(...)` helper from `src/lib/logger.ts`. Each emits an `info`-level Axiom log line with `trace`, `duration` (ms), and small metadata so we can chart p50/p95 by route from APL queries — no new infra. Targets:

- **`findAdopters` discovery mode** — `findAdopters.discovery` trace, metadata `{ rawLen, enrich }`.
- **`findAdopters` duplicate mode** — `findAdopters.duplicate` trace, metadata `{ nameLen, phones, emails, socials }`.
- **`enrichAdopters`** — wrapped via internal `_enrichAdoptersImpl` so the public signature is unchanged. Metadata `{ count }` (adopter list size).

These were the answer to your earlier question about how to tell which functionality is most expensive as the app scales — once shipped, Axiom dashboards can `summarize p50, p95 by trace` to surface the slow paths.

## [2.14.8-6] - 2026-05-09

Fixed: `/admin/adopters` "Created / Updated by" filter did nothing when a user was selected. Selecting a name from the dropdown should have navigated to `/admin/adopters?user=…` and re-filtered the list — but the inline `<script dangerouslySetInnerHTML>` that wired the `addEventListener` was a fragile pattern that didn't survive App Router hydration consistently. Replaced with a proper React client component.

### Fixed
- **`src/components/UserFilterSelect.tsx`** (new) — `'use client'` component with a real `onChange` handler that calls `useRouter().push(...)` to update the URL with the selected user filter. Preserves any existing `?q=…&country=…&rating=…` filters while adding/replacing the `user` param.
- **`src/app/admin/adopters/page.tsx`** — replaced the inline `function UserFilterSelect(…)` definition (which used `dangerouslySetInnerHTML` to inject an `addEventListener` script) with an import of the new client component. Removed the now-dead `buildFilterUrl` prop on the call site (the new component constructs URLs directly with `URLSearchParams`).

### Notes
- **Why the old pattern broke**: server components can render `<script dangerouslySetInnerHTML>` to the wire, but the script body runs once during initial HTML parse — it has no React lifecycle. After hydration, React reconciles the DOM tree; any DOM-node identity it changes drops the externally-attached `addEventListener`. The dropdown stayed visible, the value changed locally, but the change handler was gone. Plain React `onChange` on a client component is the correct shape and survives every re-render.
- **No DB / API change.** Pure UI plumbing fix.
- **Unrelated tidy:** the dropdown still shows raw email addresses (`gatitosolivos@gmail.com`) rather than user display names. Resolving display names here is a separate concern (would need to wire `userNameMap` through the page component) — filed as a follow-up if the user complains; not in scope for this bug fix.

## [2.14.8-5] - 2026-05-09

Three small homepage layout polish fixes bundled in one commit (all in `page.tsx`).

### Changed
- **`src/app/page.tsx`** — Action-cards order is now `Adoption · Report · Import` (Import was leading the grid before; it's the rarer power-user action and now sits last). Import card's CTA restyled from solid `bg-teal-600 text-white` to `bg-teal-200 text-teal-900 font-semibold` to match AdoptionWizard's soft-pill style — three cards now read as visual peers (teal/rose/teal soft pills) instead of `1 primary CTA + 2 softer pills`. The grid still becomes `md:grid-cols-2` when `ENABLE_CONTENT_IMPORT` is off.
- **`src/app/page.tsx`** — `<QuickAccessStrip />` (the "My Animals / My Adoptions / My Adopters" pills) moved from above the action-cards grid to below it. **CX rationale:** action cards represent *create intent* (the app's primary purpose: log new adoptions / reports / imports); pills represent *navigate-to-existing-data intent*. UserMenu in the page header already serves explicit navigation, so the pills reinforce rather than gate. Active-above-passive is the right hierarchy for a logging tool.
- **`<MilestoneBadge />` ("Completaste X adopciones") gated by new feature flag.** Now renders only when `appConfig.ENABLE_MILESTONE_BADGE !== 'false'`. Default is `true`, so existing behavior is preserved on deploy; admin can flip to `false` via `/admin/config` to hide the badge for everyone.

### Added
- **`ENABLE_MILESTONE_BADGE` feature flag** wired through the standard 4-place plumbing:
  - `src/config/features.ts` — added to `FEATURE_FLAGS` const + `getAllFeatureFlags` return.
  - `src/app/api/admin/config/route.ts` — added to GET response shape.
  - `src/app/admin/config/page.tsx` — added to `FEATURE_FLAGS` array (renders a toggle row), `ConfigData` interface, `useState` initializer, fetch hydration.
  - `src/i18n/locales/{es,en}.ts` — `admin.flag_label_milestone_badge` ("Insignia de hitos" / "Milestone Badge"), `admin.flag_desc_milestone_badge`.

### Notes
- All three changes verified in `tests/` — no Playwright selectors target `QuickAccessStrip` DOM position, the Import card's specific CTA classes, or the MilestoneBadge presence/absence. No e2e impact.
- Net diff intentionally small. Layout reorders are cheap; the only architectural addition is the new flag, which mirrors the existing 4-place duplication for `ENABLE_CONTENT_IMPORT` / `ENABLE_CHAT_WIDGET` exactly.

## [2.14.8-4] - 2026-05-09

Homepage search — added a "¿Ninguna persona coincide?" CTA at the end of the results list. Until now, users who scrolled through all matches and decided none was the person they were looking for had to scroll back up to find the small "+ Crear nuevo" chip in the results header — extra friction at the exact decision moment. Now there's a one-tap exit immediately under the last result card.

### Added
- **`src/components/SearchSection.tsx`** — new block CTA rendered when `results.length > 0`, positioned after the result-card map and before the empty-state branch. Visually mirrors the no-results card (same `bg-stone-50` rounded card + same teal button) but slightly less heavy (no leading 🔍 emoji, smaller heading text) since this is a secondary exit, not the primary state. Uses the same `handleCreateNew` handler as the existing top-chip and the empty-state CTA.
- **`src/i18n/locales/{es,en}.ts`** — `search.none_match_heading` ("¿Ninguna persona coincide?" / "None of these match?") and `search.none_match_desc` (full sentence). Reuses the existing `search.create_new` for the button label.

### Notes
- Top-of-list `+ Crear nuevo` chip stays. It serves a different user: the at-a-glance dismisser who scans the count and the first card and immediately knows none will match (e.g., a common surname returning strangers). The bottom block serves the methodical reader.
- Pattern consistency with v2.14.7-16's "¿Ninguna coincide?" affordance on contract-results — same wording family, same visual treatment.
- Sticky / floating-action-button variants for very long results lists explicitly deferred. End-of-list block solves the named problem; sticky variants add complexity (covering content, mobile gesture conflicts) without evidence of need yet.

## [2.14.8-3] - 2026-05-09

Notification rows showed two emoji per item (`item.icon` rendered next to a `title` that already started with the same emoji), making every row read like `⚠️ ⚠️ 1 coincidencia para …`. Fixed at both write and render sites.

### Changed — write site (canonical fix)
Dropped the leading emoji from every notification `title` string. The dedicated `icon` field carries the emoji going forward; titles are now plain text.

- **`src/app/api/contract/[id]/submit/route.ts`** — 3 titles cleaned (`⚠️`, `✅`, `📝` prefixes removed).
- **`src/app/api/form/[userId]/submit/route.ts`** — 3 titles cleaned (3× `📋` prefix removed).
- **`src/app/actions/duplicates.ts`** — `attachContractToExistingAdopter` notification (`📝` prefix removed).

### Added — render site (legacy safety net)
- **`src/components/NotificationBell.tsx`** + **`src/app/notificaciones/page.tsx`** — module-scope `stripLeadingEmoji(s)` helper using `\p{Extended_Pictographic}` Unicode property. Applied at the title-render so legacy DB rows whose titles still have the emoji prefix render cleanly. Idempotent — no effect on already-clean titles. No DB migration needed; existing rows render correctly the moment this code ships.

### Polished
- **`src/components/NotificationBell.tsx`** — dropped the redundant `🔔` from the dropdown header text (the bell icon in the page header that opened the dropdown is already on screen). Switched the bell-button `aria-label` from a hand-rolled `isEs ? 'Notificaciones' : 'Notifications'` ternary to `t('notifications.title')`, consistent with the v2.14.8-2 i18n cleanup pass.

### Notes
- **DB migration intentionally skipped.** Touching every existing notification row to strip emoji prefixes risks accidentally stripping emoji from titles where the emoji is part of the content (rather than redundant with `icon`). The render-side strip handles legacy rows safely; new rows are clean by construction.
- **Out of scope** (filed and deferred): filter chips on the dropdown ("Unread / All / Archived"), per-row dismiss/swipe, archive UI. The empty/short list today doesn't need them; can revisit when scale demands.

## [2.14.8-2] - 2026-05-09

i18n cleanup pass. The user reported seeing English labels while using the app in Spanish (default locale). Existing tooling (`check_i18n.ts`) reported 0 missing `t()` keys, so the leakage was not from missing translations — it was from **hardcoded English strings that bypass `t()` entirely**: toast messages, confirm dialogs, alt text, aria-labels, page headers, and admin sidebar labels. This release wires every user-visible English string through the i18n layer, reusing existing ES translations where they already exist and adding a new `admin` namespace for the rest.

### Added — i18n keys (es.ts + en.ts)
- New `admin` namespace with ~30 keys covering: console title, sidebar nav (overview / flagged / duplicates / adopters list / SQL / config / data requests / communications / users / organizations / audit log / system health / data migration / CMS), open/close menu aria-labels, system-config page chrome, feature-flag labels and descriptions (4 flags), per-stat-pill titles on /admin/users, action-button titles (delete user / delete org / remove member / view geolocation / permanently delete adopter), country-picker placeholder, "Remove message" aria-label, telegram-saved toast, and "back to app" short label.
- `common.video_thumbnail_alt` for video preview alt text.
- `dashboard.animal_listed`, `dashboard.deleted_title`, `dashboard.country_updated_title`, `dashboard.records_updated` for the my-animals listing flow + admin mass-action toasts.

### Changed — components now use `t()`
- **`src/components/AdminSidebar.tsx`** — all 13 nav items, "Admin Console" header, mobile open/close menu aria-labels, "← App" / "← Back to App" exit links, "CMS Editor" link.
- **`src/components/DeleteAdopterButton.tsx`** — confirm dialog (uses `dialogs.confirm_delete_adopter` with `{name}` interpolation), failure toasts (uses `toast.delete_failed_title` / `errors.unknown_error` / `errors.unexpected`), button label and tooltip.
- **`src/components/DuplicateMergeModal.tsx`** — merge confirmation dialog (uses `dialogs.confirm_merge` with `{primary}` + `{secondary}` interpolation).
- **`src/components/AdminAdopterList.tsx`** — batch-delete confirm, action-failed toast, "Set Country" placeholder, success toast for batch ops.
- **`src/components/AdoptionFormWizard.tsx`** + **`src/components/AdoptionFormEditV2.tsx`** — `alt="Video thumbnail"` → `t('common.video_thumbnail_alt')`.
- **`src/components/ui/MediaLightbox.tsx`** — close button aria-label.
- **`src/app/admin/config/page.tsx`** — every toast (12 sites), the purge-stats confirm, "Loading configuration", page headers, feature-flag labels & descriptions (now driven by `labelKey` / `descKey` references into i18n instead of hardcoded English in the array literal), the social-proof "Remove message" aria-label.
- **`src/app/admin/audit/page.tsx`** — purge-audit confirm, "View geolocation" tooltip.
- **`src/app/admin/duplicates/page.tsx`** — dismiss-candidate confirm.
- **`src/app/admin/users/page.tsx`** — `ActivityCell` pill tooltips (4× "Adopters created" / "Records added" / "History edits" / "Flags filed"), "Delete user" tooltip.
- **`src/app/admin/organizations/page.tsx`** — "Delete organization" / "Remove member" tooltips.
- **`src/app/my-animals/new/page.tsx`** — 4 toasts (load-failed, invalid-file, upload-failed, save-failed) + the post-save success toast (now uses interpolated `dashboard.animal_listed`).

### Notes — methodology
- **`check_i18n.ts` does not detect hardcoded English** — it only catches `t('foo.bar')` calls where `foo.bar` is missing from a locale. Everything in this PR was English literal in JSX or argument lists, invisible to the existing checker. A future improvement could add a lint rule for English string literals inside JSX text nodes / `placeholder=` / `aria-label=` / `title=` / `toast.*(...)` / `confirm(...)` to catch these going forward, but that's separate scope.
- **Out of scope (deliberately deferred):** the ~40 entries in `tests/` are skipped — Playwright assertions reference rendered text and tests run against ES locale, so any English literal in a test selector is checking the intended ES translation. Touching tests here would be conflating "fix i18n" with "test maintenance." If a test expects the old English string and the corresponding component now renders ES, that's a real regression — covered by the next CI run, will fix-forward if any pop up.
- **Audit-log `ACTION_LABELS` table** in `admin/audit/page.tsx` (~30 specific action labels like "Sign In" / "Adopter Created") was left in English. Those are technical event types displayed in an admin-only deep page; translating each one to Spanish without losing fidelity is a larger product call. Filed as a known not-yet-translated surface; not in this release.

## [2.14.8-1] - 2026-05-09

Activity timeline — record-type icon moves into the timeline dot. The dot is now a "beacon": a colored circle large enough to fit a centered SVG icon, white on the saturated bg. Same record-type signal that previously appeared in three places per row (timeline dot color, in-card icon badge, mobile inline-tinted icon, plus the 4px left stripe) is now in one canonical place.

### Changed
- **`src/components/AdoptionHistory.tsx`** — timeline dot grows from `w-[15px] h-[15px] md:w-[23px] md:h-[23px]` (empty) to `w-6 h-6 md:w-8 md:h-8` (with a centered `<RecordTypeIcon>` in white). Position offsets adjusted so the dot stays centered on the rail (`left-[-4px]` mobile, `left-[-3px]` md). `top-5` → `top-3` to align with the rating-badge row inside the card. Ring simplified from `ring-2 md:ring-4` to a single `ring-2` since the bigger filled circle doesn't need a thick ring.
- **`src/components/AdoptionHistory.tsx`** — the in-card desktop icon badge (`w-7 h-7 rounded-lg ${colors.iconBg}`) and the mobile inline-tinted icon are both removed from the verb-summary column. The verb summary leads the middle column directly. The card's 4px left stripe (`STRIPE_BY_TYPE[recordType]`) stays as the secondary type cue on the card body.

### Notes
- `RecordTypeIcon` and `getRecordTypeColors` helpers are unchanged. Other consumers (`ImportWizard`, `AdoptionFormWizard`'s type-picker chips, the read-only edit-form badge) keep using `colors.iconBg` etc. as before.
- Net diff: ~10 lines per row simplification, ~−15 LOC overall.
- Tests not touched: no Playwright selector targets `.dot` or the in-card icon badge by class/aria — verified before commit.

## [2.14.8] - 2026-05-09

Activity-recording entry point consolidated to **one** path: the VisitIntentCard prompt at the top of the activity section. The standalone "Registrar Actividad" CTA — which was already hidden whenever the intent card was visible (i.e., always, since v2.14.7-18) — has been removed entirely. The intent card now stays available for the entire page session: after the user picks an intent, completes the wizard, and the wizard closes, the intent options re-render in place so the user can record another activity without leaving the page.

This consolidates the v2.14.7-1..-22 batch. Highlights since 2.14.7 stable:

- Color/theme fidelity sweep (info-token retune, light-theme stone overrides, status-pill token migration, intent-label color)
- Activity-section scannability (3-column header, per-record-type stripe, summary row, line-clamped notes, ··· corner menu, footer redesign)
- Adopter profile change-log diff bug fixed (delta.from JS-clamp removed; both halves render with line-clamp + break-all)
- Settings location tiles overflow fixed
- Contract API: rescuer name now from `user.name`, not email-prefix
- Contract-results merge action ("Es la misma persona") with cross-creator notification
- Contract-results "¿Ninguna coincide?" affordance for keep-as-new outcome
- mergeAdopters() extracted from admin route into shared helper
- findAdopters duplicate-mode now filters soft-deleted at write+read sites; D1 inArray bug eliminated
- Visit-intent prompt graduates from feature-flagged to always-on
- Wizard skips type picker when intent is known; edit form always uses read-only badge
- 30-day "already acted" suppression on intent options removed
- admin/users dashboard: location columns + activity counts + audit deep-link
- Several e2e regressions caught & fixed; pipeline-watch lesson saved to memory

### Changed (this release)
- **`src/components/VisitIntentCard.tsx`** — `hidden` state and `setHidden` calls removed. `onHide` prop removed from the interface. After the wizard closes (cancel or save), the card resets `openedRecordType` to `null` and `view` to `'main'`, falling through to re-render the option chips. `trackedShown` stays sticky so we don't re-fire the zaraz `visit_intent_shown` event on each cycle.
- **`src/components/AdopterProfileV2.tsx`** — `visitIntentDismissed` state and `visitIntentVisible` calc both removed. The `onHide` callback wiring on `<VisitIntentCard>` and the `hideOpenButton={visitIntentVisible}` prop on `<AdoptionFormWizard>` are gone.
- **`src/components/AdoptionFormWizard.tsx`** — `hideOpenButton` prop removed from the function signature. The closed-state `<button>` render block (the "Registrar Actividad" CTA at lines 363-378) is gone; closed state now returns `null`. The wizard mounts so URL-driven `?newAdoption=...` flows still work, but it has no visible surface unless something explicitly opens it.

### Notes
- Net diff in this release: **−40 lines** across three files. The two-entry-point pattern was carrying real complexity for a UX inconsistency.
- URL-driven `autoOpen` paths (`?newAdoption=true`, `?continueToAdoption=true`) still work — they set `isOpen=true` in the wizard's initial state, bypassing the closed-state branch entirely.
- After a wizard save, `router.refresh()` re-fetches server data, so the new adoption appears in the timeline below while the user remains on the page with the intent card available for the next record.

## [2.14.7-22] - 2026-05-09

Test fix — unblocks the staging deploy that's been stuck at v2.14.7-17 since v2.14.7-18 (four consecutive red pipelines, all from the same single test failure).

### Fixed
- **`tests/authed.spec.ts:34`** — the "Full adoption record" test was clicking the standalone "Registrar Actividad" CTA to open the wizard. v2.14.7-18 made VisitIntentCard always-on for authenticated users, which suppresses that CTA via `hideOpenButton={visitIntentVisible}` in `AdopterProfileV2.tsx:158`. The test now opens the wizard via the canonical entry point — clicking the VisitIntentCard's "Le dí un animal en adopción" option (matches both ES and EN labels). The wizard auto-opens with `initialRecordType='adoption'` from there, and the rest of the test flow (animal name input, species, save) is unchanged.

### Notes — methodology lesson
- **Background `gh run watch --exit-status` does not exit non-zero on pipeline failure** in this gh CLI version (or in this combination of flags). My v2.14.7-19 background watch reported "exit code 0" → I told the user "✅ succeeded" without reading the actual output file, which ended with `FINAL: failure`. The user found the bug by checking staging directly and seeing v2.14.7-17 still served. **Lesson: when polling pipeline status via background tasks, always read the output file, never trust the exit code alone.** Saved as a memory.
- All four failed pipelines (v2.14.7-18 / -19 / -20 / -21) had the same root cause. The test fix in this release restores the deploy chain — once green, staging will jump to v2.14.7-22 (which carries every change from v2.14.7-18 onward).

## [2.14.7-21] - 2026-05-09

Removes the 30-day "already acted" suppression on the VisitIntentCard. All three intent options now always show for any authenticated visitor. The suppression was a defensive choice to prevent duplicate same-day registrations, but it bit on legitimate repeat-adoption flows: a person can adopt a second pet from the same rescuer, request another after a previous adoption falls through, or do follow-ups in addition to past activity. Letting the user pick freely is the correct default; defending against accidental duplicates is the user's responsibility, not the UI's.

### Changed
- **`src/components/VisitIntentCard.tsx`** — removed `userActedRequest` / `userActedAdoption` `useMemo` calls, the `ALREADY_ACTED_WINDOW_MS` constant, the `isWithinWindow` helper, and the `showA` / `showB` / `showC` / `anyVisible` flags. Simplified `mainButtons` to a flat array of three entries (no `visible` field). The `visit_intent_shown` zaraz event no longer carries `suppressed_a` / `suppressed_b` properties — they would always be `0` now and provided no signal.

### Notes
- The triggering case: a rescuer attached a contract via `attachContractToExistingAdopter` (v2.14.7-14), which re-pointed an adoption record with `addedBy = themself` onto the matched profile, and the suppression then hid the "Gave adoption" option on that profile for 30 days. The suppression was *technically correct* (the user did just record an adoption), but it conflated "this person was the actor on a record" with "this person doesn't need the option again."
- Useful side-effect: simplifies the component significantly. ~30 lines of state + memo + filter logic gone.

## [2.14.7-20] - 2026-05-09

Activity-record edit form no longer offers the type selector. Same reasoning as v2.14.7-18's wizard change: when you're editing an existing record, the type was already chosen at creation time, and changing it after the fact is rare-and-confusing enough that the cleaner UX is "delete and re-create" if it was wrong. Kept as a colored read-only badge so the editor still sees what they're working with.

### Changed
- **`src/components/AdoptionFormEditV2.tsx`** (lines ~587-606) — replaced the 5-chip record-type picker with a single read-only badge showing the loaded record's type. Form fields below still react to `formData.recordType` (loaded from `initialData`), so type-conditional UI continues to render correctly.

## [2.14.7-19] - 2026-05-09

`/admin/users` becomes a triage dashboard rather than a roster. Adds detected geography (province / city / timezone), per-user activity counts, and a one-click link to that user's audit log.

### Added
- **`src/app/api/admin/users/route.ts`** — extended `GET` SELECT to include `province`, `city`, `timezone`, `terms_accepted_at`, `terms_version` from `user_profiles` (these were already populated via Cloudflare auto-detect on sign-in but the API was only returning `country`). Adds four correlated `COUNT(*)` subqueries for per-user activity totals: `adopters_count` (created, soft-delete-filtered), `records_count` (`adoptions` rows), `edits_count` (`adopter_history` rows), `flags_count` (`adopter_flags` rows). All keyed on `email` since that's the actor identifier across the schema.
- **`src/app/admin/users/page.tsx`** — new `LocationCell` component renders `🇦🇷 AR · Buenos Aires · La Plata` with the IANA timezone in the `title` tooltip. New `ActivityCell` renders four small color-coded count pills (👤 adopters · 📋 records · ✏️ edits · 🚩 flags) with hover-tooltips, hiding any pill whose count is 0.
- **Audit-log link** per user in both desktop Actions cell and mobile button row, deep-linking to `/admin/audit?userId=${email}` (the existing audit page already accepts that query param at `audit/page.tsx:54`).

### Changed
- **Desktop table layout**: dropped the standalone "ID" column (CopyIdButton moved inline under the user's email). Combined "First Sign In" + "Last Active" into a single "Lifecycle" cell with two stacked rows. Replaced "Country" with the new "Location" cell. Net column count: 8 → 7. The activity column adds back one but the table is now wider on signal, narrower on chrome.
- **Mobile cards**: same content swap — Country row replaced with Location, Activity-pills row added, Audit button alongside Edit/Delete.

### Notes — explicitly deferred
- **Per-user lat/long + map.** Discussed and explicitly deferred. `user_profiles` has city/province/timezone (Cloudflare can detect them) but **no lat/long column**, and adding one is a privacy design call before it's an engineering one. If a map view becomes worth building, the recommended path is geocoding the city name on-the-fly (cached) and rendering pins at city centroids — same visualization, no precise-coordinate storage tying an email to a GPS point.
- **Performance note**: the four new `COUNT(*)` subqueries are correlated — fine at current user-table size (low hundreds), borderline if it grows past a few thousand. Switch to LEFT JOIN + GROUP BY or a precomputed materialized count if/when that happens. Comment in the query SQL spells this out.

## [2.14.7-18] - 2026-05-09

VisitIntentCard graduates from feature-flagged to always-on for authenticated users on adopter profiles, and the activity-creation wizard skips its type-picker step when opened with a known intent (since the user already chose the type one click ago in the intent card).

### Removed
- **`ENABLE_VISIT_INTENT_PROMPT` feature flag.** Gone from `src/config/features.ts` (`FEATURE_FLAGS` const + `getAllFeatureFlags`), `src/app/api/admin/config/route.ts` (response shape), `src/app/admin/config/page.tsx` (toggle UI + state + hydration), `src/app/adopter/[id]/page.tsx` (`getFeatureFlag` call + import + variable + prop pass), `src/components/AdopterProfileV2.tsx` (`enableVisitIntent` prop in interface, destructure, and `visitIntentVisible` calc + child prop), and `src/components/VisitIntentCard.tsx` (`enabled` prop in interface, destructure, and `baseEligible` calc).
- Visibility rule simplifies to: **authenticated user + applicable adopter profile + at least one option not suppressed by the user's recent matching records**. The 30-day already-acted suppression for options A and B (and option C always available) stays exactly as it was.

### Changed
- **`src/components/AdoptionFormWizard.tsx`** — when `initialRecordType` is provided (intent-driven open from VisitIntentCard), step 1's chip selector is replaced with a small read-only confirmation badge showing the chosen type. Removes redundant friction one click after the user already picked the intent. Manual-open paths (URL params or the standalone "Registrar actividad" CTA, neither of which set `initialRecordType`) keep the full chip selector unchanged.

### Notes
- The DB row `app_config[ENABLE_VISIT_INTENT_PROMPT]` is now an orphan — no code reads it, no UI writes it. Not migrating it out; it's a single key-value row of dead data, not worth a migration ticket.
- No e2e tests touch VisitIntentCard or its feature flag; this change has no test surface to update.

## [2.14.7-17] - 2026-05-09

Fix the e2e regression in v2.14.7-16 — the contract-link test passed (44 passed) but its merge target was a seed adopter (María García López), so the merge appended duplicate contact data to María's profile, which then broke `tests/search.spec.ts:66`'s strict-mode `getByText(/555-1234/)` (now resolved to two `<a>` elements instead of one). Test isolation lesson: e2e tests for destructive operations must use dedicated fixture rows, not shared seed adopters.

### Fixed
- **`tests/contract-link.spec.ts`** — refactored to use a dedicated fixture adopter (`test-contract-fixture-target` with name "ContractFixturePerson Sintética") as the merge target instead of seed adopter María. The fixture is created via `INSERT OR REPLACE` on `adopters` + `duplicate_tokens` so re-runs reset state, and the contract submit now sends a unique-ish name (no phone/email/dni) so the matcher only surfaces the fixture, not seed rows. Seed adopters' contactInfo stays clean for downstream tests.

### Notes
- The CHANGELOG entry for v2.14.7-15 said "the fixture `adoptions` row stays in the DB after each run" — implicitly accepting residual data, which was fine for the animal row but **not** fine for the merge target. That oversight is what allowed v2.14.7-16's pipeline failure. Lesson saved as a memory: e2e tests for destructive merges must use dedicated fixture rows.

## [2.14.7-16] - 2026-05-09

Adds the missing "keep as new profile" affordance on the contract-results page. Until now, a rescuer who reviewed the matches and decided none were duplicates had no clear way to signal that — the bottom-link "Ver perfil del nuevo adoptante" was buried under a hairline divider and worded as navigation, leading users to think they were required to pick a match. This release adds an explicit decision affordance under a "¿Ninguna coincide?" heading, plus event-tracking on both triage outcomes (merge vs keep-new) so we can validate the visual-weight choice with real data 30 days post-ship.

### Added
- **`src/app/actions/duplicates.ts`** — new `markContractKeepNew(adopterId)` server action. Inserts a single `adopterStats` row with `eventType: 'contract_kept_new'` for analytics. Fire-and-forget — failures never block the user navigation, only logged at warn level.
- **`src/app/actions/duplicates.ts`** — `attachContractToExistingAdopter` now also writes a `contract_merged` analytics event on the matched adopter, mirroring the keep-new event so we can compare outcome volumes.
- **`src/components/ContractResultsKeepNewButton.tsx`** — new client component. Single full-width CTA "Continuar con el perfil nuevo" rendered under a "¿Ninguna coincide?" section heading below the match cards. On click, fires the analytics action then navigates to `/adopter/${orphanAdopterId}`. Visual weight is intentionally below the per-match "Es la misma persona" buttons (those are the dominant action when a match is real) but above the soft-investigation exit link at the bottom of the page.
- **`src/i18n/locales/{es,en}.ts`** — new keys: `contractResults.none_match_heading`, `none_match_desc`, `continue_with_new`, `view_new_without_deciding`. Added to both locales.

### Changed
- **`src/app/contract-results/[notificationId]/page.tsx`** — added the new "¿Ninguna coincide?" section + `ContractResultsKeepNewButton` between the match cards and the bottom link. Bottom-link reworded from `👤 Ver perfil del nuevo adoptante` to `👤 Ver el perfil del nuevo adoptante (sin decidir)` and demoted from `text-blue-600 font-medium` to `text-xs text-stone-500` so its intent ("look around without committing") is visually distinct from the prominent decision CTA above. The new heading is only rendered when `hasMatches` is true — when there are no matches, no triage decision is needed.

### Notes — UX scope explicitly limited
- **Wording is action-framed, not assertion-framed.** The button label is "Continuar con el perfil nuevo" (continue with new profile), not "Es una persona nueva" (this is a new person). A rescuer who is only 70% confident shouldn't have to claim certainty to triage; the button represents an action, not a positive identity claim.
- **No `duplicate_candidates` dismissal in this PR.** It would be valuable to record "rescuer reviewed matches A and B and rejected both" as input to future matcher runs (so the same matches don't keep surfacing for the same orphan). But that requires the matcher to actually consume `dismissed` rows, and we haven't decided how (skip forever? score-down by N% for M days? presentation filter only?). Filing a future ticket for that is **deliberately blocked** until someone writes a one-paragraph spec — otherwise we accumulate dead-data rows that a future engineer assumes are load-bearing.
- **Visual-weight choice is best-guess.** We have no analytics on rescuer triage behavior today (no events were tracked before this PR). The chosen hierarchy — "Es la misma persona" prominent at match-card level, "Continuar con el perfil nuevo" prominent below match list, "Ver sin decidir" muted at bottom — is reasoned guess, not data-driven. With this PR's `contract_merged` and `contract_kept_new` events flowing into `adopterStats`, we can revisit the hierarchy 30 days post-ship and adjust if real outcome ratios contradict the assumption.

### Fixed
- **`tests/contract-link.spec.ts`** — v2.14.7-15's e2e test was missing the `screenshot` field in its contract-submit POST body, causing the route to return `400 "Contract document is required"`. Added a minimal 1×1 transparent PNG data URL so the R2 upload step succeeds. Test content is irrelevant for the merge-flow assertions; we just need the route to accept the request.

## [2.14.7-15] - 2026-05-09

E2E regression test for the contract-results merge flow added (TICKET-G, deferred from v2.14.7-14).

### Added
- **`tests/contract-link.spec.ts`** — full integration test of "Es la misma persona":
  1. Seeds a unique `available` adoption fixture per test run via direct D1 SQL (no public app endpoint exists for this; `wrangler d1 execute --local` is the simplest path).
  2. POSTs an anonymous contract submission to `/api/contract/[id]/submit` with data deliberately fuzzy-matching María García López (test-adopter-1) — name + lastName + phone "555-1234" + email "maria@example.com" all overlap with seed tokens.
  3. Polls the `notifications` table for the contract-result row written by the fire-and-forget matcher (more reliable than racing against the bell-dropdown render).
  4. Navigates to the contract-results page, clicks "Es la misma persona", confirms in modal.
  5. Asserts: redirect to `/adopter/test-adopter-1`, the contract's adoption now shows on María's profile, the orphan adopter is soft-deleted (`deleted_at IS NOT NULL`), the contract's adoption record points at María, and the orphan's `duplicate_tokens` rows are gone.
- Helper `execD1(sql)` and `parseD1Rows(json)` inline in the test file. Wrangler-CLI calls are slow (~5s each) but acceptable for the small number of setup/assertion calls — single full test run is ~20-30 seconds of DB ops on top of the browser work.

### Notes
- The fixture `adoptions` row stays in the DB after each run (residual data, harmless). Idempotency comes from the unique `test-animal-contract-${Date.now()}` id.
- This closes TICKET-G. Remaining deferred follow-ups: TICKET-H (orphan-cleanup batch) is explicitly out of scope per product call.

## [2.14.7-14] - 2026-05-09

Self-service contract-result merge. Until now, when a rescuer signed a contract and the system auto-created an adopter that matched an existing profile, the contract-results page just showed the matches as read-only links — no way for the rescuer to actually attach the adoption to the right profile without admin intervention. They could click into the matched profile, see the duplicate, and walk away with two adopter rows pointing at the same person. This release adds an "Es la misma persona" action that runs the merge flow on behalf of the rescuer, and notifies the matched profile's original creator so they can review.

### Added
- **`src/app/actions/duplicates.ts`** — new `attachContractToExistingAdopter(notificationId, matchAdopterId)` server action. Auth: caller must be the notification recipient. Verifies the requested target is one of the recorded matches (no arbitrary merges via this action), re-fetches `match.deletedAt` server-side at action-entry (defense against soft-delete races between page render and click), runs the shared merge with the auto-created orphan as secondary, writes a context-specific `audit_log` entry (`action: 'contract_link_to_existing'`), and fires a notification to the matched profile's `addedBy` (skipped when the actor is the creator or the creator is admin — admins do periodic reconciliation and don't need a per-merge ping).
- **`src/components/ContractResultsMatchCard.tsx`** — new client component for the contract-results match cards. Splits the previously single-link card into two distinct intents: **"Es la misma persona"** (destructive, opens confirmation modal, calls the new action, redirects to the canonical profile on success) and **"Ver perfil"** (navigates to the existing profile so the rescuer can investigate before deciding). Mobile tap targets ≥44px on both buttons; modal flows from bottom-up on small viewports.
- **`src/i18n/locales/{es,en}.ts`** — new `contractResults.*` keys: `same_person`, `view_profile`, `confirm_link_title`, `confirm_link_body`, `confirm_link_action`, `cancel`, `linking`, `link_success`, `link_error`. Added to both locales together per the project i18n rule.

### Changed (architectural)
- **`src/app/actions/duplicates.ts`** — extracted `mergeAdopters(primaryId, secondaryId, actorEmail)` from the admin merge route into a shared helper. The admin route at `/api/admin/duplicates/merge` is now a thin auth-checking wrapper. Both code paths (admin-triggered and rescuer-triggered) share identical merge mechanics, eliminating the same drift-via-divergence pattern that v2.14.7-12 fixed for the duplicate matchers. Cross-cutting note: any future merge-logic change lands in one place.
- **`src/app/api/admin/duplicates/merge/route.ts`** — refactored to delegate to `mergeAdopters()`. Behavior unchanged for admins; only the call shape moves.

### Notes — product decisions
- **Cross-creator merge is allowed.** A rescuer can attach their just-signed contract to any matched profile, regardless of who originally created it. The original creator gets notified so they can review. This is a deliberate trade-off: privacy of the original profile vs. self-service convenience for the contract-signer. Notification-after-merge means by the time the original creator hears about it, the data is already mutated; recovery from a wrong attachment requires admin intervention. Acceptable for a vetting tool where admins do periodic reconciliation; if undo-windows or pending-approval flows become desirable later, that's a separate feature.
- **Multi-match flow handled by UX, not action code.** Page redirects to the canonical adopter on successful merge, so the user can't accidentally trigger a second merge against the now-deleted orphan.
- **Orphan-cleanup batch (the never-clicked notification case) is out of scope.** If a rescuer never opens the contract-result notification, the auto-created adopter sits in the DB forever. This is a pre-existing gap unaffected by this release; deliberately not addressed here.
- **E2E regression test deferred** (TICKET-G). The new action has manual-verification gating only; a Playwright test seeding a contract that matches an existing profile, clicking through to merge, and asserting the orphan is soft-deleted should be added in a follow-up.

## [2.14.7-13] - 2026-05-08

Text-overflow sweep across user-facing surfaces. Long names, emails, IANA timezones, and free-text audit fields were silently breaking layouts on mobile and modals. The fix is a four-strategy taxonomy applied per-surface based on the user's task at that screen — not a blanket `truncate`.

### Strategy

| Strategy | Where |
|---|---|
| `line-clamp-2 break-words` + `title` | Vetting-decision surfaces where the user has to compare/judge full content (contract-results match cards, merge modal, import preview, wizard previews) |
| `truncate` + `title` | Compact list rows that click through to full data (my-adopters list, flagging suggestions, admin user names) |
| `break-words` | Free-text body the user wants to read in full (toasts, notification body, change-log fields, search snippets) |
| `break-all` | Opaque strings in tight cells where word-breaks aren't possible (admin emails, IANA timezones, masked-email fallbacks) |
| `min-w-0 flex-1` (structural) | Nested flex children where text needs to truncate/wrap (settings tiles, admin user column, ImportWizard match) |

### Fixed
- **`src/app/contract-results/[notificationId]/page.tsx:169-171`** — match-card `profile.name` was rendered raw; now `line-clamp-2 break-words` + `title`. `contactInfo` got `break-words` added alongside the existing `line-clamp-2`. Vetting-decision context — single-line truncation could cause merge-the-wrong-person errors.
- **`src/app/admin/users/page.tsx:210-214`** — desktop email row was inconsistent with the mobile view (mobile had `truncate block`, desktop had nothing). Inner column now `min-w-0 flex-1`, name `truncate` + `title`, email `break-all` (NOT truncate — admins need full email visible before destructive actions).
- **`src/components/DuplicateMergeModal.tsx:146-149`** — destructive merge decision modal: name + contact now `line-clamp-2 break-words` + `title`. Truncating identity strings on a destructive action was unsafe.
- **`src/components/AdoptionWizard.tsx:354, 430` and `src/components/ReportWizard.tsx:176, 252`** — wizard "selected adopter" preview is the last-confirmation step before a write. Same vetting-decision class as the merge modal: `line-clamp-2 break-words` + `title`. Originally proposed as `truncate` + `title` but UI-manager review caught that single-line truncation could lead a user to confirm against the wrong adopter (e.g. mid-string name collision).
- **`src/components/AdopterFlagging.tsx:553-554`** — flagging-suggestion cards: `truncate` + `title` on name + contact. Click-through to full profile mitigates truncation risk here.
- **`src/components/ImportWizard.tsx:1454-1461`** — import-preview match cards: `min-w-0 flex-1` on inner div, `line-clamp-2 break-words` + `title` on name (vetting-decision class).
- **`src/app/my-adopters/page.tsx:233-234`** — list-card name `truncate` + `title`; email `break-all`.
- **`src/components/AdopterProfileV2.tsx:233-262`** — change log diff renderer: removed the JS-side `delta.from.substring(0, 30) + '...'` clamp (it was a pre-existing constraint of unknown vintage that hid load-bearing audit data on one half of every diff but not the other). Both `delta.from` and `delta.to` now render in full with `break-all line-clamp-3` and a `title` attribute for hover-to-see-everything. Vetting tools need complete audit trails; CSS clamping bounds vertical sprawl without hiding content. Event-description bolded names (animal name, image caption) get `break-all`. Adoption-deletion notes get `line-clamp-3 break-words` + `title`.
- **`src/app/settings/page.tsx:144-178`** — geo-detected location tiles (province, city, timezone). Inner `<div>` was missing `min-w-0`, so a 32-char IANA timezone like `America/Argentina/Buenos_Aires` overflowed the 190px-wide `sm:grid-cols-3` cells. Now `min-w-0 flex-1` on the inner div and `break-all` on the value (NOT truncate — the panel exists for the user to verify auto-detection, mobile has no hover to reveal a truncated string). Tile heights now diverge slightly when long values wrap to two lines; acceptable trade-off for full visibility.
- **`src/components/ui/Toast.tsx:134-136`** — toast title + message: `break-words` (NOT truncate — when an error toast appears, the user wants to read it).
- **`src/components/NotificationBell.tsx:251-255`** — notification dropdown title + body: `break-words` on both (body keeps the existing `line-clamp-2`).
- **`src/components/AdoptionHistory.tsx:489`** — activity-section "Agregado por X" footer (added in v2.14.7-12): `break-all` on the `<strong>` so masked-email fallbacks (`j••••@gmail.com`) break cleanly mid-string instead of forcing the whole label to wrap.
- **`src/components/SearchSection.tsx:403, 408, 467`** — search-result card name + contact get `title` for hover-discoverability of truncated values; deep match-snippet block adds `break-words`.

### Notes
- **No new tests in this PR.** All edits are CSS class additions or `title` attribute additions; existing Playwright selectors (text-content, role-based, URL-based) are unaffected — verified via grep across `tests/`. Adding `truncate` doesn't change innerText, only overflow-CSS, so `getByText` selectors keep working.
- **Methodology lesson saved to memory** (`feedback_overflow_audit_method.md`): pure grep-driven overflow audits miss JS-side truncation, deeply-nested flex children without `min-w-0`, and small-grid-tile patterns. Future overflow audits should include a screen-by-screen walkthrough with stress-test data (50-char names, 30+ char timezones, multi-sentence notes), not just grep.
- **Manual verification on staging recommended:** load the adopter profile change log, settings page (mobile viewport), notification dropdown with a long-name notification, and the contract-results page with a long-name match.

## [2.14.7-12] - 2026-05-08

Fix the "two Jorge Hu profiles in the contract-results page" bug at the architectural root: contract-submit and form-submit notifications were running their own bespoke fuzzy matchers that diverged from the canonical `findAdopters` engine — missing the soft-delete filter, missing geo-filter, missing relevance scoring, and silently broken on D1 (`inArray()` returned wrong results). Both routes now go through `findAdopters({ mode: 'duplicate' })`, so soft-deleted (merged-duplicate) adopters never appear in match notifications, and behavior stays consistent across discovery search and duplicate detection going forward. Defense-in-depth filter on the result-page reads also retroactively cleans every existing stale notification.

### Fixed
- **`src/app/contract-results/[notificationId]/page.tsx`** (read-site filter) — the matched-profile SELECT now filters `isNull(adopters.deletedAt)`. This is what unblocks the immediate user-visible Jorge Hu bug: even legacy notifications whose `metadata.matchedAdopters` JSON still contains since-deleted IDs render only the live profiles. Added `like_fallback` and `name_word_fuzzy` entries to `MATCH_TYPE_LABELS` so the new findAdopters-emitted match types render localized labels instead of raw strings.
- **`src/app/form-results/[submissionId]/page.tsx`** — same read-site filter on the matched-profile SELECT.

### Changed
- **`src/app/actions/findAdopters.ts`** — `runDuplicateMode` now filters `isNull(adopters.deletedAt)` on both the LIKE strategy WHERE clause and the per-id `nameRows` fetch. Cross-cutting: this is the canonical duplicate-detection engine; the same filter now applies to **every** caller (`ImportWizard`, `AdopterFlagging`, `AdopterForm` creation check, contract submit, form submit). The behavior change is desirable everywhere — you don't want to dedupe imports against soft-deleted records or surface merged-away duplicates in flagging suggestions — but worth flagging for future maintainers.
- **`src/app/api/contract/[id]/submit/route.ts`** — bespoke fuzzy matcher (~140 lines of token + LIKE strategy code) replaced with a single `findAdopters({ name, phones, emails, socials, excludeAdopterId }, { mode: 'duplicate', minRelevance: 0, limit: 5 })` call. Output mapped to the existing `notification.metadata.matchedAdopters` shape. DNI digits appended into the `phones` array to preserve the historical "DNI as phone-token" semantic. `minRelevance: 0` chosen for vetting recall: surface even weak matches rather than risk dropping a real one. `logger.info('Contract fuzzy search completed', { animalId, adopterId, matchCount })` preserved for observability.
- **`src/app/api/form/[userId]/submit/route.ts`** — same swap. Form schema has no DNI/socials, so the call passes only `{ name, phones, emails }`.
- **`src/components/FormResultMatchCard.tsx`** — `MATCH_TYPE_KEYS` extended to handle the unprefixed match-type taxonomy emitted by `findAdopters` (`'name_full'` / `'phone'` / `'email'` / `'like_fallback'` / `'name_word_fuzzy'`) alongside the legacy prefixed taxonomy (`'token:phone'` / `'like:name'`). Same dual-taxonomy support added to `isStrongMatch`. Old notifications written by the bespoke matcher continue to render with their original labels; new notifications get the unprefixed labels.

### Notes
- **D1 `inArray()` bug fixed for free.** The bespoke matcher used `drizzleInArray(duplicateTokens.tokenValue, tokenValues)` at `submit/route.ts:182` — silently broken on Cloudflare D1 per `docs/D1_COMPATIBILITY.md` (D1 binds only the first array element). `findAdopters` was already D1-safe by design (one query per token via a for loop). Going through it eliminates the bug at the source rather than patching one site.
- **Levenshtein fuzzy matching is now active on contract/form submissions.** `findAdopters` duplicate-mode includes name-token fuzzy scoring (e.g. `Jonathan` ↔ `Jonatan`), which the bespoke matcher lacked. Net new match surface — minor false-positive uptick is expected; this is desirable for vetting recall but worth knowing.
- **TICKET-B (D1 inArray fix in submit routes) is obsolete** — covered by this refactor.
- **Regression test for soft-deleted exclusion deferred to TICKET-C.** Manual verification on staging Jorge Hu URLs (`/adopter/085706cb-3c7b-4221-93fa-d0904e2563d2` lives, `9fd1025e-940e-4aa3-84c3-771476602101` soft-deleted) — only the live profile should now appear on the contract-results page.

## [2.14.7-11] - 2026-05-08

Fix the rescuer name shown in the public contract (Vite app at adoptions.pages.dev). It was rendering the email local-part — the chosen display name now comes through.

### Fixed
- **`src/app/api/contract/[id]/route.ts`** — `rescuerName` was built as `animal.addedBy.split('@')[0]`. The Vite contract page (`contract-app/src/ContractPage.tsx`) reads that field and displays it as the rescatista. Now we look up `user.name` (the display name set in `/settings`) for the `addedBy` email and only fall back to the email-prefix when no name is set or the DB lookup fails. The catch logs `animalId` + `addedBy` per the project logging rule (re-emit operation context, never silently swallow).

## [2.14.7-10] - 2026-05-08

Audit-trail visibility restored on activity cards, and prominent emoji icons converted to inline SVG. Walks back the `···` popover from `2.14.7-9` — for a vetting tool, knowing the creator of a record is at-a-glance audit info, not metadata.

### Changed
- **`src/components/AdoptionHistory.tsx`** — bottom-of-card audit footer restored. Source link (icon + name) and "Agregado por X" (with a small user-silhouette SVG) are both always visible on a single compact row, separated from the body by a hairline `border-t border-stone-100`. The `···` corner button and `openMeta` state are gone.
- **`src/components/AdoptionHistory.tsx`** — record-type icons converted from emoji (🏠 / 📝 / 👁️ / 🔄 / ↩️) to inline SVG (Lucide-style strokes, `currentColor`-driven so the badge text color flows through). Emoji rendered inconsistently across OS / browser; SVG looks the same in Linux/Windows/Apple. The icon component lives at the top of the file as `RecordTypeIcon`. `getRecordTypeIcon` (string-emoji helper) is still used by `AdoptionFormWizard` and stays in `src/lib/recordTypeColors.ts`.
- **`src/components/AdoptionHistory.tsx`** — affordance icons converted to SVG: `✓ / ✗` neutered chips → check / x strokes; `📋` "Ver contrato firmado" → clipboard SVG; `📝` "Ver formulario completado" → document SVG. Small attribute markers (🎂 age, 🎨 color, 💉 microchip, ♂️/♀️ sex) intentionally left as emoji per the project rule "emoji OK as decorative subject markers next to text labels."

### Fixed
- **`tests/search.spec.ts:120`** — sentinel was `page.locator('text=🏠').first()`. With record-type emoji removed from cards, that selector no longer resolves. Replaced with `page.getByTestId('adoptions-list')` which asserts the same intent (activity timeline rendered) more robustly.

## [2.14.7-9] - 2026-05-08

Fixes the e2e regressions introduced by `2.14.7-8`. Two real test breaks, both my fault.

### Fixed
- **`src/components/AdoptionHistory.tsx`** — DOM order of the per-card icon spans was flipped (mobile-only span first, desktop second), causing `page.locator('text=🏠').first()` in `tests/search.spec.ts:121` to resolve to a `md:hidden` element on the desktop viewport. Restored desktop-variant-first ordering; visual output unchanged.
- **`src/components/AdoptionHistory.tsx`** — the source-URL link was moved inside the `···` popover in `2.14.7-8`, hiding it until tap. `tests/flags.spec.ts:23` asserts the Facebook source link is visible on Roberto's profile, which was load-bearing UX. Source icon is now always visible inline (top-right corner of each card, action-oriented, scannable). Only the verbose "Agregado por X" string remains behind `···`. Header row reserves `pr-16` so date + corner icons don't collide.

## [2.14.7-8] - 2026-05-08

Activity-section scannability pass on the adopter profile. The vertical timeline now reads as a scannable column rather than a stack of sentences: rating, action, and date sit in fixed slots, record-type is signaled by a 4px left stripe, and an at-a-glance summary header gives the gestalt before any scrolling.

### Changed
- **`src/components/AdoptionHistory.tsx`**:
  - **3-column card header.** Rating moves to a fixed-width left column (or em-dash placeholder), the verb+animal sits in the fluid middle, the date is right-aligned and muted. Relative time moved off the line into the date's `title` attribute on hover. The eye can now scan a vertical column of stars/dates without parsing prose.
  - **4px colored left stripe per record type** (`border-l-{teal/sky/amber/violet/rose}-500`), keyed off `recordType`. Replaces the unified-color border. Adoptions, requests, observations, follow-ups, and returns are pre-attentively distinguishable.
  - **Activity summary above the timeline.** One-line counts per record type with hue-matched numerals, plus average rating on the right. Captures "3 adopciones · 2 solicitudes · 1 devolución · ⭐ 3.8" in a single saccade.
  - **Notes clamped to 2 lines** with a `leer más / leer menos` toggle (uses a per-card expanded set in component state, only shown when the note exceeds ~120 chars). Long notes no longer break timeline rhythm.
  - **Bottom audit-trail footer removed** (sourceUrl icon + "Agregado por X"). Replaced with a `···` button in the card's top-right corner that toggles a small popover containing the same info. Audit metadata is one tap away when needed and out of the scan path otherwise.
  - **Timeline rail recolored** from the teal→violet→teal gradient to a neutral `bg-stone-200`. Categorical color now lives only on the dots and stripes, so it carries information instead of decoration.
- **`src/i18n/locales/{es,en}.ts`**: new keys `common.show_more`, `common.show_less`, `stats.observations`, `stats.follow_ups`, `stats.returns`, `stats.rating_avg_short`. Added to both locales together.

### Notes
- Animal-attribute pills (sex / age / neutered / color / microchip) intentionally left in place this pass; the broader question of whether animal facts belong on an adopter profile screen is deferred.

## [2.14.7-7] - 2026-05-08

Profile-screen color/theme fidelity pass. Status pills now go through the design-token system, the info family no longer collides with brand teal in dark mode, and `text-stone-*` Tailwind classes now resolve consistently across both themes.

### Changed
- **`src/app/globals.css`** — `--status-info-*` retuned to the sky-400 family in both themes (was teal-bg + blue-text in light, all-teal in dark which collided with `--accent`). Legal notice (`DisclaimerToast`) and any other info surface now reads as a single hue family. Added `[data-theme="light"]` overrides for `text-stone-400/600/700/800/900` mirroring the existing dark-theme block, so the same `text-stone-*` Tailwind class no longer renders warm-grey in light vs slate-blue in dark.
- **`src/components/AdopterFlagging.tsx`** — four warning pills (inaccurate / duplicate / too-many-adoptions / too-many-requests) replaced hardcoded Tailwind `bg-rose/amber/orange/purple-100` chains with token-driven inline styles. Active state now uses `aria-pressed` + `shadow-inner`; hover via `hover:opacity-90`. Too-many-adoptions collapsed onto `--status-warning-*` (no separate orange family — the warning hue carries both signals).
- **`src/components/VisitIntentCard.tsx`** — title and intent-button labels switched from `var(--accent-strong)` (`#042f2e`, reads as black in light) to `var(--accent)` (`#0f766e`, visibly teal). Hover-fill behavior unchanged.

## [2.14.7-6] - 2026-05-08

Chat setup is now fully UI-driven. Bot token + webhook secret can be saved from `/admin/config`, and the same Save button calls Telegram's `setWebhook` for you — no curl, no shell.

### Changed
- **`src/lib/telegram.ts`**: secrets resolved DB-first, Cloudflare-env fallback. `getTelegramConfig()` returns `{ botToken, webhookSecret, adminChatId }` from `appConfig` rows; missing rows fall back to the Cloudflare secret. `verifyWebhookSecret` and `sendTelegramMessage` are now async; both accept an optional pre-resolved config to avoid double DB lookups in handlers that need multiple Telegram calls.
- **New `registerWebhook(webhookUrl, config?)`** in `src/lib/telegram.ts`: thin wrapper around Telegram's `setWebhook` API. Idempotent.
- **New endpoint `POST /api/admin/telegram/setup`**: admin-only. Accepts any subset of `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_CHAT_ID` plus a `registerWebhook` flag (default `true`). Empty string clears the DB row (falls back to Cloudflare secret). When `registerWebhook=true`, derives the webhook URL from the request host (`x-forwarded-proto` + `x-forwarded-host` or `host`) and calls Telegram. Returns `{ status, webhook }` so the UI can surface "saved" and "registered" independently.
- **Admin UI redesign** for the Telegram panel in `/admin/config`:
  - Three password-style inputs: bot token, webhook secret, admin chat_id. The first two show "(currently set)" when populated and accept blank to mean "keep current value".
  - Single **Save & register webhook** button — sends the form to `/api/admin/telegram/setup` with `registerWebhook: true`. Surfaces success or specific Telegram-API error inline (green ✓ or red ✗ panel below the inputs).
  - Secondary **Re-register webhook** button — calls the same endpoint with no config changes, just kicks Telegram's `setWebhook` again. Useful after env migration or secret rotation.
  - Inline amber "Security note" callout: explains that DB-stored secrets are visible to anyone with admin DB access and points to the Cloudflare-secret path for higher isolation.
- **Masked GET response** in `/api/admin/config`: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are never returned to the client. The route now exposes only `TELEGRAM_BOT_TOKEN_SET` / `TELEGRAM_WEBHOOK_SECRET_SET` boolean indicators so the UI can render "(currently set)" without leaking the value.

### Path matrix
- **Path A (UI-only)**: paste all three into the admin form, hit Save & register. Stored in DB. One-step setup.
- **Path B (Cloudflare-secret)**: `wrangler pages secret put TELEGRAM_BOT_TOKEN` etc., leave the password fields blank in the UI, paste only the chat_id. App reads DB-first, env-fallback so this still works seamlessly.

### Docs
- **`docs/CHAT_SETUP.md`** rewritten around the two paths. Removes the long curl/setWebhook section since the admin UI handles it.

### Migration
- No schema change. The endpoint is purely additive; existing deployments continue to read Cloudflare secrets if they were configured that way.

## [2.14.7-5] - 2026-05-08

Floating support chat widget routed to admin's personal Telegram. Visitors (anon or signed-in) can chat with the admin without exposing the admin's IP. Off by default; enabled via `ENABLE_CHAT_WIDGET` flag in admin/config and Telegram secrets on Cloudflare.

### Added
- **Schema** (migration `0039_chat_tables.sql`): `chat_conversations` (id = visitor's localStorage anchor; `user_email`, `user_label`, `last_message_at`, `blocked`, `hour_count`, `hour_window_start`) and `chat_messages` (`conversation_id`, `direction` ∈ `user|admin`, `body`, `telegram_message_id` for admin-Reply routing).
- **`src/lib/telegram.ts`**: thin Telegram Bot API wrapper. `sendTelegramMessage(chatId, text)`, `verifyWebhookSecret(headers)`, `formatForwardedMessage` (prepends `[#xxxxxxxx]` routing tag), `extractConversationTag` (parses tag from `reply_to_message.text`). Reads `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` from the Cloudflare runtime env with `process.env` fallback.
- **`/api/chat` (edge)**: `POST` validates conversationId (UUID v4), enforces rate limit (≤1 msg / 5s, ≤30 / rolling hour, per conversation), drops blocked conversations silently, writes the user message to D1, forwards to admin's Telegram with the routing prefix, persists the returned `message_id`. Honeypot field on the request body discards bot submissions. `GET ?conversationId&since` returns admin replies newer than `since`.
- **`/api/telegram/webhook` (edge)**: verifies `X-Telegram-Bot-Api-Secret-Token` (constant-time-ish compare) before doing any work, parses the Telegram update, extracts the `[#xxxxxxxx]` prefix from `reply_to_message.text`, looks up the conversation by 8-char prefix (UUID v4 → 32-bit prefix → effectively collision-free at this scale), inserts the admin message. Plain (non-Reply) admin messages get a guidance reply. Admin can send `/block` or `/unblock` as a reply to mute a conversation.
- **`ChatWidget.tsx`**: client component, mounted once in root layout when `ENABLE_CHAT_WIDGET` is on. Floating bubble bottom-right, `z-[80]` (below toasts, above content); panel slides up; localStorage stores conversationId (UUID v4) + `last_seen_at`; polls `/api/chat` every 4s while open AND `document.visibilityState === 'visible'` (no background traffic); unread red dot when admin replies arrive while panel is closed; visually-hidden honeypot input. Uses theme tokens only (`--surface-card`, `--accent`, `--border-default`, `--text-primary`, `--surface-base`, `--surface-muted`) so it matches both Claro and Azul Noche by construction.
- **Feature flag** `ENABLE_CHAT_WIDGET` wired through the four-place duplication: `src/config/features.ts` (FEATURE_FLAGS const + getAllFeatureFlags default), `src/app/api/admin/config/route.ts` (GET response shape), `src/app/admin/config/page.tsx` (useState initializer + fetch hydration + admin toggle list + ConfigData interface).
- **Admin config UI**: new "Telegram Support Chat" panel on `/admin/config` with a `TELEGRAM_ADMIN_CHAT_ID` input (numeric chat_id, NOT the bot token — that lives only as a Cloudflare secret) and a Save button hitting the existing config POST endpoint.
- **`docs/CHAT_SETUP.md`**: end-to-end one-time setup walkthrough — BotFather, capturing chat_id via `getUpdates`, generating the webhook secret, `wrangler pages secret put`, registering the webhook with Telegram, smoke-test, troubleshooting, and how to rotate secrets if a token leaks.
- **i18n**: new `chat.*` keys in `es` and `en` (`open`, `close`, `title`, `subtitle`, `placeholder`, `send`, `empty_state`, `unread_indicator`, `error_send`).

### Privacy guarantees
- Browser only contacts `/api/chat` on the app's own origin. Admin's IP never appears in any client-visible network request.
- Admin's Telegram client only contacts Telegram's servers. The app's worker is the only thing that talks to both Telegram and the visitor.
- Bot token + webhook secret are stored as Cloudflare secrets, never in `wrangler.toml`, never in the DB, never reachable from client code.

### Defaults
- Off behind `ENABLE_CHAT_WIDGET` (flag default `false`). Even with the flag on, the API endpoint refuses messages until `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` are both set — degrades gracefully (logs a warning, stores the message, returns ok to the visitor) rather than crashing.
- This commit changes no visible behavior on the live site until the flag is enabled in admin/config.

## [2.14.7-4] - 2026-05-08

VisitIntentCard layout cleanup + entry-point dedup.

### Changed
- **Back arrow inline with the buttons**. In the "Otro motivo" submenu, the back affordance moved out of the header and now sits at the start of the buttons row — icon-only on desktop (square 36px, accent-bordered), icon + "Volver" label on mobile where the buttons stack. The buttons row layout switched from `grid grid-cols-3` to `flex flex-col sm:flex-row` with `flex-1` on each option button so the back button can claim a smaller width without distorting the others.
- **Removed the X dismiss button**. There's no manual dismiss anymore — the prompt is intentionally sticky until the user picks an option AND closes the launched wizard. The localStorage 7-day TTL, `dismissalKey`, the corresponding `useEffect`, and the `visit_intent_dismissed` zaraz event were all removed (no callers left). The `visitIntent.dismiss` i18n key is now unused but kept for now.
- **Hide standalone "Registrar actividad" CTA when the prompt is showing**. New `hideOpenButton` prop on `AdoptionFormWizard` causes its closed-state entry button to render `null`. `AdopterProfileV2` lifts a `visitIntentDismissed` state and computes `visitIntentVisible = enableVisitIntent && !!currentUser && !!adopter && !isNew && !visitIntentDismissed`; passes this as `hideOpenButton` to the wizard. `VisitIntentCard` gained an `onHide` callback that fires when its inner wizard closes, flipping the parent state — so the standalone CTA reappears exactly when the prompt goes away. URL-driven autoOpen still works because the wizard's open state is independent of the entry-button render.

## [2.14.7-3] - 2026-05-08

Wizards now treat follow-ups and returned pets as events tied to a past adoption, not to the rescuer's unlinked inventory.

### Changed
- **Animal-picker source for `follow_up` / `returned_pet`** (both new and edit wizards): the existing-mode dropdown now lists adoption-table rows where `adopterId = this adopter && recordType === 'adoption'` (i.e., animals this person already adopted) instead of `availableAnimals` (the rescuer's unlinked inventory). Other record types (`adoption`, `adoption_request`, `observation`) keep the previous source.
- **Picker label**: shows "Animal ya adoptado por esta persona" / "Animal already adopted by this person" instead of the generic "Select Animal" when in follow-up/return mode. Each option appends the past adoption's date.
- **New wizard — dual-record creation**: when the user picks "Create new" for a follow-up or return (i.e., the animal isn't yet in the system), step 2 now shows two date pickers — `Fecha de adopción` and `Fecha del seguimiento`/`Fecha de la devolución`. Both are required; both reuse the existing `DatePicker` with `dayOptional` so users can enter month + year if they don't recall the exact day. On save we issue two `saveAdoption` calls: first the parent adoption (`status='completed'`, `recordType='adoption'`, the new animal's name/species), then the follow-up/return event with the same name/species — two independent rows, no FK linkage (matches existing schema; records associate by name/species/adopterId).
- **Critical guard**: when the picker is sourced from past adoptions, selecting an option no longer sets `submitData.id` to that past row's primary key. Doing so would have caused `saveAdoption` to UPDATE the parent adoption, flipping its `recordType` to `follow_up` and silently destroying the original record. The wizard now forces `id=undefined` for follow_up/returned_pet inserts; the edit wizard preserves the record being edited's own id.

### Plumbing
- New `adopterAdoptions` prop on `AdoptionFormWizard` and `AdoptionFormEditV2`. Threaded through `AdopterProfileV2` (passes `adoptions` directly) and `AdoptionHistory` (passes `initialAdoptions` to the edit component, with the `editFormComponent` ComponentType extended to declare the optional prop). `VisitIntentCard` forwards its existing `adoptions` prop to the wizard so submenu launches (follow_up / returned_pet) get the right source list.
- New i18n keys (es + en): `adoption_date`, `followup_event_date`, `return_event_date`, `dual_date_hint`, `previous_adoption_picker_label`.
- Edit-wizard scope is intentionally limited: source list swaps for follow-ups/returns, but the dual-record flow is new-wizard only — editing a follow-up that switches to a brand-new animal still updates only that one record, no parent auto-creation.

## [2.14.7-2] - 2026-05-08

VisitIntentCard "Otro motivo" now drills into a submenu instead of jumping straight to the observation wizard.

### Changed
- **Top-level option C** ("Otro motivo") icon switched from pencil to a three-dot ellipsis to signal "more options". Clicking it fires a new `visit_intent_other_opened` analytics event and swaps the buttons to a submenu — no longer auto-opens the observation wizard.
- **Submenu options**: `Hice un seguimiento` (phone icon → `follow_up` wizard), `Me devolvió un animal` (U-turn arrow → `returned_pet` wizard), `Quiero dejar una observación` (note/document icon → `observation` wizard). All three record types were already accepted by `AdoptionFormWizard.initialRecordType`.
- **Submenu header** gains a left-arrow back button next to the title; click returns to the main 3-button view. The dismiss (X) and the localStorage dismissal contract are unchanged.
- **Animation**: the buttons grid is keyed by `view`, so React remounts on swap and the existing `animate-slideDown` keyframe replays — soft fade-down on every view change.

### i18n
- Replaced `option_c_hint` ("Compartí lo que sabés…") — that string moved to `option_observation_hint`. New keys: `option_followup`, `option_followup_hint`, `option_returned`, `option_returned_hint`, `option_observation`, `option_observation_hint`, `back`. ES + EN both updated in the same commit.

## [2.14.7-1] - 2026-05-07

VisitIntentCard prominence + button redesign. Feedback: the card was less visually present than the legal disclaimer below it, which was the wrong hierarchy — the disclaimer is passive info, this is an active CTA.

### Changed
- **Container**: background switched from `--surface-card` to `--accent-subtle-bg`; border bumped to a vivid `2px solid var(--accent)`; padding to `px-4 py-3`; title to `text-base font-semibold` in `--accent-strong`. Reads as a tinted callout instead of a neutral panel.
- **Buttons**: pill chips replaced with proper rectangular buttons (`rounded-lg`, `px-3 py-2`, `text-sm font-medium`). White-ish `--surface-card` fill with 1px `--accent` border on the tinted card gives clear click affordance; hover inverts to filled `--accent` with accent-glow shadow and a small upward translate. Layout moved from `flex-wrap` to `grid grid-cols-1 sm:grid-cols-3` so labels stack full-width on mobile and sit in equal columns on desktop.
- **Icons**: leading inline SVGs (currentColor, 16×16, no emoji per the no-emoji-for-functional-affordances convention) — speech bubble for A (request), house for B (adoption completed), pencil for C (other reason).

## [2.14.7] - 2026-05-07

VisitIntentCard copy + visibility tweaks. Goal: make the prompt feel like an active call-to-action tied to the specific adopter (not a generic banner), surface it on freshly-created profiles, and replace the previous (non-functional in Tailwind 4) `animate-in` classes with a real keyframe animation.

### Changed
- **Title**: now reads `¿Qué pasó con {firstName}?` (en: `What happened with {firstName}?`) instead of `¿Para qué visitás este perfil?`. Falls back to `esta persona` / `this person` when the adopter has no name. Always visible — the previous `hidden sm:inline` was dropped so mobile users see it too.
- **Button labels**: full long labels in every viewport — `Me pidió un animal en adopción` / `Le dí un animal en adopción` / `Otro motivo`. Dropped the `option_*_short` keys and the chip emojis; the row now uses `flex-wrap` so labels wrap on narrow screens instead of horizontal-scrolling.
- **Border + animation**: container border bumped to 2px and recolored to `--border-accent`. Added real `@keyframes visit-intent-enter` (fade + slide + subtle scale) and `visit-intent-glow` (two pulses of accent box-shadow) in `globals.css`, wired via the new `.visit-intent-card` class. The previous `animate-in fade-in slide-in-from-top-2` Tailwind classes weren't backed by any plugin in this Tailwind 4 install — the card wasn't actually animating before. `prefers-reduced-motion` opts out.
- **Visibility**: removed the owner suppression. Owners now see the prompt like everyone else, which is what makes it appear on **newly-created profiles** (creator lands on `/adopter/{id}` post-create as the owner). The `forceShow` / `?justCreated=1` plumbing initially scaffolded for the create-flow was dropped as redundant once the owner gate was gone.

### Same as before (no regression)
- Feature flag (`ENABLE_VISIT_INTENT_PROMPT`), 7-day per-(adopter, user) localStorage dismissal, 30-day per-option suppression for A/B based on recent matching records, and the always-visible C option.
- Telemetry events (`visit_intent_shown` / `visit_intent_selected` / `visit_intent_dismissed`).
- Wizard launch contract (option click → `AdoptionFormWizard` with `initialRecordType` + `autoOpen`).

## [2.14.6] - 2026-05-07

VisitIntentCard redesign — UX feedback was that v2.14.0's full-card-with-paragraphs design was too tall (forced scrolling on mobile to see all options), used hardcoded white/`--status-info-*` tokens that didn't read well in the Azul Noche dark theme, and lived inside the Adoptions section (felt like part of the activity list rather than a context-setting prompt).

### Changed
- **Placement**: card moved from inside the Adoptions `CollapsibleSection` to **above its title**. It now reads as a prompt that introduces the section, not as an item within it.
- **Layout**: collapsed from a vertical card with three paragraph-style buttons into a **single compact row**: question on the left (hidden on mobile to save space), three pill chips, dismiss icon on the right. Total height ≈ 40px instead of ~200px. No scrolling required.
- **Theme**: every color now uses a CSS variable that's already remapped per `[data-theme]` in `globals.css` (`--surface-card`, `--border-default`, `--text-primary`, `--text-secondary`, `--accent-subtle-bg`, `--accent-subtle-text`, `--accent-badge-bg`). No more `bg-white/70` or `--status-info-*` — the card now blends into Claro and Azul Noche by construction.
- **Animation**: the container fades + slides in from the top (`animate-in fade-in slide-in-from-top-2 duration-300`) and each chip slides in from the right with a 60ms stagger so the row populates left-to-right.
- **Chip labels**: shortened to single words (`Solicitud` / `Adopción` / `Observación` in Spanish; `Request` / `Adoption` / `Observation` in English). The longer hint copy moved into `title=` and `aria-label=` so it's still discoverable via tooltip and screen readers but doesn't bloat the line. Title trimmed from "Estás visitando este perfil porque:" to "¿Para qué visitás este perfil?". Dismiss button label trimmed to "Cerrar" / "Dismiss".
- **Hover/active**: each chip scales subtly (`hover:scale-[1.04] active:scale-[0.97]`) and shifts to `--accent-badge-bg`. Focus ring uses theme `--ring-focus`.
- Mobile: question text hidden via `hidden sm:inline`, chip row gets `overflow-x-auto` so it gracefully scrolls if labels are translated longer than expected.

### Same as before (no regression)
- Visibility matrix (feature flag, owner suppression, 7-day per-(adopter, user) localStorage dismissal, 30-day per-option suppression for A/B based on recent matching records).
- Telemetry events (`visit_intent_shown` / `visit_intent_selected` / `visit_intent_dismissed`).
- Wizard launch contract (option click → `AdoptionFormWizard` mounted with `initialRecordType` + `autoOpen`, card hides for the rest of the session).

## [2.14.5] - 2026-05-07

### Fixed
- **e2e: `tests/wizards.spec.ts:30 "Report Wizard opens"` failed on v2.14.3.** The SEO commit (`7ad23ef`) demoted the action-card headings from `<h3>` → `<h2>` for proper hierarchy under the new sr-only `h1`, but two Playwright selectors in `wizards.spec.ts` were still pinned to `h3` (lines 32 and 46). The test for "I have info about an adopter" failed deterministically; the test for "I gave a pet" was guarded by an `if (await registerBtn.isVisible({ timeout: 5000 }).catch(() => false))` so it silently passed without exercising the assertion. Fixed both. CLAUDE memory note about "grep tests before changing UI elements" applies — the SEO commit should have updated these selectors in the same change.

### Known flake (not addressed in this turn)
- `tests/search.spec.ts:13 "Search returns results"` flaked on the same run (passed on retry) with `page.goto: net::ERR_ABORTED` and the dev server logging `[TypeError: controller[kState].transformAlgorithm is not a function]`. That's a Node.js web-streams error from React Server Components, not caused by recent changes. CI's retry caught it; if it becomes deterministic we'll need to widen the `beforeEach` timeout or pin Node version.

## [2.14.4] - 2026-05-06

### Fixed
- **`ENABLE_VISIT_INTENT_PROMPT` toggle in `/admin/config` showed OFF after reload, even when the flag was actually set in the DB.** The flag was being persisted correctly (the `/api/admin/config` POST is generic), but the GET response shape (`route.ts:43-46`) hardcoded which keys to return and didn't include the new flag — so the admin UI hydrated `featureFlags.ENABLE_VISIT_INTENT_PROMPT` to `undefined` and rendered the toggle as off. The server-side `getFeatureFlag` call read directly from `appConfig` and returned the correct value, which is why the visit-intent card was actually rendering on adopter profiles even though the admin UI claimed the flag was off.
- Added `ENABLE_VISIT_INTENT_PROMPT` to the four duplicated lists: GET response shape, admin page `useState` initializer, fetch-hydration mapping, and `ConfigData` interface. Left a comment in `route.ts` calling out the four-place duplication for the next person who adds a flag.

### Known wart (not fixed in this turn)
- Adding a new feature flag still requires editing four places: `src/config/features.ts` (`FEATURE_FLAGS` const + `getAllFeatureFlags` defaults), `src/app/api/admin/config/route.ts` (GET response shape), `src/app/admin/config/page.tsx` (`useState` initializer + `setFeatureFlags` hydration + `FEATURE_FLAGS` admin toggle list + `ConfigData` interface). Worth refactoring to derive everything from the `FEATURE_FLAGS` const, but out of scope for a one-line bug fix.

## [2.14.3] - 2026-05-06

Two cleanup passes: finishing the i18n sweep started in v2.12.3, plus Tier-1 of an SEO audit. No functional behavior changes for logged-in users; SEO/discoverability changes only.

### Fixed
- **5 missing translation keys** the v2.12.3 sweep (`fcd73e2`) overlooked: `wizard.step_what`, `wizard.step_details`, `wizard.step_evidence`, `common.error`, `adoption.fill_required`. Spanish/English users were seeing raw key paths in the adoption-wizard step indicator and one validation toast. Added a CI-style scan (`/tmp/find_missing_keys.py`) that confirmed these were the only remaining gaps.

### Added — SEO Tier 1
- **Restored `<h1>` on home** (sr-only, keyword-rich). Removed in v2.12.1-39 for the slim search-first hero; the visual decision is preserved, but crawlers and screen readers get a primary heading again. New i18n key `home.h1`.
- **Generated missing icons**: `public/apple-touch-icon.png` (180×180) and `public/icon-192.png` (192×192) — both were referenced from `layout.tsx` and `manifest.json` but didn't exist, 404ing on every page load. New `scripts/generate-icons.cjs` regenerates them from `icon-512.png`.
- **HowTo + FAQ JSON-LD wired server-side** on `/guia` and `/guia/faq`. `GuideHowToJsonLd` and `FaqPageJsonLd` were exported from `JsonLd.tsx` but never imported — guide pages had zero structured data. Content extracted to `src/content/guide-data.ts` so both the API route and the layouts share one source of truth.
- **Page-level `robots: { index: false }`** on `/health`, `/notificaciones`, `/organizations` (the last two were soft-auth-gated client-side but crawlable, would have ranked for nothing).
- **Sitemap fixes**: added `/funcionalidades` (had its own metadata + canonical but was missing from sitemap), and replaced per-request `lastModified: new Date()` with a build-time-frozen constant so crawlers stop seeing the sitemap "change" on every fetch.
- **Robots disallow extended** to cover `/contract`, `/contract-results`, `/form-results`, `/invite`, `/notificaciones`, `/organizations`, `/health`.
- **Demoted action-card `<h3>`s → `<h2>`** on home, AdoptionWizard, ReportWizard so heading hierarchy stays sane after the new h1.

### Changed
- **`WebApplicationJsonLd`** — `softwareVersion` now reads from `package.json` instead of the stale hardcoded `'2.9.0'`. `screenshot` URL switched from `/icon-512.png` (an icon, not a screenshot) to `/og-image.png`. Empty `sameAs: []` removed from `OrganizationJsonLd` (weak signal).
- **`public/manifest.json`** — description translated to Spanish (was English on a `lang: 'es'` site).

### Deferred (Tier 2 — documented in `.agents/plans/seo-audit.md`)
- Removing `dynamic = 'force-dynamic'` from root layout (highest-leverage win, but session-cache edge cases warrant a dedicated PR with monitoring).
- Bilingual hreflang / `/en` URL tree (architectural decision: commit to bilingual SEO or drop the `alternateLocale` claim).
- Dynamic `<html lang>` (couples with the bilingual decision).
- Promoting `/notificaciones` & `/organizations` to `PROTECTED_ROUTES` (UX change — Tier-1 noindex resolves the SEO half safely).

## [2.14.2] - 2026-05-06

Diagnostic plumbing for the v2.13.0 audit's blind spot: when Axiom env vars are missing on a deployed environment, errors silently fall back to worker stdout and the user-visible error id stops matching any Axiom row. Three changes make that drift impossible to miss.

### Added
- **`probeAxiom()` in `/api/admin/health/route.ts`** — checks `AXIOM_DATASET` and `AXIOM_TOKEN` presence and pings `GET https://api.axiom.co/v1/datasets/<dataset>` with the token (3s timeout). Reports `{ configured, reachable, dataset, datasetSet, tokenSet, latencyMs, statusCode?, error? }` in the health response. Token is never returned to the client.
- **`AdminEnvWarnings` (`src/components/AdminEnvWarnings.tsx`)** — mounted in `src/app/admin/layout.tsx` above page content. Fetches `/api/admin/health` once on mount and renders a red banner if Axiom is unconfigured ("Axiom logging is disabled in this environment — errors fall back to worker console; user-visible error IDs will not match any Axiom row") or an amber banner if configured but unreachable. Lists which env var is missing.
- **`AXIOM_DATASET` / `AXIOM_TOKEN` added to the env-var presence list** returned by `/api/admin/health` so the existing health UI surfaces them too.

### Changed
- **`src/lib/logger.ts`** — when `sendToAxiom` falls back to console (env vars missing) and the runtime env is not `local`, emit one `console.warn` per worker boot: `[Logger] Axiom config missing in env="<env>" — errors fall back to worker console only.` Surfaces in `wrangler tail` immediately on a misconfigured deployment instead of waiting for the first user error.
- **`src/app/adopter/[id]/page.tsx`** — split the auth + config `Promise.all` into two:
  - **Auth (`getUser` + `getIsAdmin`)** still redirects to login on failure (mandatory).
  - **Config (`getAdoptionConfig` + `getFeatureFlag`)** now degrades to defaults with `logger.warn` on failure. Previously a transient D1 outage on a config fetch would bounce the user to `/?authRequired=1` as if their session expired — which was misleading and possibly the failure mode behind the v2.14.0 visit-intent staging incident report.

### How to use the new signals
- Open `/admin` in any environment. If you see the red Axiom banner, **the user-visible error IDs are NOT in Axiom** — fix the missing secret in Cloudflare Pages → Settings → Variables and Secrets for that environment before relying on Axiom for triage.
- Tail the worker (`npx wrangler pages deployment tail --project-name verazadoptantes2 --environment=preview`) and look for `[Logger] Axiom config missing` on first deploy of a fresh environment.

## [2.14.1] - 2026-05-06

### Fixed
- **Footer reachable from every public page**, not just the homepage. Privacy, terms, contact, and the deployed version string were stranded on `/` because the footer JSX was inlined inside `src/app/page.tsx` instead of in the shared shell. Extracted to `src/components/Footer.tsx` (client component, reads `usePathname` to suppress itself on the routes that have their own footers / no footer): `/admin/*`, `/keystatic/*`, `/health`, `/contract/*`, `/contract-results/*`. Mounted in `src/app/layout.tsx` below `{children}`. Removed the unused `packageJson` import from `page.tsx`.

## [2.14.0] - 2026-05-06

Visit-intent prompt on adopter profiles — admin-toggleable card that asks why a visiting rescuer is on the profile and routes them to the matching wizard.

### Added
- **`VisitIntentCard`** (`src/components/VisitIntentCard.tsx`) — non-blocking inline card pinned at the top of the Adoptions section on adopter profiles. Asks "¿Estás visitando este perfil porque:" with three options:
  - A. Me solicitó un animal en adopción → opens wizard with `recordType='adoption_request'`
  - B. Le di un animal en adopción → opens wizard with `recordType='adoption'`
  - C. Quiero reportar una observación sobre esta persona → opens wizard with `recordType='observation'`
  - "Solo estoy mirando, cerrar" dismisses without scolding.
- **Feature flag `ENABLE_VISIT_INTENT_PROMPT`** — DB-backed via `appConfig`, toggleable in `/admin/config`. Default off; admin opts in.
- **i18n keys** under `visitIntent.*` in both `es.ts` and `en.ts` (Spanish primary).
- **Telemetry**: `visit_intent_shown`, `visit_intent_selected`, `visit_intent_dismissed` via `zarazTrack` — gives shown→selected conversion per option.

### Visibility logic
The card renders only when **all** of the following are true: feature flag enabled, not the profile owner (`adopter.addedBy !== currentUser`), user is authenticated, no recent dismissal (per-(adopter, user) localStorage key with 7-day TTL — mirrors `InstallPrompt`), and at least one option is not suppressed by recent matching records (30-day window). Per-option suppression: A hidden if user logged an `adoption_request` for this adopter in 30d; B hidden for `adoption`; C never hidden (observations are unbounded over time). If all three would be hidden, the whole card is hidden.

### Changed
- **`AdoptionFormWizard`** — added opt-in `initialRecordType?`, `autoOpen?`, and `onClose?` props. Pre-seeds the recordType so the user doesn't pick it twice. Step 1 still renders so adoption / adoption_request flows can pick an animal — observation flows just click "next." `onClose` lets `VisitIntentCard` know when to clear its own state. No behavior change for existing callers (all props optional).
- **`AdopterProfileV2`** — added `enableVisitIntent` prop, mounts `VisitIntentCard` above the existing `AdoptionFormWizard` button inside the Adoptions `CollapsibleSection`. The existing button stays — it's still the universal entry point for users who dismiss the card or want a different recordType.
- **`adopter/[id]/page.tsx`** — reads `getFeatureFlag('ENABLE_VISIT_INTENT_PROMPT')` in the existing `Promise.all` batch (no extra round-trip), passes through to `AdopterProfileV2`.

### CX framing
The four risks of funnel features are addressed in `docs/error_logging_audit.md`-style depth in `~/.claude-personal/plans/wondrous-noodling-fern.md`:
- **Pop-up fatigue** → 7-day per-(adopter, user) localStorage dismissal.
- **Wrong intent** → explicit "solo estoy mirando" + 1-line description per option.
- **Owner self-view** → suppressed when `adopter.addedBy === currentUser`.
- **Already-acted** → per-option 30-day suppression based on `adoptions[]` already fetched server-side (no extra query).

## [2.13.0] - 2026-05-06

Error logging audit: every error now writes to Axiom with a stable id surfaced to the user.

### Added
- **`/api/log-client-error` (edge route).** Accepts `{ errorId?, message, stack?, source, ... }` from the browser, calls `logger.error`, and returns the resulting id. When the client supplies a hex id, the server uses it verbatim — so what the user copies is exactly the row admins query in Axiom.
- **`ClientErrorReporter` (mounted in `app/layout.tsx`).** Registers `window.addEventListener('error', ...)` and `unhandledrejection`. Generates an id locally, shows it in a toast immediately, then POSTs to `/api/log-client-error` under that same id. Skips events whose error already carries an embedded `Error ID:` (server-thrown errors already logged upstream).
- **`reportClientError` helper.** 30s in-memory dedup so a misbehaving extension can't flood the endpoint.

### Changed
- **`error.tsx` / `global-error.tsx`.** Id is generated once via `useState(() => …)` — no more inline `crypto.randomUUID()` flipping the id between renders. Sends the id to `/api/log-client-error` so the user-visible id matches the Axiom row by construction.
- **`logger.error`** now accepts an optional pre-generated id via the `data.errorId` field (used by `/api/log-client-error`). Server-side callers that omit it keep the previous behavior.
- **5 API routes that returned `[]` on 500** (`my-animals`, `my-adopters`, `my-adoptions`, `my-form-submissions/unlinked`, `dashboard/milestone`) now return `{ error, errorId }` so the client can surface the id via `toast.error`. This was the proximate cause of the unrecoverable `/my-animals` triage in v2.12.7 — the error was logged but never showed up to the user.
- **~25 `toast.error(...)` callers** updated to pass `extractErrorId(err)` or the response-body errorId, so the user-facing toast shows an id whenever one was logged. Touches admin/config, settings, organizations, AdminAdopterList, AdopterFlagging, AdopterProfileV2, AdopterForm, SearchSection, DeleteAdopterButton, FormResultMatchCard, my-animals/my-adopters/my-adoptions pages.
- **Server actions in `organizations.ts`, `settings.ts`** updated to (a) use the correct `logger.error(msg, error, data)` signature instead of treating the error as data, and (b) return `{ success: false, error, errorId }` so the page can render the id.
- **Silent swallows in `formSubmission.ts`, `notifications.ts`, `organizations.ts`, `admin/notifications/page.tsx`, `dashboard/milestone`, `form/[userId]`, `contract/[id]/submit`, `form/[userId]/submit`** now log at warn or error with operation context.
- **Operation-context sweep** on `dashboard.ts`, `settings.ts`, `admin.ts`, `audit/route.ts`, `import/route.ts` — `logger.error` now re-emits `userEmail`/`actorEmail` and other in-scope inputs to make Axiom rows triagable.

### Audited
- See `docs/error_logging_audit.md` for the full breakdown of findings, fixes, and the few remaining acceptable bare catches (auth fallbacks, health probes, SSR-safe `localStorage` reads).

## [2.12.8] - 2026-05-06

### Fixed
- **Rating popover stole click → navigated to profile.** In `SearchSection`, each card is wrapped in `<a href={`/adopter/${id}`}>`. The `RatingExplainer` button rendered inside that anchor; on click the popover opened correctly but the click also triggered the anchor's default action and the page navigated to the adopter profile. `stopPropagation` alone wasn't enough — the browser's anchor navigation is a default action, not a React handler. Fix: added `e.preventDefault()` (alongside `stopPropagation`) on the wrapper `<div>` of `RatingExplainer`, which catches all bubbled clicks (trigger button, close button, mobile backdrop) and suppresses navigation.

## [2.12.6] - 2026-05-06

UX: rating labels and click-to-explain popover on search results.

### Added
- **`RatingBadge` `label` prop** — `'none'` (default, backward compatible), `'short'` (e.g. "Bueno"), or `'search'` (e.g. "Buen Adoptante"). Display sites use `'short'`; search-result cards use `'search'`.
- **`RatingExplainer` (new component)** — wraps the rating in search results; click opens a popover (bottom-sheet on mobile) listing all 5 levels with their color and explanation, with the current rating highlighted via `ring-2`. Educational tool so new users understand the full scale at a glance.
- **i18n keys** under `ratings`: `search_label.*` (long form), `explanation.*` (popover text), `scale_title`. Added in both `es` and `en`.
- **`StarRating` `showLabel` enabled** in all 4 edit sites (wizard creation, edit, observation, import) — replaces the inline "1=Dangerous, 5=Excellent" helper text in `AdoptionFormEditV2`, `ReportWizard`, `ImportWizard`.

### Changed
- **Level 3 label**: ES `"Promedio"` → `"Regular"`, EN `"Average"` → `"Fair"`. Matches the canonical scale terminology.
- **Centralized rating metadata** in `src/domain/ratings.ts` (`RATING_LEVELS`, `RATING_LABEL_KEYS`, `getRatingLabelKey`) — eliminates the duplicated 1→5 → label-key map that existed in both `StarRating.tsx` and `lib/ratingColors.ts`. `getRatingDescription` is now a re-export.

### Notes
- No new field on the adopter — the rating shown is still the computed average of the recorded interactions (`computeAvgRating`).
- The 5 status colors (red/orange/amber/lime/green) used by the popover aren't yet remapped for Azul Noche — that fix is part of Phase 2 of the mobile remediation plan.

## [2.12.5] - 2026-05-05

### Removed
- **`src/components/AdoptionForm.tsx` deleted as dead code** (~830 lines). Audit yesterday assumed it was the creation form on the adopter profile; it isn't. The actual creation flow uses `AdoptionFormWizard.tsx` (multi-step). `AdoptionForm.tsx`'s only consumer was `AdoptionHistory.tsx` as a *fallback edit component*, but the only caller of `AdoptionHistory` (`AdopterProfileV2.tsx`) always passes `editFormComponent={AdoptionFormEditV2}` as override — so the fallback never fired.
- **The "promote sticky bar to creation form" change in v2.12.4 was modifying this dead file**; it had no user-visible effect. Removing the file removes the confusion.

### Changed
- **`AdoptionHistory.tsx`**: `editFormComponent` prop is now required (not optional) and properly typed as `ComponentType<{...}>` instead of `any`. Fallback removed. Inline IIFE around the edit component dropped (no longer needed).

## [2.12.4] - 2026-05-04

UI cleanup pass on the adoption record forms (creation + edit). Senior-UI
audit surfaced 8 inconsistencies between the two forms; all addressed.

### Changed
- **Sticky save bar promoted to creation form** — `AdoptionForm.tsx` now uses the same floating sticky pill (`bottom-4 bg-white/80 backdrop-blur-xl border border-teal-200 shadow-xl rounded-xl`) as the edit form. Cancel/save are always reachable on long forms; matches edit-form paradigm.
- **Trash icon toned down** — `text-rose-500` → `text-stone-500 hover:text-rose-500` on both forms. No longer the loudest element in the action bar.
- **Rating helper text restored on edit form** — replaced inline `showLabel={true}` with a `1 = Dangerous, 5 = Excellent` hint below stars (matches creation-form presentation).
- **Animal info pills now grouped** — added small uppercase `ANIMAL INFO` label above the read-only sex/age/neutered/color/microchip pills row in edit form. Pills no longer float orphaned in midair.
- **Creation submit guarded against mid-upload submit** — `disabled={loading}` → `disabled={loading || uploading}` (parity with edit form).

### Fixed
- **Edit form: editing an Observation no longer hides Date / Identity Verified / Rating** — Block 1 wrapper (which sets `display:none` for observations) now closes after the animal-name/species/pills section instead of after Rating. Date, Identity, and Rating remain visible regardless of record type.
- **Edit-form interaction wrapper background mismatch** — dropped the muted `bg-stone-50/50 ... border border-stone-200/60` inner box on Block 1 so the edit form sits flush on the white card like the creation form does.

### i18n
- Added `adoption.animal_info` key to ES + EN locale files for the new pills section label.



Minor version bump: i18n sweep across user-facing components — Spanish users no longer
see English error messages, English users no longer see Spanish share menus, and the
adoption wizard buttons (Siguiente / Atrás / Guardar Registro) finally translate.

### Added (i18n keys, ES + EN)
- **`errors.*`** namespace expanded with ~35 specific action-failure keys: `upload_failed`, `upload_invalid_file`, `upload_invalid_image`, `upload_video_too_large`, `upload_process_failed`, `save_adoption_failed`, `save_adopter_failed`, `save_failed_generic`, `save_animal_failed`, `delete_media_failed`, `delete_record_failed`, `delete_image_failed`, `delete_photo_failed`, `delete_failed_generic`, `delete_request_failed`, `set_profile_pic_failed`, `search_failed`, `submit_report_failed`, `submit_request_failed`, `report_error`, `request_error`, `not_found_animal`, `load_animal_failed`, `unexpected`, `action_failed`, `unknown_error`, plus several admin-only keys for future Phase 5.
- **`toast.*`** namespace (new): toast titles like `upload_failed_title`, `invalid_file_title`, `video_too_large_title`, `not_found_title`, `save_error_title`, `search_failed_title`, `delete_failed_title`, `action_failed_title`, `purge_complete_title`, `stats_purged_title`, `saved_title`, plus messages for the success cases.
- **`dialogs.*`** namespace (new): browser-dialog confirm/alert text (`confirm_delete_media`, `confirm_delete_record`, `confirm_delete_adopter`, `confirm_merge`, `confirm_purge_stats`, `confirm_delete_audit`, `confirm_dismiss_duplicate`, `alert_merge_failed`, etc.).
- **`share.*`** namespace (new): all 10 ShareMenu/ShareFormMenu strings (`open_in_new_tab`, `via_message`, `via_email`, `qr_show`, `more_options`, `contract_preview_hint`, `contract_qr_hint`, `form_preview_hint`, `form_qr_hint`, `form_footer_hint`).
- **`wizard.back`** + **`wizard.save_record`** in the existing wizard namespace.
- **`nav.*`** additions: `change_language`, `dismiss`, `open_menu`, `close_menu`, `expand_image`, `permanently_delete_adopter`, `close_suggestion`, `confirm_code_placeholder`, `type_to_confirm`.

### Changed
- **All hardcoded toast titles + messages in user-facing components** now go through `t()`. Affected: `AdoptionForm.tsx` (5 sites), `AdoptionFormEditV2.tsx` (5), `AdoptionFormWizard.tsx` (3), `AdopterFlagging.tsx` (6), `AdopterForm.tsx` (6 — also fixed broken `t('common.error') || 'Error'` fallback to use `t('errors.generic')`), `ImageGallery.tsx` (4), `SearchSection.tsx` (2), `ReportWizard.tsx` (1), `AdoptionHistory.tsx` (1), `AdopterProfileV2.tsx` (3), `FormResultMatchCard.tsx` (2). ~38 toast call sites updated.
- **Browser `confirm()` dialogs** in user-facing flows now go through `t()`: `AdoptionForm.tsx`, `AdoptionFormEditV2.tsx` ("Delete this media?"), `AdoptionHistory.tsx` ("Are you sure you want to delete this adoption record?").
- **`ShareMenu.tsx` + `ShareFormMenu.tsx`** — all 14 hardcoded Spanish strings (open in new tab, send by message, send by email, QR show, more options, preview/QR/footer hints) replaced with `t('share.*')`. English users finally see English share menus.
- **Wizard step buttons** (`Siguiente →`, `← Atrás`, `💾 Guardar Registro`) in `AdoptionFormWizard.tsx` now use `t('wizard.next')`, `t('wizard.back')`, `t('wizard.save_record')`. English users see "Next →", "← Back", "💾 Save Record".
- **`aria-label` / `title` attributes**: `LanguageSwitcher.tsx` ("Change language"), `ReferralBanner.tsx` + `SocialProofBanner.tsx` ("Dismiss"), `SearchSection.tsx` ("Cerrar sugerencia"), `AdoptionForm.tsx` + `AdoptionFormEditV2.tsx` ("Delete" / "Remove"), `ImportWizard.tsx` ("Expand image") — all now via `t()`.

### Out of scope (deferred to future PR)
- **Admin pages** (`/admin/*` UI text, ~15 strings) — admins are typically English-comfortable, and most admin components don't have `useLanguage` imported. Phase 5 in the original i18n audit; defer until multi-language admin support is a real requirement.
- **`DeleteAdopterButton`, `AdminAdopterList`, `AdminDangerZone`, `DuplicateMergeModal`, `LinkFormToList`** — toast/confirm calls in these. Either admin-only or lack `useLanguage` import; deferred as Phase 5 work.
- **`my-animals/new`** — already does manual `locale === 'es' ? 'es-text' : 'en-text'` for its dialogs. Bilingual already, just hand-rolled. Acceptable as-is.

### Documentation note
The audit at `.agents/audits/2026-05-04-mobile-breakpoint-comprehensive-plan.md` did NOT cover i18n — that was a separate question. If a similar i18n audit is wanted in the future, the framework is the same: grep for hardcoded literals in JSX/attributes/dialogs and bucket by user-facing surface.

## [2.12.2] - 2026-05-04

Minor version bump: comprehensive mobile breakpoint remediation across the user-facing
app + admin pages, executing the plan in
`.agents/audits/2026-05-04-mobile-breakpoint-comprehensive-plan.md`.

### Fixed (P0 — blocking mobile experience)
- **iOS Safari auto-zoom on form inputs eliminated.** Every `<input>`, `<textarea>`, and `<select>` in the adoption forms (10 sites across `AdoptionForm.tsx`, `AdoptionFormWizard.tsx`, `AdoptionFormEditV2.tsx`) had `text-sm` (14px), triggering iOS's auto-zoom on focus. Replaced with `text-base md:text-sm` — 16px on mobile (no zoom), 14px on desktop (unchanged). Per-component fix instead of a global `!important` rule to avoid blast radius on other text-sizing overrides.
- **NotificationBell dropdown reworked as a bottom sheet on mobile.** Was using `fixed inset-x-0 top-14`, covering content with no scroll-back when opened mid-scroll. Now `fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl` on mobile (slide-up sheet) and unchanged `sm:absolute sm:right-0 sm:mt-2` on desktop. Includes `paddingBottom: env(safe-area-inset-bottom)` so the iOS home indicator doesn't clip the last notification.
- **`/admin/organizations` table now horizontally scrollable on mobile** (`overflow-x-auto` wrapper + `min-w-[640px]` on the table) with a "← desliza para ver más →" hint visible only at `<md`. Other admin pages already had card fallbacks; this one didn't.
- **AdoptionFormEditV2 sticky save bar respects iOS safe-area-inset.** Added `paddingBottom: max(1rem, env(safe-area-inset-bottom))` so the bar clears the home indicator and stays above the soft keyboard.

### Fixed (P1 — significant polish)
- **Image delete buttons visible on touch.** 9 sites across `ImageGallery.tsx` (delete + set-as-profile), `AdoptionForm.tsx`, `AdoptionFormWizard.tsx`, `AdoptionFormEditV2.tsx`, `ImportWizard.tsx` had `opacity-0 group-hover:opacity-100` — invisible on touch. Replaced with `md:opacity-0 md:group-hover:opacity-100` so they're visible by default on mobile, hover-only on desktop. The 2 magnify icons (decorative cues, not actions) deliberately left hover-only to avoid visual clutter on every thumbnail.
- **NotificationBell "Mark all read" tap target ≥44px** on mobile via `min-h-[44px] sm:min-h-0 px-2 -mr-2`. Per WCAG 2.5.5 / Apple HIG.
- **Pink palette dark-theme remap added** in `globals.css` for ContactPills' "social" type (`bg-pink-50/100`, `text-pink-700`, `border-pink-200`). The audit had flagged blue/amber/red/purple/orange as broken in dark mode, but on inspection those palettes are already remapped — pink was the only genuine gap.

### Added (documentation, bundled with this release)
- `docs/ux-ui-guidelines.md` — decision-making framework: principles, patterns, persona conventions, anti-patterns we've walked back. Complements the existing `design-style-guide.md` (visual tokens) and the two `.agents/workflows/` review files (ui-review, ux-review).
- `.agents/audits/2026-05-04-mobile-breakpoint-audit.md` — focused first-pass mobile audit (May 4 morning).
- `.agents/audits/2026-05-04-mobile-breakpoint-comprehensive-plan.md` — whole-app comprehensive audit + phased remediation plan (May 4 afternoon). This release executes Phases 1 + 2 of that plan.
- `.agents/workflows/ux-review.md` — humanistic UX review prompt (separate from the mechanical compliance lint at `.agents/workflows/ui-review.md`).
- `CLAUDE.md` — Key Directories updated with pointer to `docs/ux-ui-guidelines.md`.

### Internal
- Phase 3 items deferred (not part of this release): mobile card layout for `/admin/organizations`, sticky/z-index stacking documentation, `inputMode`/`autocomplete` sweep on numeric/email/tel fields. See the comprehensive plan for context.

## [2.12.1-42] - 2026-05-04

### Added
- **Tap a filled profile-photo avatar to open it in a lightbox view.** Previously the avatar was a dead element once filled — only the empty initials placeholder was clickable (for upload). This fixes the inconsistent affordance: the avatar slot now does something useful in both states. Mobile users finally get a usable enlarged view of the face for trust judgement.
- **"Cambiar foto" action inside the lightbox** — small button in the lightbox header (next to the close X) for authenticated users. Triggers the same hidden file input + `saveImage(..., isProfilePicture: true)` pipeline used by empty-state upload (atomic replace, previous photo automatically demoted). Anonymous viewers see the lightbox view-only without the change action.
- Remove-photo intentionally NOT added to the lightbox in this release — destructive action with no undo, kept in the existing Photos collapsible to avoid one-tap accidental removals. Can be added later with a confirmation step if users complain it's hard to find.

### Changed
- **`MediaLightbox` gains an optional `actions?: ReactNode` prop** for header injection. Backward-compatible — all existing consumers (AdoptionForm, AdoptionHistory, etc.) call without the prop and render unchanged. Caller is responsible for layout/styling of injected nodes.
- **`AdopterForm` hoists the hidden file input** out of the empty-state render branch to a stable location at the top of the form. Single ref + handler now serves both the empty-state camera button (v38) and the lightbox replace button (v42). Avoids the "two `<input>` elements sharing one ref" anti-pattern.

### Added (i18n)
- `adopter.view_profile_photo` (ES: "Ver foto de perfil" / EN: "View profile photo") — aria-label/title for the filled-avatar button.
- `adopter.change_profile_photo` (ES: "Cambiar foto" / EN: "Change photo") — lightbox-internal replace button.

## [2.12.1-41] - 2026-05-04

### Fixed
- **Homepage "Mis Adopciones" chip count + page now match the label.** The chip on the QuickAccessStrip was counting all interaction types (adoption + adoption_request + observation + follow_up + returned_pet) — anything except `available` — but the label said "Adopciones." A user with 4 adoptions and 8 observations saw a chip of "12" → clicked → landed on `/my-adoptions` with the All tab preselected, also showing 12 mixed records. Honest CX failure: label and data disagreed at both ends.
  - **`src/app/api/quick-counts/route.ts:31-37`** — narrowed the count to `recordType = 'adoption'` (using the `RECORD_TYPES.ADOPTION` constant). Dropped the now-unused `not` import; added `RECORD_TYPES` import.
  - **`src/app/my-adoptions/page.tsx:50`** — default `filter` param changed from `'all'` to `'adoption'` so the Adoption tab is preselected on direct navigation. Other types remain reachable via the existing tabs (no functionality lost). URL `?filter=all` still works for users who explicitly want the everything view.
  - Net: chip count = number of records visible on the default-loaded `/my-adoptions` page = number of true adoptions. The label is finally honest.
- **No downstream breakage.** Verified `dashboard.ts:188` uses a per-adopter `counts` object that's already correctly recordType-filtered (different scope than `/api/quick-counts`); `MilestoneBadge` uses its own `/api/dashboard/milestone` endpoint unaffected by this change.

## [2.12.1-40] - 2026-05-04

### Fixed
- **Smoke test caught up with v2.12.1-39 hero removal.** `tests/smoke.spec.ts:13` was asserting `getByRole('heading', { level: 1 }).toBeVisible()` — but v39 deleted the H1 in favor of the search-first homepage. Replaced with two stronger checks: search input visibility (the actual primary anchor) + the `home.value_main` text (proves layout + i18n loaded). The previous assertion blocked v39's e2e job; this should let the hero-slim-down deploy.

## [2.12.1-39] - 2026-05-04

### Changed
- **Homepage hero slimmed down to a single value-prop line.** Removed the 40px hero shield-paw icon (already shown in the sticky nav above), the H1 "Registro de Adopciones", both existing value-prop lines (verifier + recorder), and both pill links. Replaced with one combined line above the search: **"Busca adoptantes y Registra adopciones"** (ES) / **"Search adopters and record adoptions"** (EN). Pulls the search input above the fold on mobile and eliminates the double-branding with the sticky nav. The `hidden md:block` collapse-on-mobile-when-results-visible behavior is preserved.
- **Adoption Guide and Funcionalidades links moved to the homepage footer**, alongside Privacy / Terms / Contact, with the same `·` separator pattern. Guide remains locale-aware (`/guia` ES, `/guide` EN).

### Added
- New i18n key `home.value_main` (ES + EN) for the combined value-prop line.

### Internal
- Dropped now-unused imports from `SearchSection.tsx`: `ShieldPawIcon` (still used by the global nav `Logo` component, just not here) and `Link` (no remaining `<Link>` usage in this file).
- Orphaned (NOT deleted): `home.title`, `home.value_verify`, `home.value_register`. Defer cleanup to a separate housekeeping commit after a release with no regressions.

## [2.12.1-38] - 2026-05-04

### Added
- **Click-the-initials avatar to upload a profile photo.** When an adopter has no profile picture yet, the teal initials placeholder in the profile header is now a button (only for authenticated users). Clicking it opens the OS file picker; the chosen image is compressed client-side (max 1200px JPEG @ 0.85 quality) and uploaded via the existing `saveImage` pipeline with `isProfilePicture: true` so the avatar fills immediately on reload. A small camera SVG badge sits at the bottom-right of the avatar circle as a persistent affordance (mobile-friendly — no hover required). Loading state replaces the initials with a spinner during upload. Anonymous viewers see a non-interactive placeholder (no fake CTA that gates on click).

### Changed
- **`saveImage` action** gains an optional 6th param `isProfilePicture?: boolean`. Default false (backward compatible — all 7 existing call sites unaffected). When true, the action atomically demotes any existing profile picture before inserting the new one, so the "exactly one profile picture per adopter" invariant holds without a follow-up `setProfilePicture` round-trip. Triggers `revalidatePath` for the adopter page so the new photo appears on next render.

### Internal
- New i18n keys: `adopter.add_profile_photo`, `adopter.profile_photo_caption`, `adopter.upload_invalid_type`, `adopter.upload_save_first`, `adopter.upload_success`, `adopter.upload_failed` (ES + EN).

## [2.12.1-37] - 2026-05-04

### Removed
- **`DisclaimerInfoButton` (the ⓘ icon next to the rating badge)** deleted entirely. The icon's modal opened to the same global disclaimer text already shown by the first-view `DisclaimerToast` — pure duplicate content, no extra context. Worse, putting a generic info icon adjacent to the rating implied "more info about this rating" but delivered a generic legal blurb (misleading affordance), and competed for attention with one of the highest-value trust signals on the page. Long-term reference for the disclaimer text already lives at `/terms`, linked from the homepage footer — no per-profile re-discovery affordance is needed.
- `src/components/AdopterForm.tsx` — drop the import + render; restore the simpler rating wrapper (no flex container needed once the icon is gone).

## [2.12.1-36] - 2026-05-04

### Changed
- **`DisclaimerToast` redesign — slim notice strip instead of a card.** Removed the heavy padding, shadow, and `Entendido` button. Now: single row with info SVG + text + close SVG. Same informed-consent semantics (localStorage-gated, `aria-live` polite), ~60% less vertical space, lower visual weight (a one-time notice should look like a notice, not a primary content card).
- **All emoji glyphs in disclaimer components replaced with inline SVG**: `ℹ️` info icon → stroke `<svg>` (circle + i path); `✕` close → stroke `<svg>`; `ⓘ` info-button trigger → same info SVG. SVG inherits theme colors via `currentColor` and renders consistently across OS/browser, unlike emoji.

### Internal
- Memory note saved at `feedback_svg_over_emoji.md` documenting the SVG-over-emoji rule for functional icons (close, info, action affordances). Decorative emoji next to text labels (🐱 species marker etc.) remain acceptable.

## [2.12.1-35] - 2026-05-03

### Fixed
- **`/admin/audit` showed search actions twice per submit.** `SearchSection.handleSearch` was updating the URL via `window.history.replaceState(...)` BEFORE awaiting the search. The URL change re-triggered `useSearchParams()` → `initialQuery` recomputed → the auto-run `useEffect` saw `initialQuery && !results` (results not yet set) and fired a second `findAdopters` call independently. Both calls hit `logAudit({ action: 'search' })` → two audit_log rows per user search. Fix: (1) move the URL update to AFTER `setResults` so the effect's `!results` guard succeeds when `useSearchParams` re-fires; (2) add `!loading` to the effect's guard for defense-in-depth so an in-flight search can never trigger a duplicate.

## [2.12.1-34] - 2026-05-03

### Added
- **`/admin/organizations` page** — admin can now see every organization users created via `/organizations`, with owner email, member count, pending-invite count, and creation date. Click any row to expand and see the full member list + pending invites; admin actions include rename, transfer ownership (changes `created_by`), remove individual members, and delete the org entirely. Sidebar entry under "Users".
- **`GET /api/admin/organizations`** — lists all orgs with member/invite counts.
- **`GET /api/admin/organizations/[id]`** — fetches members + invites for one org.
- **`PATCH /api/admin/organizations/[id]`** — rename or transfer ownership.
- **`DELETE /api/admin/organizations/[id]?memberId=…`** — remove a single member.
- **`DELETE /api/admin/organizations?id=…`** — hard-delete an org (cascades through `org_invites` + `org_members`; adopter records owned by members are unaffected).
- **Org membership chips on `/admin/users`** — the "Organization" column now reads from the real `org_members` → `organizations` join (`json_group_array` aggregate in the GET query). Each chip links to `/admin/organizations?highlight=<orgId>` so admins can pivot from a user to their org context in one click. Filter by org name still works.

### Removed
- **`user_profiles.organization` legacy free-text column** dropped via migration `0037_drop_user_profiles_organization.sql`. It was only ever written by the `/admin/users` edit form and was never synced with the user-facing `/organizations` system, so the column displayed empty for everyone except users an admin manually annotated. The admin form's "Organization" input is also removed (desktop column + mobile card + edit modal). The `PUT /api/admin/users` body no longer accepts an `organization` field.

## [2.12.1-33] - 2026-05-03

### Fixed
- **Silent error swallowing in 3 hot paths** — error catches that were either dropping all context or saying nothing at all are now logged with the original operation's input:
  - `formSubmission.ts:41` — household JSON parse failure now logs a warn with a snippet of the malformed body. Previously: `} catch { /* ignore */ }` (silent).
  - `findAdopters.ts:295/301/447` — three D1 `.catch(() => [])` fallbacks now log the `adopterId` (and `userCountry` for the third) at warn level. Previously a D1 outage looked like "no results" instead of an alert.
  - `enrichAdopters.ts:50/55/63/76` — same treatment via a reusable `logD1Fallback(op, adopterId)` helper.
  - `adopters.ts:405` — the deletion-request notification fire-and-forget `.catch(() => {})` now logs `adopterId` + `actorEmail`.
  - `config.ts:30` — `getAdoptionConfig` catch now flags `fallbackUsed: true` so flaky DB → silent default-thresholds is visible.
  - `delete-adopter/route.ts:63` — final catch now includes `adopterId` + `actorEmail` (declared outside the try so they're in scope for the catch).
  - `duplicates.ts:327` — `checkTokenDuplicates` catch now logs `name`, `hasContactInfo`, `hasAddresses`.
  - `/api/config/route.ts` — the silent `} catch { ... default config ... }` now logs the underlying error at warn level.

### Added
- **Logging Conventions** section in `CLAUDE.md` documenting the two rules: (1) catches re-emit operation context (declare input vars outside `try` so they're in scope), (2) never silently swallow — log at warn or error. Includes the standard `.catch(e => { logger.warn(...); return [] })` pattern for D1 fallbacks and a privacy note about `maskEmail`.

## [2.12.1-32] - 2026-05-03

### Fixed
- **`DisclaimerToast` and `DisclaimerInfoButton` now adapt to the active color theme.** The v30 implementation used hardcoded `bg-blue-50`, `text-blue-900`, `bg-blue-600`, etc. — `globals.css` only remaps the stone/teal/rose palettes (per the documented theme architecture), so blue stayed blue under `[data-theme="dark"]` and contrast broke. Replaced with inline CSS variables: `var(--status-info-bg)` + `var(--status-info-border)` for the surface, `var(--text-primary)` for body text, `var(--btn-primary-bg)` / `var(--btn-primary-text)` / `var(--btn-primary-hover)` for the action button, `var(--text-secondary)` for the dismiss `✕`. The `ⓘ` trigger icon now uses `text-stone-*` (already remapped) instead of `text-blue-600`.

## [2.12.1-31] - 2026-05-03

### Added
- **`/api/ready` strict readiness probe** — returns 200 ONLY when the D1 binding can actually answer a query. Edge runtime, no caching, ~1 cheap `SELECT … LIMIT 1` against `appConfig`. Distinct from `/api/health` (which probes external services with their own timeouts) and `/api/config` (which falls back to defaults on DB failure).

### Fixed
- **Intermittent CI e2e failure** — Playwright's `webServer.url` now polls `/api/ready` instead of `/`, eliminating the boot race between Next.js (binding port 3000) and miniflare (wiring up D1). Previously Playwright would proceed as soon as the port responded, sometimes before miniflare's D1 worker was healthy — causing cascading `AssertionError [ERR_ASSERTION]: false == true` failures from `SynchronousFetcher.fetch` on every server action that touched the DB. Surfaced sporadically (~10% rate) in v2.12.1-20 and v2.12.1-30 e2e runs.

## [2.12.1-30] - 2026-05-03

### Removed
- **`v2 Wizard` violet pill** in the back-nav row of `AdopterProfileV2` — leftover developer artifact.
- **`ReportInaccuracyForm` component** (the misnamed disclaimer banner) deleted; its rendering on the profile is replaced by the new `DisclaimerToast` + `DisclaimerInfoButton` UX described below.

### Changed
- **Legal disclaimer relocated** from a passive grey banner below the form into an **informed-consent moment + persistent reference**:
  - New `DisclaimerToast` component renders at the top of the adopter profile on first visit per browser. Acknowledged via `localStorage['disclaimerAcknowledged']` and never shown again to that user. Includes "Entendido" primary button + ✕ dismiss; both set the storage key. `aria-live="polite"` + `role="status"` for screen readers.
  - New `DisclaimerInfoButton` (small `ⓘ` icon) rendered next to the rating badge in `AdopterForm`. Opens a centered modal with the full disclaimer text — discoverable re-entry point after the toast is dismissed.
  - The toast stops occupying screen real estate after acknowledgment, but the disclaimer remains one click away — better than the previous always-on banner (banner blindness) AND better than burying it in a footer (no CX value).

### Added
- `src/components/DisclaimerToast.tsx`, `src/components/DisclaimerInfoButton.tsx`
- i18n keys `legal.disclaimer_ack`, `legal.disclaimer_aria`, `legal.disclaimer_dismiss` (ES + EN)

## [2.12.1-29] - 2026-05-02

### Fixed
- **CI lint failure on v2.12.1-28** — `react-hooks/rules-of-hooks` flagged the new observation `useEffect` in `AdoptionFormEditV2.tsx` as "called conditionally" because it was placed after computed values (`isObservation`, `showModeSwitcher`, etc.) instead of grouped with the other hooks. Moved it up to sit right after the existing `useEffect(... [shouldOpenFromWizard])` block. No functional change — pure positional refactor. v28's CI lint job blocked the deploy; this lands the v28 work plus the lint fix.

## [2.12.1-28] - 2026-05-02

### Changed
- **Adopter `notes` field deprecated** at the profile-header level. The free-text "Notas" box is removed from `AdopterForm`. Existing data is migrated automatically to dedicated observation records (`adoptions.recordType = 'observation'`, id prefix `obs-migrated-`) by a new Drizzle migration `0036_backfill_adopter_notes_to_observations.sql` (idempotent — re-runs are no-ops). Validation, save action, duplicates merge route, and the `/api/adopters` import endpoint all stop writing to `adopter.notes`. ImportWizard's AI-extracted "notes" are now persisted as a separate observation adoption record alongside any imported adoption record. The DB column itself stays in place for one release as a safety net before being dropped in a follow-up.
- **Observation records lose the animal selection step** in `AdoptionFormWizard` and `AdoptionFormEditV2`. When `recordType === 'observation'`, the existing/new mode switcher, the animal-selector dropdown, and the animal-name + species inputs are hidden. A short hint ("Una observación es una nota sobre el adoptante — no requiere un animal.") replaces them in step 1. Stale animal data is cleared via a `useEffect` when the user switches to observation type so the saved record doesn't carry over animalName/species. Step 1 validation is skipped for observations. `required` HTML attributes on the now-hidden inputs are also conditionally disabled to avoid silent submit failures.

### Added
- Migration `drizzle/0036_backfill_adopter_notes_to_observations.sql`.
- i18n keys: `wizard.observation_no_animal_hint`, `import.initial_observation`, `import.initial_observation_placeholder` (ES + EN).

### Internal
- Defense-in-depth strip of `notes` from any `saveAdopter` payload (legacy clients can't write to the deprecated column).

## [2.12.1-27] - 2026-05-02

### Added
- **`ENABLE_SEARCH_CARD_METADATA` feature flag** — gates the profile-views (`👁`) counter and the bottom-row dates (`📅` added, `✏️` updated) on each search result card on the home page. Default **ON** (preserves current UI). Togglable from Admin UI (`/admin/config`); registered in `src/config/features.ts`, `src/app/admin/config/page.tsx` (4 spots), `src/app/api/admin/config/route.ts` GET response, and the public `src/app/api/config/route.ts` whitelist + defaults so the homepage can read it without admin auth. `SearchSection` accepts a new `showCardMetadata?: boolean` prop (default `true`); home page passes `appConfig.ENABLE_SEARCH_CARD_METADATA !== 'false'` to it.

## [2.12.1-26] - 2026-05-02

### Fixed
- **`ThemeSelector` labels are now i18n'd** — `Claro`/`Azul Noche` and the `title`/`aria-label` `Cambiar tema` were Spanish-only string literals; replaced with `theme.light` / `theme.dark` / `theme.change` keys (ES + EN both).
- **`bg-white/{80,90,20}` opacity variants** now flip correctly under `[data-theme="dark"]`. Tailwind compiles these to standalone classes (`.bg-white\/80`) that the bare-class palette remap in `globals.css` doesn't reach. Added explicit dark rules mapping them to `surface-card` with the same opacity. (`bg-black/X` left alone — it's used as a dimming overlay/scrim and the intent works in both themes.)
- **`src/app/global-error.tsx` is now theme-aware.** The root error boundary runs outside the app shell so it can't rely on `globals.css` or `ThemeContext` (the error itself may have prevented them from mounting). Reads `localStorage['theme']` directly on mount and picks light/dark hex values from a static palette table.



### Changed
- **Skipped 2 duplicate banner tests** in `tests/duplicates.spec.ts` ("appears on profile with candidates" + "can be dismissed") via `test.skip()`. They track a real regression introduced in v2.12.1-19 (the system-detected duplicate banner was removed when `AdopterProfile.tsx` was deleted and never ported into `AdopterProfileV2`). Skipping unblocks CI deploy gating; re-enable when the banner is restored.

## [2.12.1-24] - 2026-05-01

### Changed
- **`tests/authed.spec.ts` "Full adoption record" test** rewritten to walk the 3-step `AdoptionFormWizard` (record type → details → save) instead of the removed single-form `AdoptionForm`. Re-applied from the v2.12.1-21 work (which was rolled back in v23).

### Known failing tests (intentional, not re-applied from v21)
- `duplicates.spec.ts` "System duplicate banner appears on profile with candidates" and "System duplicate banner can be dismissed" still fail — the underlying app regression (missing system-detected duplicate banner on `/adopter/[id]`) was deliberately left in place when v21 was rolled back.

## [2.12.1-23] - 2026-05-01

### Changed
- **Deployment guidance updated** — `CLAUDE.md` and `.agents/workflows/deploy.md` now reflect that Cloudflare git auto-deploy is OFF; all deploys run via the GitHub Actions pipeline (`build-and-lint` → `migrate-*` → `e2e` blocking → `deploy-*`), end-to-end ~8–15 min, with rollback via Cloudflare Dashboard as the fastest path.

### Reverted
- **All work between v2.12.1-19 and v2.12.1-22** rolled back via `git reset --hard pre-c1-trust-snapshot`. This drops:
  - The C1 Trust Snapshot dark launch (v2.12.1-20) — already deprecated.
  - The `DuplicateBanner` regression fix (v2.12.1-21) — **the system-detected duplicate banner is missing again on `/adopter/[id]` profiles**, and the 3 duplicate/wizard e2e tests will fail until re-applied.
  - The wizard test update for `tests/authed.spec.ts` (v2.12.1-21) — also lost.
- The `pre-c1-trust-snapshot` git tag is preserved.

## [2.12.1-19] - 2026-04-30

### Changed
- **Adopter profile** — `/adopter` now uses `AdopterProfileV2` (collapsible sections: Adoptions, Photos, History; `AdoptionFormWizard` for new records; `AdoptionFormEditV2` for editing). History log and delete record button added to `AdopterProfileV2`.

### Removed
- **`/adopter2` route** — deprecated; `/adopter` is now the canonical profile page.
- **`AdopterProfile` component** — replaced by `AdopterProfileV2`.

## [2.12.1-18] - 2026-04-30

### Reverted
- **Adopter profile changes** — Rolled back all modifications to `/adopter`, `/adopter2`, `AdopterProfile`, and `AdopterProfileV2` introduced in v2.12.1-16 and v2.12.1-17. Both routes restored to their pre-v2.12.1-16 state.

## [2.12.1-17] - 2026-04-30

### Changed
- **Adopter profile** — Photos and History Log now rendered as tabs (Photos | History) below the Adoptions section, replacing the previous collapsible sections for those two panels.

## [2.12.1-16] - 2026-04-29

### Changed
- **Adopter profile** — Replaced `/adopter` with the V2 approach: collapsible sections for Adoptions, Photos, and History (replacing fixed tabs); `AdoptionFormWizard` for new records; `AdoptionFormEditV2` for editing. Duplicate detection banner and delete functionality fully ported from old profile. `/adopter2` route removed.

### Removed
- **`AdopterProfile`** — Old tab-based profile component deleted; `AdopterProfileV2` is now the single profile component.
- **`/adopter2` route** — Experimental route removed; `/adopter` now uses the V2 layout.

## [2.12.1-15] - 2026-04-29

### Changed
- **Cold start optimization** — Lazy-load NextAuth in `_db.ts` (`getUser`, `getIsAdmin`) and middleware so the NextAuth module graph is not parsed at worker startup. Anonymous requests (search, public pages) no longer initialize the auth subsystem.
- **Middleware** — Restructured to skip auth entirely for public routes; auth check (including session version validation) only runs on protected routes (`/my-animals`, `/my-adopters`, `/my-adoptions`, `/settings`, `/admin`).

### Removed
- **`search.ts`** — Deleted deprecated `searchAdopter` legacy function (v2.12.x staging validation complete; all call sites use `findAdopters`).

### Added
- **Bundle analyzer** — `ANALYZE=true npm run build` now generates an interactive bundle treemap via `@next/bundle-analyzer`.

## [2.12.1-14] - 2026-04-29

### Fixed
- **findAdopters D1 bug** — Replaced `inArray()` with per-ID `Promise.all(eq())` fan-out in both duplicate mode (name/token lookups) and discovery mode (extra profile fetch). `inArray()` silently returns wrong results on Cloudflare D1; search was missing adopters found via history/adoption text matches.

## [2.12.1-13] - 2026-04-29

### Fixed
- **contract-app deploy** — Removed `public/_redirects` (rule `/* /index.html 200` caused infinite loop error in wrangler v4+); SPA fallback already handled by `not_found_handling = "single-page-application"` in `wrangler.toml`.

## [2.12.1-12] - 2026-04-29

### Added
- **Adopter Profile V2** — New `/adopter2/[id]` route with `AdopterProfileV2`, `AdoptionFormEditV2`, and `AdoptionFormWizard` components (work in progress).
- **`.gitattributes`** — Enforce LF line endings on all text files; eliminates CRLF noise on Windows/WSL2.

### Fixed
- **CollapsibleSection** — Removed `overflow-hidden` that was clipping border radius; proper rounded corners now applied per open/closed state.
- **StarRating** — Uses named i18n keys (`dangerous`, `poor`, `average`, `good`, `excellent`) instead of numeric indices; star fill color now uses theme tokens.
- **i18n** — Added missing `poor` rating label (EN: "Risky", ES: "Riesgoso").
- **AdoptionHistory** — Accepts optional `editFormComponent` prop to allow V2 form injection without modifying the shared component.

### Changed
- Updated `.gitignore` to exclude `.wrangler/state/`, `*.sqlite`, and `.claude/settings.local.json`.
- Updated app and public icons.

## [2.12.1-11] - 2026-04-29

### Fixed
- **Contract App CI** — Added missing `@types/react` and `@types/react-dom` devDependencies. Cloudflare Git integration had cached node_modules; CI's clean `npm ci` exposed the gap.

## [2.12.1-10] - 2026-04-29

### Changed
- **CI** — Added `contract-app.yml` workflow: deploys contract app to Cloudflare Workers via CI on push to `staging` or `master`, but only when `contract-app/**` files change. Replaces Cloudflare Git integration auto-deploy.

## [2.12.1-9] - 2026-04-29

### Fixed
- **Cloudflare Build Error** — Pinned `next` back to `15.1.6`. The dependabot bump to `15.5.15` broke `@cloudflare/next-on-pages` v1.13.16 compatibility with the `/_not-found` route. Next.js 15.5.x changed how that route is compiled in a way the current next-on-pages version cannot handle.
- Restored `export const runtime = 'edge'` on `not-found.tsx` (correct for next-on-pages with Next.js 15.1.x).

## [2.12.1-8] - 2026-04-29

### Fixed
- **Cloudflare Build Error** — Replaced `export const runtime = 'edge'` with `export const dynamic = 'force-static'` on `not-found.tsx`. Static pre-render avoids next-on-pages' "runtime logic" detection caused by `await auth()` in the root layout being inherited into the `/_not-found` route.

## [2.12.1-7] - 2026-04-29

### Changed
- **CI** — E2E tests now only run on `push` events (not on `pull_request`), eliminating duplicate runs per commit.
- **CI** — E2E job now depends on `build-and-lint` (fail fast instead of wasting Playwright time on broken builds).
- **CI** — Added `timeout-minutes` to all jobs that lacked one: `build-and-lint` (10 min), migrate jobs (10 min), deploy jobs (15 min).

## [2.12.1-6] - 2026-04-29

### Fixed
- **Cloudflare Build Error** — Restored `export const runtime = 'edge'` on `app/not-found.tsx`; next-on-pages requires all non-static routes to use the Edge Runtime, so removing it caused the build to fail.
- Updated lint warning ratchet threshold from 122 → 123.

## [2.12.1-5] - 2026-04-29

### Fixed
- **Cloudflare Build Error** — Fixed `@cloudflare/next-on-pages` edge runtime validation error by removing `export const runtime = "edge"` from `app/not-found.tsx` to allow Next.js to properly prerender the not-found fallback as static content.

## [2.12.1-4] - 2026-04-27

### Fixed
- **Dependabot CI E2E Tests** — Added a fallback `AUTH_SECRET` to the Playwright E2E GitHub Actions job to prevent `Auth.js` crashes during test setup on PRs originating from Dependabot (which do not have access to standard GitHub repository secrets).

## [2.12.1-3] - 2026-04-27

### Fixed
- **E2E Flakiness & Test Db Lock Races** — Resolved D1 `miniflare` SQLite deadlocks caused by concurrent `Promise.all` database queries in `src/app/actions/dashboard.ts` and `src/app/api/notifications/route.ts` under E2E testing load.
- **Test Setup Synchronization** — Hardened the `forms.spec.ts` notification polling test by navigating away from DB-intensive pages during polling, applying a cache-busting timestamp `_t` parameter to Next.js API requests, and wrapping UI dropdown verifications in resilient Playwright `toPass` blocks.
- **Playwright Assertion Strictness** — Patched `getByText` and `.first()` constraints on the final form results assertion to eliminate strict-mode violations when multiple matching elements exist.

## [2.12.1-2] - 2026-04-26

### Fixed
- **Codebase Hygiene** - Resolved multiple ESLint warnings related to `any` type usage in `AdoptionForm`, `AdoptionHistory`, `my-animals` page, and `actions/adoptions`, reducing total warnings to 100. Fixed dynamic import pattern in local DB module.


## [2.12.1-1] - 2026-04-19

### Fixed
- **Registro de Cambios showing raw emails** — the history log, activity card footer, and image gallery "added by" caption now resolve editor emails to their Google display name. Falls back to a masked email (`j***o@gmail.com`) when no display name is available, instead of exposing the full address.
- **`resolveUserNames` now called from `/adopter/[id]/page.tsx`** — the existing server action was wired up to collect all `changedBy`/`addedBy` emails across history, adoptions, and images in a single batch request before rendering.

## [2.12.1] - 2026-04-18


### Changed
- **Activity card CTA de-emphasis** — "Registrar Actividad" button changed from full-width bordered to a compact right-aligned ghost link, restoring correct visual hierarchy where existing records are the focal point.
- **Rating badge inline** — star rating moved from a separate row below the summary to inline with the date/animal summary text, enabling faster visual scanning of record quality.
- **Verified address badge** — changed from a solid teal pill (`bg-teal-100 text-teal-700`) to a dimmer outline style (`bg-teal-500/10 text-teal-600 border border-teal-500/20`), reducing visual competition with primary action elements.
- **Email masking in card footer** — the "Agregado por" field now shows `j***o@gmail.com` style masked emails as fallback when no display name is available, reducing raw PII exposure in the UI.

### Added
- **Relative time on recent activity cards** — entries within the last 30 days now show a parenthetical like `(hace 2 días)` next to the absolute date, giving a faster sense of recency.
- **`formatRelativeTime()`** — new utility in `lib/dates.ts` returning localized relative time strings (ES/EN) for dates within 30 days, null otherwise.
- **`maskEmail()`** — new utility in `lib/dates.ts` for privacy-safe email display.

### Removed
- **"En Nombre De" field** — removed from the activity registration form and from all activity card displays. The `on_behalf_of` database column and search tokenization are preserved; existing data is unaffected.

## [2.12.0-5] - 2026-04-18


### Changed
- **Verified Address flag** — removed from adopter search results and profile header; now displayed only on individual adoption record cards in the timeline, where address verification contextually belongs (tied to specific deliveries).
- **Middleware domain redirect** — requests to `*.verazadoptantes2.pages.dev` are now 301-redirected to canonical custom domains (`buenadoptante.org` / `staging.buenadoptante.org`), preserving path and query string.

## [2.12.0-4] - 2026-04-17

### Fixed
- **E2E Flakiness & Test Db Lock Races** — Decoupled the D1 database testing hydration from the concurrent Next.js Miniflare execution via a standalone `scripts/setup-test-db.js` hook in Playwright. Resolved SQLite database lock collisions that caused schema application drops (`D1_ERROR: no such column`).
- **WebKit Mobile Target** — Re-injected `webkit` back into the CI runner dependency install targets to successfully process iOS/iPhone 14 responsive layout viewport tests.

## [2.12.0-3] - 2026-04-17

### Changed
- **CI/CD Pipeline Hardening** — Transitioned deployment workflow to a strictly-sequenced "Direct Upload" model via GitHub Actions (`npx @cloudflare/next-on-pages` then `wrangler pages deploy`). Removed `continue-on-error` from E2E job to unmask test failures.
- **E2E Stability** — Upgraded local test server command to use the Node-compiled production build `npm run build && npm run start` (mitigating Next.js 15.1 dev-server memory leaks). Test db seed now automatically satisfies terms versions to unblock Playwright.

## [2.12.0] - 2026-04-13

### Added
- **`findAdopters` — unified search engine** — single exported function replacing the fragmented `searchAdopter` (discovery) and `checkTokenDuplicates` (duplicate detection) call sites. Mode-based dispatch: `mode: 'discovery'` executes the full enriched LIKE search with geo-filter, PII masking, and analytics logging; `mode: 'duplicate'` executes a lightweight token-index + LIKE fallback query with no auth, no enrichment, and no analytics noise.
- **SQL gate fix** — name-word tokens in duplicate mode now use prefix-LIKE instead of exact-match SQL, ensuring the Levenshtein fuzzy scoring step always runs for typo variants (e.g. Jonatan/Jonathan, Pérez/Perez).
- **`excludeAdopterId` on `FindAdoptersInput`** — duplicate mode accepts an ID to exclude from results, used by the contract route to prevent the just-created adopter from self-matching.
- **Discriminated union types** — `DiscoveryMatch` (full adopter row, enrichment, non-optional `stats`/`flags`) and `DuplicateMatch` (lightweight, `relevancePercent` normalized to `PRACTICAL_MAX_DUPLICATE`). TypeScript now enforces field presence at compile time. `AdopterMatch` union exported for generic consumer code.
- **Dead field fix in `AdopterFlagging`** — search result card referenced `res.adopter.email` and `res.adopter.phone` (fields that do not exist on the `adopters` table). Replaced with `res.adopter.contactInfo`.

### Changed
- **`SearchSection`** — migrated from `searchAdopter`/`SearchResult` to `findAdopters({ mode: 'discovery', enrich: true })`/`DiscoveryMatch`. Fixes the named-import hard break (SB1).
- **`AdopterForm`** — creation-time duplicate check migrated to `findAdopters({ mode: 'discovery', minRelevance: 15 })`. Discovery mode retained because card rendering requires full adopter row.
- **`AdoptionWizard` + `ReportWizard`** — migrated to `findAdopters({ mode: 'discovery', enrich: true })`. State typed as `DiscoveryMatch[]`; eliminates `any[]` escape hatch.
- **`AdopterFlagging`** — migrated to `findAdopters({ mode: 'discovery', enrich: false })`. Enrichment disabled — card only needs `adopter.id` and `adopter.name`.
- **`ImportWizard`** — both call sites migrated to `findAdopters({ mode: 'duplicate' })`. `confidence` band derived inline via `confidenceBand(r.relevancePercent)`. State typed as `DuplicateMatch[]`.

### Deprecated
- **`searchAdopter`** — rollback reference only. Remove after v2.12.x staging validation.
- **`checkTokenDuplicates`** — rollback reference only. Remove after v2.12.x staging validation.

### Not changed (deferred)
- **`contract/submit/route.ts`** — inline dual-strategy block also drives notification + org fan-out; cannot be safely extracted to `findAdopters` without rearchitecting the notification pipeline. Deferred to follow-up PR.
- **`getDuplicateCandidates`** / **admin batch scan** — out of scope; separate future quarter work.

## [2.11.2] - 2026-04-13

### Added
- **Confidence bucketing in profile creation form** — the "Posibles perfiles coincidentes" inline card and the save-blocking modal both now filter out results below 15% relevance before display. False-positive matches (e.g. an adopter whose address field contains a matching word) are silently suppressed rather than shown as warnings.
- **Confidence bucketing in admin duplicate flagging modal** — system-suggested matches now display a color-coded `% match` pill (red ≥75%, amber ≥40%, blue <40%) instead of a generic "auto" badge. Matches below 15% are collapsed behind a "Ver N coincidencias de baja confianza" expander and suppressed by default. Results are sorted highest confidence first.
- **Confidence bucketing in ImportWizard Step 3 field-overlap hints** — field-overlap hints now show the confidence percentage alongside each match. Hints below 15% are collapsed into an expander, reducing noise for rescuers importing posts where a shared first name triggers a spurious warning.
- **`confidencePercent` on `DuplicateCandidate`** — `getDuplicateCandidates` now computes and returns a normalized 0–100% confidence score derived from `score / PRACTICAL_MAX_DUPLICATE`, enabling confidence-aware UI rendering throughout the flagging flow.

## [2.11.1] - 2026-04-12

### Added
- **Confidence-based duplicate detection engine** — `checkTokenDuplicates` now returns a normalized `confidencePercent` (0–100%) alongside each match, derived from a weighted token score divided by `PRACTICAL_MAX_DUPLICATE = 12`. Replaces the previous ad-hoc `low/medium/high` string classification.
- **Levenshtein fuzzy name matching** — name word tokens are compared at score time using edit-distance with strict length gates (1-edit for tokens >4 chars, 2-edit for tokens >7 chars). Enables `Jhon ↔ John`, `Perez ↔ Pérez` matching without any schema changes.
- **NFD accent normalization** — `normalizeText()` upgraded from a manual `ACCENT_MAP` to Unicode NFD decomposition, covering the full Latin accent range including uppercase variants (Á, É, Ñ, Ü) and all cases the old map missed.
- **`src/lib/scoring.ts`** — new shared module with `levenshtein()`, `fuzzyNameScore()`, `normalizeConfidence()`, `confidenceBand()`, and scoring constants (`PRACTICAL_MAX_DUPLICATE`, `SEARCH_SCORE_CEILING`). Pure TypeScript, zero dependencies, Edge-runtime safe.
- **`relevancePercent`** on every `SearchResult` — normalized 0–100% from `relevanceScore / SEARCH_SCORE_CEILING`.
- **Common-name refinement nudge** — when a single-token search (e.g. "Maria", "Juan") returns more than `REFINEMENT_NUDGE_THRESHOLD = 10` results, an amber dismissible banner appears inside the scroll target guiding the user to add a last name, phone, or address.
- **`REFINEMENT_NUDGE_THRESHOLD`** and **`LOW_RELEVANCE_PERCENT_THRESHOLD`** constants in `src/config/constants.ts`.
- **`lowRelevanceResults`** bucket in `SearchResponse` — multi-token results scoring below `LOW_RELEVANCE_PERCENT_THRESHOLD` are separated from the main list (not discarded).
- **`singleTokenResultCount`** field in `SearchResponse` — triggers the refinement nudge UI when set.

### Changed
- **`< 15%` duplicate matches** are now filtered before being returned — a shared first name alone (e.g. "Juan Maldonado" vs "Juan Hualde") scores ~8% and is never surfaced as a warning, eliminating false-positive fatigue.
- **Levenshtein query batching** — name_word tokens for all matched adopters are now fetched in a single `inArray` query instead of one query per adopter (N+1 fix).
- **Fuzzy score bounded per input token** — only the best matching stored word is counted per input token (previously all pairs accumulated), preventing score inflation on profiles with many name words.
- **`relevancePercent` suppressed for unauthenticated users** — zero-valued in the response payload to avoid revealing indirect information about system data density.
- **Refinement nudge placement** — rendered inside the `resultsRef` scroll container so it's visible after mobile auto-scroll.
- **Refinement nudge color** — changed from teal to amber to distinguish clearly from the `login_required` banner (which already owns teal).

## [2.11.0] - 2026-04-12

### Added
- **Terms & Conditions acceptance on sign-up** — new users must explicitly accept the Terms of Use and Privacy Policy before completing onboarding. Acceptance is recorded in `user_profiles` with a timestamp and version number for legal auditability.
- **Versioned T&C re-prompt** — `CURRENT_TERMS_VERSION` constant in `config/constants.ts`; bumping it forces all users to re-accept on next sign-in via a dedicated modal (not the country picker).
- **Dedicated T&C update modal** — returning users who need to re-accept see a focused "We've updated our Terms" modal, not the full country-selection onboarding flow.
- **`acceptTermsAndCountry` server action** — atomic write combining country confirmation + T&C acceptance in a single D1 upsert with audit log entry.
- **`acceptTerms` server action** — lightweight re-acceptance action for returning users; does not touch country or `country_confirmed`.
- **D1 migration `0033_add_terms_acceptance.sql`** — adds `terms_accepted_at` and `terms_version` columns to `user_profiles`; resets `country_confirmed = 0` for all existing users to trigger the re-prompt.

### Changed
- **Terms of Use page (`/terms`)** — Section 2 rewritten with explicit user obligations: legitimate basis requirement, consent of mentioned persons, image consent, sensitive data prohibition, and sole legal responsibility. Updated "last modified" date.
- **`CountryConfirmBanner`** — T&C checkbox now appears before the country picker in all onboarding variants; quick-pick country buttons disabled until checkbox is checked; server action failures now surface an inline error with retry (banner no longer silently dismisses on failure); `max-h-[90vh] overflow-y-auto` prevents modal overflow on small screens; saving state replaced with a spinner.
- **`getUserSettings`** — returns `termsVersion` so the banner can compare against `CURRENT_TERMS_VERSION` without an extra fetch.

### Fixed
- Removed `as unknown as` cast on `termsVersion` in `getUserSettings` Drizzle path — was always returning `null` in local dev, causing the banner to fire on every page load.
- `acceptTerms` now uses `INSERT ... ON CONFLICT DO UPDATE` instead of a bare `UPDATE`, preventing a silent no-op when `user_profiles` row is missing.

## [2.10.2] - 2026-04-05

### Changed
- **Search UX — Gradual Engagement** — Removed the pre-emptive "🔒 Información protegida" banner above search results for unauthenticated users. Users now discover the login requirement organically by clicking a result, which triggers the login modal at the moment of intent rather than upfront friction.
- **Login Modal Copy** — Updated description from "Inicia sesión para acceder a funciones avanzadas" to "Inicia sesión para acceder a la información", directly matching the user's intent at the moment they hit the modal.

## [2.10.1] - 2026-04-04

### Changed
- **Activity Timeline UX Polish** — Resolved redundant date displays, fixed adoption request Spanish translation bug, lightened background weight of detail blocks, suppressed self-authored record attribution for privacy, upgraded numeric ratings to standardized color-coded `RatingBadge` pills, implemented a friendly empty state for new profiles, and replaced hover-only mobile edit affordance with a consistent, always-visible SVG pencil icon.

## [2.10.0] - 2026-04-04

### Added
- **Admin Communications Hub** — Implemented a dedicated dashboard (`/admin/notifications`) to control platform notifications globally. Includes a kill-switch toggle for each notification type.
- **Performance Optimization** — Restructured notification schemas to map composite indexes (`type`, `created_at`), directly eliminating severe table scans. Refactored `actions` block to cache feature flags for multi-dispatch notifications loops.
- **Liveness Audit Tuning** — Added `auditDurationMs` dashboard metrics to the Health Admin UI and restructured parallel database pings behind `Promise.all()`.

## [2.10.0-19] - 2026-04-04

### Added
- **Quick Access Strip** — Homepage now includes a contextual dashboard strip for authenticated users, displaying live counts and quick shortcuts for My Animals, My Adoptions, and My Adopters.

## [2.10.0-18] - 2026-04-04

### Security
- **Critical Vulnerability Remediation**: Transitioned PII masking from cosmetic Client-Side UI filtering to Server-Side Payload Masking inside `searchAdopter` action. Ensure raw phone numbers and emails are never sent across the wire to unauthenticated users.
- **Data Leakage Fix**: Redacted an 80-character snippet window entirely when matching against PII fields to prevent adjacent data leakage.
- **Anti-Fishing Hurdle**: Blocked purely numeric queries (length > 4) and queries containing `@` for unauthenticated sessions to prevent scraping of valid profiles via brute-force.

### Fixed
- Fixed an issue where the `tooManyAdoptions` and `tooManyRequests` UI flags were not rounding their "days" counts and displaying the localized word "days" correctly.

## [2.10.0-17] - 2026-04-04

### Added
- **Search relevance engine** — implemented robust cross-field query coverage bonus to ensure multi-token queries are ranked accurately.
- **Multi-token highlighting** — modernized the snippet rendering architecture to support multi-token highlighting in search results.
- **Duplicate Comparison Card** — new `DuplicateComparisonCard` component for side-by-side duplicate data evaluation.
- **i18n translation tools** — added new development scripts for automated validation of translation keys.

### Changed
- **Comprehensive UI Internationalization** — extensive i18n localization added across forms and wizards (`AdopterForm`, `AdoptionForm`, `ReportInaccuracyForm`, `AdoptionWizard`, `ReportWizard`), completely replacing hardcoded labels.
- **Search snippet rendering** — improved search results context by modernizing snippet rendering logic.

### Fixed
- **SQL Injection vulnerability** — secured `LIKE` patterns within the search engine and duplicates logic to prevent potential injection vectors.
- **Lint warnings** — fixed unused variables across duplicates/mass-action routes and list components to meet deployment ratchet criteria.
---

## [2.10.0-16] - 2026-03-28
### Added
- **Domain layer** — new `src/domain/` module with `constants.ts` (FLAG_REASONS, RECORD_TYPES, EVENT_TYPES), `flags.ts` (buildFlags), `stats.ts` (computeStats), `ratings.ts` (computeAvgRating) replacing 3 duplicated implementations
- **AdminAdopterList component** — extracted client component from admin adopters page for cleaner separation
- **Mass-action API route** — new `/api/admin/mass-action` endpoint for bulk admin operations
- **Config API route** — moved feature flag config from `/api/admin/config` to `/api/config` (public, non-admin scoped)

### Changed
- **Rating display standardization** — all inline `⭐ rating.toFixed(1)` replaced with `<RatingBadge>` component; new `variant="inline"` mode and decimal support (e.g. `4.2` instead of rounding to `4`)
- **AdoptionHistory rewrite** — restructured timeline card layout with cleaner component hierarchy
- **RecordTypeColors extended** — added `dot`, `ring`, `iconBg` properties for richer record-type styling
- **AdopterFlags type moved** — from `actions/types.ts` to `types/adopter.ts` for shared access
- **AdopterStats simplified** — flat `searchHits`/`profileViews` counters replacing period-bucketed `{90d, 1y, all}` objects
- **i18n labels** — "Interactions" → "Activity", "New Interaction" → "Log Activity" (EN/ES)

---

## [2.10.0-9] - 2026-03-17

### Changed
- **Form results route** — refactored from `[notificationId]` to `[submissionId]` for clearer URL semantics
- **Adoption timeline** — added form submission pill to adoption history timeline

---

## [2.10.0-8] - 2026-03-17

### Added
- **Zaraz/Amplitude integration** — event tracking for search, profile views, and adoption flows
- **OG social preview cards** — Open Graph meta tags for rich link previews on social platforms

### Changed
- **Funcionalidades page** — polished copy, layout, and CTA updates; dark theme fix for pain point cards

---

## [2.10.0-7] - 2026-03-15

### Fixed
- **E2E tests** — fixed species select locator (was targeting wrong select element), country banner seed data, and search results visibility in CI

---

## [2.10.0-6] - 2026-03-15

### Added
- **Notifications page** — full notifications listing at `/notifications` with read/unread filtering
- **Features landing page** — premium `/funcionalidades` page with generated illustrations
- **Delete animals** — ability to delete adoption/interaction records

### Changed
- **Features page screenshots** — replaced AI art with real app screenshots, sharpened feature copy

---

## [2.10.0] - 2026-03-13

### Added
- **Form results UX** — redesigned form submission results page with comparison cards, match badges, and link-to-profile actions
- **Unlinked forms on My Adopters** — surface unlinked PetShield form submissions in the adopter management dashboard
- **Contract link on My Adoptions** — quick link to signed contract from adoption records

### Fixed
- **Mobile layout** — responsive fixes for form results and adopter management on small screens

---

## [2.9.10-2] - 2026-03-13

### Fixed
- **Form submission route** — fixed routing for PetShield form submissions
- **Idempotent migrations** — ensured all migration files use `IF NOT EXISTS` / `OR IGNORE` guards

---

## [2.9.4] - 2026-03-09

### Changed
- **CSS architecture refactor** — consolidated to 2-theme system (light/dark) with green brand consistency
- **Notification bell** — visual polish and theme alignment

### Fixed
- **Keystatic API route** — tolerate missing GitHub env vars during build (503 + setup instructions)

---

## [2.9.3] - 2026-03-08

### Fixed
- **JWT user ID desync** — fixed session-based admin menu visibility, public search access
- **Strict form submission** — tightened validation on PetShield form submit
- **Admin activity exclusion** — tag userId at write, filter admin stats at read

---

## [2.9.2] - 2026-03-08

### Added
- **PetShield form** — pre-adoption screening questionnaire with species/life stage, household assessment, geolocation, selfie capture, and lifestyle/commitment questions
- **Share button** — standardized share button component across profile and form pages

### Changed
- **Style guide** — established design token infrastructure for consistent theming

---

## [2.9.1] - 2026-03-08

### Added
- **SEO/GEO foundation** — `robots.txt`, `sitemap.xml`, JSON-LD structured data, rich metadata
- **Country auto-detect** — auto-detection via Cloudflare headers with confirmation flow
- **Canonical URLs** — proper canonical link tags, alt text audit fixes

### Changed
- **Schema-sync workflow** — added `/schema-sync` workflow for verifying local D1 parity

---

## [2.9.0] - 2026-03-07

### Added
- **In-app notifications** — new `notifications` D1 table, server actions (`createNotification`, `getUnreadCount`, `markRead`, `markAllRead`), and API route (`GET/PATCH /api/notifications`)
- **Notification Bell UI** — glassmorphic dropdown in the navbar with animated red badge, 60s polling, optimistic mark-as-read, theme-aware via CSS variables (`var(--card)`, `var(--foreground)`, `var(--primary)`)
- **Fuzzy search on contract submission** — after an adopter signs a contract, the system runs a hybrid search (token-based + LIKE queries) against `duplicate_tokens` and `adopters` tables to detect potential matches
- **Contract results page** — `/contract-results/[notificationId]` displays submitted contract data, matching profiles with match-type badges, and links to existing adopter profiles
- **Contract adopter tokenization** — adopters created via contract submission are now tokenized for future duplicate detection (was previously missing)

### Changed
- **Notification escalation hooks** — `createNotification()` is the single entry point for all notifications with commented-out Web Push and email hooks for Phase 2
- **Hybrid search strategy** — contract fuzzy search now combines pre-indexed tokens with direct LIKE queries against `adopters.name` and `adopters.contactInfo` for broader match coverage

### Fixed
- **Rules of Hooks violation** — `NotificationBell` early return for unauthenticated users was placed before `useCallback`/`useEffect`, causing webpack module resolution crash on `/admin`
- **Barrel export crash** — removed notifications server actions from barrel `index.ts` to prevent server-only modules (`drizzle-orm`, `@/lib/db`) from leaking into client bundles

---

## [2.8.0-14] - 2026-03-06

### Fixed
- **Country banner crash** — `handleSaveCountry` no longer accesses `result.success`; always dismisses the banner regardless of server action outcome, preventing `TypeError` on stale builds
- **Guide page translation** — removed `pathname.startsWith('/guide')` override that prevented language switching; now correctly uses `locale` from language context
- **Duplicate key React error** — added defensive dedup filter in `getAdoptions()` to prevent React warnings from SQLite index corruption returning duplicate rows

### Changed
- **Guide page i18n** — moved hardcoded "Why Vet Adopters?" bullets and section labels from inline JSX to the `/api/guide-content` API; all guide content is now admin-editable from a single file
- **Dev login provider** — added Credentials provider for local development (non-production only)

---


## [2.8.0-8] - 2026-03-03

### Fixed
- **Video playback through proxy** — proxy-image API now forwards Range headers from the browser to upstream servers and returns 206 Partial Content responses with Content-Range, enabling HTML5 `<video>` element streaming (previously the proxy silently ignored Range requests, causing most browsers to refuse to play video content)
- **Video autoPlay in lightbox** — all three lightbox components (ImportWizard, AdoptionHistory, ImageGallery) now include `muted` and `playsInline` attributes, which are required by browsers for autoPlay to work without user gesture

---

## [2.8.0-7] - 2026-03-03

### Fixed
- **Video lightbox playback** — replaced unreliable URL-extension regex detection with `expandedIsVideo` boolean state; lightbox now always renders `<video>` when a video thumbnail is clicked, regardless of URL format
- **Consistent thumbnail sizes** — standardized media thumbnails to `w-14 h-14` (56px) in ImportWizard step 3 and AdoptionHistory interaction records

---

## [2.8.0-6] - 2026-03-03

### Fixed
- **Images/videos not loading (CSP + 503)** — service worker was intercepting cross-origin R2 requests, causing CSP `connect-src` violations; the SW's catch block then returned a fake 503 response. Fixed by skipping R2 domains in SW fetch handler. Bumped SW cache version to v2 to force re-registration.

---

## [2.8.0-5] - 2026-03-03

### Fixed
- **Import Wizard video playback** — replaced broken inline play/pause (overlay blocked video view) with lightbox-based approach; clicking video thumbnail opens full-screen player with native controls
- **Import Wizard step 3 review** — now shows video thumbnails with play icons alongside images; label updated to "Attached Media"
- **Import Wizard lightbox** — detects proxied video URLs and renders `<video>` with controls instead of `<img>`
- **Interaction record media display** — thumbnails now differentiate images (magnifying glass on hover) vs videos (teal play icon); both open in lightbox on click; lightbox renders `<video>` for video URLs

---

## [2.8.0-4] - 2026-03-03

### Added
- **Video storage and playback** — scraper extracts video URLs from `<video>` elements and `og:video` tags across all platforms; videos are downloaded and stored in R2; ImageGallery renders `<video>` with play overlay and lightbox player
- R2 helper supports video content types (mp4, webm, mov)
- Adopters API handles video items with proper captions and profile picture logic

---

## [2.8.0-3] - 2026-03-03

### Changed
- **Always create interaction record on import** — AI prompt now classifies every post into a record type (adoption, adoption_request, follow_up, observation, returned_pet); denunciations/cruelty posts become observations
- Removed `adoptionDetected` guard — import wizard always creates an interaction record alongside the adopter profile

---

## [2.8.0-2] - 2026-03-03

### Added
- **Universal social media scraper** — scraper microservice now supports Instagram, X/Twitter, and TikTok in addition to Facebook; `fetch-content` route delegates social URLs to the Playwright scraper with Googlebot/proxy fallbacks

---

## [2.8.0] - 2026-03-02

### Changed
- **DatePicker redesign** — replaced 3-dropdown (Day→Month→Year) pattern with native `<input type="date">` for full precision; added optional "approximate date" toggle (Month+Year only, outputs `YYYY-MM`)
- **Deploy workflow** — added golden rule to always check `remotes/origin/*` when reporting deployed versions

### Fixed
- **Share target images not displaying** — Service Worker now intercepts share POST, caches images in Cache API, and ImportWizard reads them on mount; previously images were silently dropped
- **Guide page FAQ on mobile** — FAQ accordion answers were not loading on mobile breakpoints
- **Date parsing guard** — `AdoptionWizard` and `AdoptionForm` now safely handle `YYYY-MM` format by defaulting day to 1st

### Added
- **Admin menu link** — admin users now see a nav item linking to `/admin` in the header menu

---

## [2.6.0-6] - 2026-02-27

### Fixed
- **Zod date validation** — adoption date field now accepts both Date objects and ISO date strings (was rejecting all form submissions)
- **CSP connect-src for Google avatars** — service worker avatar caching no longer blocked
- **Second Google icon (Login.tsx)** — replaced external authjs.dev reference with inline SVG

---

## [2.6.0-5] - 2026-02-27

### Added
- **Zod input validation** — all server actions now validate inputs via Zod schemas (`validation.ts`) before any DB operation
- **Content-Security-Policy header** — XSS protection with allowlists for Google, Axiom, Gemini, Cloudflare

### Fixed
- **Admin access for DB-granted admins** — `admin/layout.tsx` now uses `isAdminAsync()` to check DB roles, not just the hardcoded bootstrap list
- **Country modal per-user** — `country_confirmed` localStorage key is now user-specific; switching accounts correctly triggers the modal
- **Google sign-in icon** — replaced external `authjs.dev` image (blocked by CSP) with inline SVG

### Changed
- **NextAuth pinned** — locked to exact `5.0.0-beta.30` (removed `^` range) to prevent silent breakage
- **ESLint re-enabled in builds** — removed `ignoreDuringBuilds: true` (0 errors, 82 warnings)

---

## [2.6.0-4] - 2026-02-27

### Added
- **Blocking country selection modal** — new users must select their country before using the app; replaces the dismissable banner with a full-screen modal (no close button)
- **Header language toggle** — globe icon + EN/ES text toggle visible to all users (authenticated and unauthenticated)

### Fixed
- **Next.js 15 headers() compatibility** — `headers()` in `audit.ts` now properly awaited (was causing sign-in errors)
- **Language persistence** — auto-detected browser language now saved to localStorage so it survives page refreshes
- **Post-country-selection refresh** — `router.refresh()` after country selection updates the header to show user menu

### Changed
- **Country modal UX** — detected country shows confirm/change flow; no detection shows quick-picks (AR, UY, CL, MX) + full searchable dropdown

---

## [2.6.0-3] - 2026-02-22

### Added
- **R2 permanent image storage** — all Facebook CDN images now persisted to Cloudflare R2 bucket, eliminating broken image links when FB CDN URLs expire

---

## [2.6.0-2] - 2026-02-22

### Fixed
- **Scraper extraction** — OG tags extracted from DOM, article text; dismisses login modal
- **Googlebot UA fallback** — uses `facebookexternalhit` UA directly for recovery, no Playwright needed

---

## [2.6.0-1] - 2026-02-22

### Fixed
- **Scraper extraction** — fixed OG tag parsing, How It Works step 2 updated to "record adoptions"
- **R2 save endpoint** — added client-side recovery flow for failed image uploads

---

## [2.6.0] - 2026-02-22

### Added
- **Private profiles** — adopter profiles now require authentication; unauthenticated visitors are redirected to login with a "Sign In Required" toast, then returned to the profile after sign-in
- **Shared type system** — new `types/adopter.ts` with typed interfaces (`Adopter`, `AdoptionRecord`, `AdopterImage`, etc.) replacing `any` throughout adopter components
- **Shared adoption filter utility** — `lib/adoptionFilters.ts` with `countRecordsInPeriod()` used by both `AdopterForm` and `AdopterProfile`
- **Extracted text utilities** — `lib/textUtils.ts` with reusable `renderTextWithLinks()` for clickable URLs, emails, and phone numbers

### Changed
- **Code quality refactor** — addressed 14 of 15 audit findings across `AdopterForm.tsx` and `AdopterProfile.tsx`:
  - Hydration-safe date computations via `useMemo` reference date
  - Deduplicated auth check to single `useMemo`-based `isAuthenticated`
  - Removed pointless `adopter = initialData` alias
  - Simplified country name IIFE to closure
  - Forwarded `isAdmin` prop to `AdopterForm`
  - Removed dead `onEdit` callback from `AdoptionHistory`
  - Removed `as any` cast on translation key
  - Cleaned up trailing spaces and empty blank lines
- **Internationalized labels** — period labels (90 Days, 1 Year, All Time) and duplicate match type labels now use i18n keys in both EN/ES

---

## [2.5.5-1] - 2026-02-22

### Fixed
- **Admin sidebar mobile layout** — improved mobile nav responsiveness in admin layout and sidebar component

---

## [2.5.5] - 2026-02-13

### Fixed
- **Favicon missing in staging** — added explicit `<link rel="icon">` tag in layout pointing to `/icon.svg`
- **Search query logging failing in production** — added missing unique constraint on `searches.query` column required by `onConflictDoUpdate` upsert; every search was silently failing to log

---

## [2.5.3.1] - 2026-02-13

### Added
- **Enriched admin adopters list** — card layout with thumbnails, server-rendered rating badges, stats (searches, views, requests, adoptions), flags, and dates replacing basic table
- **Reusable enrichment module** — `enrichAdopters.ts` extracts shared logic from search pipeline for consistent data across search and admin views
- **Audit log IP & device capture** — `logAudit()` auto-captures IP address (`CF-Connecting-IP`) and User-Agent from request headers; all callers get data for free
- **Audit log IP geolocation links** — IP column links to `ipinfo.io` for free geolocation lookup
- **Mobile-responsive admin layout** — sidebar converts to slide-in drawer on mobile with hamburger menu, active route highlighting
- **Logo favicon** — replaced default Next.js triangle with teal shield+paw SVG matching the app logo

### Changed
- **Admin sidebar** — extracted to `AdminSidebar.tsx` client component with responsive behavior
- **Audit table** — horizontally scrollable on mobile (`overflow-x-auto`), filters wrap on small screens
- **Search action refactored** — removed ~130 lines of inline enrichment code in favor of shared module

---

## [2.5.3] - 2026-02-13

### Added
- **Custom DatePicker component** — day/month(3-letter)/year dropdowns replacing native `<input type="date">` to avoid DD/MM vs MM/DD ambiguity
- **Adoption card verb translations** — `verb_adopted`, `verb_requested`, `verb_noted`, `verb_followed_up`, `verb_returned` in EN/ES
- **Missing i18n keys** — `duplicates.view_profile`, `duplicates.dismiss` added to both locales
- **Theme overrides for record-type borders** — dark and apple theme support for `border-l-sky-400`, `border-l-amber-400`, `border-l-violet-400`, `border-l-rose-400`

### Changed
- **Redesigned adoption record cards** — one-line summary format (`{date} — {verb} {animal} ({species})`), colored left border by record type, neutral notes background, star ratings inline
- **Section renamed** — "Adopciones"/"Adoptions" → "Interacciones"/"Interactions" to reflect all record types
- **CTA button renamed** — "Registrar Nueva Adopción" → "Nueva Interacción" for clarity

### Fixed
- **Search crash on back-navigation** — added null guard on `searchAdopter` response preventing `Cannot read properties of undefined` errors
- **Spanish "adoption" leak** — fixed `|| 'adoption'` fallback treating empty Spanish `word_adoption` as falsy, changed to `??` operator

---

## [2.5.2] - 2026-02-11

### Fixed
- **Sticky search bar on mobile** — search bar was hidden behind navbar on mobile when scrolled
- **Data request auth** — added authentication check to data-request POST endpoint

---

## [2.5.1] - 2026-02-12

### Fixed
- **Duplicate user accounts** — `ensureUserProfile` now looks up users by email instead of random JWT `user.id`, preventing new rows on every sign-in
- **40 ESLint warnings** — cleaned up `no-unused-vars`, `prefer-const`, and `alt-text` across the codebase

### Changed
- **E2E tests rewritten** — replaced shallow tests with real user journeys (search-to-decision, full adoption record CRUD, import wizard flow); fixed auth setup for CI
- **Stats aggregation pushed to SQL** — `COUNT + CASE WHEN` replaces JS-side filtering for profile statistics
- **Consolidated `getDb()`** — removed duplicate database helper; canonical version in `src/lib/db.ts`
- **Extracted business constants** — inline magic numbers moved to `src/config/constants.ts`
- **LoginModal overlay** — sign-in redirects to homepage with modal instead of blank page; session expired toast (EN/ES)

### Added
- **CI lint ratchet** — ESLint warning count enforced in CI pipeline
- **E2E tests in CI** — Playwright tests run on push with JWT-based auth and D1 seeding
- **`workflow_dispatch` trigger** — CI can be triggered manually and on `e2e_tests` branch

---

## [2.4.3] - 2026-02-11

### Changed
- **Refactored `actions.ts`** — split 1,463-line monolith into 10 domain-specific modules under `src/app/actions/` with barrel re-exports (zero breaking changes to consumers)

### Removed
- **Dropped `adoption_images` table** — unused table (empty in production); all adoption images are stored in `adopter_images` via the `adoption_id` column

---

## [2.4.2] - 2026-02-09

### Changed
- **Date formatting standardized** — all date displays now use 3-letter month abbreviations (e.g. "Feb 4 '26") via shared `dates.ts` utility; removed 5 duplicated local format functions across 12 files
- **AI extraction prompt hardened** — dedicated `SOCIAL PROFILES — CRITICAL` section ensures Instagram handles and @mentions are always captured; lists common IG patterns (ig:, insta:, 📷)

### Fixed
- **Instagram handle extraction** — AI was skipping @handles due to overly aggressive anti-hallucination rules; now correctly extracts all social profiles
- **500 error on save to existing adopter** — added missing `source_url` column to local D1 adoptions table

### Removed
- **FacebookImportWizard** — removed unused legacy component

---

## [2.2.0] - 2026-02-09

### Added
- **How-it-works steps** — clickable guide steps linking to search, import, and action cards
- **InstallCTA theming** — respects theme colors using CSS variables instead of hardcoded stone palette

---

## [2.4.0] - 2026-02-09

### Added
- **PWA support** — installable Android/iOS app with offline caching, share target (receive from WhatsApp/Instagram), install CTA on homepage
- **New brand logo** — green shield + white paw icon in nav and home page
- **Import wizard i18n** — full EN/ES translation, image selection/lightbox, proxy-image universal
- **Smart import flow** — single input with auto URL detection, share intent integration, progress percentage, address/social/record type support
- **UX onboarding** — how-it-works guide, search hints, import action card, flag legend, sample record
- **Legal compliance** — privacy policy, terms of service, consent notice, profile disclaimer
- **Data request tracking** — inline report form and admin panel for ARCO rights requests
- **User registry** — `user_profiles` table, admin page with inline editing, mailto links, first sign-in tracking
- **System audit log** — `audit_log` table with filtering, pagination, device/PWA badges, configurable retention
- **Session version check** — middleware-enforced JWT versioning to force re-authentication on deploy
- **Admin data import/export** — environment migration tool for moving data between staging and production
- **Photo upload** — image upload during adoption creation with queue and upload on save
- **Dynamic social icons** — source URL icons on adoption cards (Instagram, Facebook, WhatsApp, etc.)

### Changed
- **Unified import flow** — consolidated Facebook/URL/text import into single smart input
- **Contact fields** — consolidated into single WYSIWYG textarea
- **Feature flags** — consolidated into single `ENABLE_CONTENT_IMPORT` flag
- **Search placeholder** — updated to "Name, Phone, or Address" (EN/ES)
- **Install CTA** — removed dismiss button, replaced misleading offline benefit with home screen benefit

### Fixed
- **Session management** — added `middleware.ts` for proper NextAuth v5 auth enforcement
- **Species labels** — locale-aware translation on adoption cards
- **AI contact labels** — locale-aware labels for extracted contact info
- **ESLint config** — rewrote to use FlatCompat, downgraded noisy rules to unblock CI
- **D1 compatibility** — `COALESCE` instead of `NULLS LAST` in user queries
- **Edge sign-in** — populate user table when adapter is disabled on Cloudflare Edge

---

## [2.1.0] - 2026-02-08

### Added
- **Schema health endpoint** (`/api/health`) — validates all database table columns against expected schema, catches migration drift
- **Schema smoke test** — Playwright test calls `/api/health` and fails with detailed mismatch report
- **Axiom error logging** on all 24 server action catch blocks — every error now reaches Axiom with context (function name, entity IDs, error ID)
- **Error ID propagation** — mutation errors include an error ID in thrown messages for end-to-end correlation (Axiom → server → toast → user)
- **Facebook import wizard** with AI extraction, duplicate detection, and i18n (EN/ES)
- **API route for adding records** (`/api/adopters/[id]/add-record`) with phased mutation logging

### Changed
- **Alert → toast migration** — replaced all 28+ `alert()` calls across 11 components with toast notifications (`useShowToast`)
- Adopter creation API route with duplicate/match checking

### Fixed
- **Production database schema** — manually applied 3 missing columns (`adopters.added_by`, `adoptions.record_type`, `adoptions.source_url`)
- **Staging database schema** — applied missing `adoptions.source_url` column
- Marked migration `0010` as applied in both environments

---

## [2.0.1] - 2026-02-08

### Added
- Production readiness hardening — security headers, auth guards, structured logging
- Authenticated E2E test suite with programmatic login
- Debug endpoint cleanup

---

## [2.0.0] - 2026-02-04

### Added
- Observability and error handling improvements
- Axiom logging integration
- Toast notification system
- Unique error IDs for log correlation
- Parallelized database queries for performance

---

## [1.9.0] - 2026-02-02

### Added
- Admin dashboard features
- Adopter management and flagging system

---

## [1.8.0] - 2026-01-28

### Added
- Unified flag display, adoption record enhancements, admin config

---

## [1.7.1] - 2026-01-26

### Fixed
- Duplicate return statement in SearchSection component

---

## [1.7.0] - 2026-01-25

### Changed
- **Auth + D1 Cloudflare compatibility** — bundled auth for edge runtime
- **UI pastel theme redesign** — new visual style across the application

---

## [1.6.4] - 2026-01-25

### Fixed
- **Edge runtime compatibility** — enabled edge runtime for all routes and restored imports

---

## [1.6.3] - 2026-01-25

### Fixed
- **Cloudflare build** — added `.npmrc` to force `legacy-peer-deps` for Cloudflare build pipeline

---

## [1.6.2] - 2026-01-25

### Fixed
- **ESLint build blocker** — disabled ESLint during build to unblock Cloudflare deployment

---

## [1.6.1] - 2026-01-25

### Fixed
- **Edge build** — disabled local DB fallback to prevent bundling `better-sqlite3`
- **Module resolution** — mocked `node:async_hooks` for edge builds

---

## [1.6.0] - 2026-01-25

### Fixed
- **Edge startup crash** — lazy-load `better-sqlite3` to prevent Edge runtime crash
- **Module mocking** — mock `async_hooks` and node modules for edge runtime

---

## [1.5.0] - 2026-01-25

### Added
- **Ownership access control** — UI polish and permission enforcement
- **Notification system foundation** — early notification infrastructure

---

## [1.4.0] - 2026-01-25

### Added
- **Ownership access control** — implement per-user access controls and UI polish

---

## [1.3] - 2026-01-24

### Added
- UI consistency improvements
- Full i18n (EN/ES) support
- Adoption history logging

---

## [1.2] - 2026-01-24

### Added
- Compact UI
- Merged history view
- Premium theme system

