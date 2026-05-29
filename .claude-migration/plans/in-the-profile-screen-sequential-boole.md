# Public Animal Showcase + Adoption-form skip-steps

## Context

BuenAdoptante is a vetting tool for rescuers; adopters being rated are kept out of the registry (per the v2.14.9-14 login gate). But adopters need a way to **discover** animals available for adoption in the first place — that's the funnel top.

Today the only animal-listing surface is `/my-animals`, which is auth-only and shows the logged-in rescuer their own animals. There's no public catalog where someone considering adopting can browse.

This change adds a **public showcase** to the existing Vite contract-app (same domain as forms + contracts). Four new public URL shapes:
- `/` (root) — global catalog of all available animals (replaces today's "no animalId" error card)
- `/org/[slug]` — animals from one organization
- `/user/[handle]` — animals from one rescuer
- `/animal/[id]` — animal detail page

Clicking an animal opens the detail page; clicking "Adoptar" opens the existing adoption form with steps 2/3/4 (species / lifeStage / specialNeeds) **skipped entirely** since the animal is already chosen.

Routing constraint: the current Vite app treats `/{anything}` as a contract page (where `anything` is an animalId). The new top-level paths `/org/`, `/user/`, `/animal/` would collide. Mitigated by tightening the contract-route match to a UUID regex (animalIds are 36-char UUIDs) and routing UUID-shaped paths to the contract page first, named paths to their respective views.

The tension with the adopter-login gate is intentional: adopters can see **animal data**, never adopter data / ratings / flags. Strict whitelist on the public API.

## Decisions signed off

| # | Decision | Choice |
|---|---|---|
| 1 | URL scopes | **All three, no `/showcase` prefix**: `/` (global), `/org/[slug]`, `/user/[handle]`, plus `/animal/[id]` for detail |
| 2 | Steps 2/3/4 | **Skip entirely** when `?animal={id}` URL param present. Submission attaches animalId. |
| 3 | Click flow | List → animal detail → Adoptar → form (not list → form directly) |
| 4 | SEO | **Index with OG tags**. Best-effort in the Vite SPA (see "Tech-stack call" below). |
| 5 | Empty state | **Polished, not just text**. Designed component with illustration + Instagram CTA. |
| 6 | Instagram URL | **Configurable from admin/config** (global `INSTAGRAM_URL` in `app_config`). Empty-state CTA only renders if set. |
| 7 | Where rescuers find their showcase URLs | **On `/my-animals` page** — copyable URL chips, **each gated by its own feature flag** (`SHOWCASE_GLOBAL_VISIBLE`, `SHOWCASE_ORG_VISIBLE`, `SHOWCASE_USER_VISIBLE`). All default `false` so the URLs stay hidden until an admin enables each. |
| 8 | Slug / handle collision | **Integer suffix only**. First "Gatitos de Olivos" → `gatitos-de-olivos`. Second → `gatitos-de-olivos-2`. Third → `gatitos-de-olivos-3`. Same rule for `user_profiles.handle`. No hash. |

## Approach

### A. Schema additions

- **`organizations.slug`** — TEXT NOT NULL UNIQUE. Kebab-cased shareable identifier (e.g. `gatitos-de-olivos`). Generated from `name` on org creation; backfilled for existing orgs in the migration. **No hash suffix.** Collisions resolved by appending the smallest integer ≥ 2 that produces a unique slug (`-2`, `-3`, etc.). Helper `generateUniqueSlug(rawName, lookupExists)` in `src/lib/slugify.ts` handles the increment-on-collision loop.
- **`user_profiles.handle`** — TEXT UNIQUE (nullable for legacy rows). Generated lazily by `ensureUserProfile()` using the same `generateUniqueSlug` helper. Stable once assigned.
- **`app_config`** row `INSTAGRAM_URL` — public, configurable in `/admin/config`. Migrates trivially (no new column; just a config row).
- **`app_config`** rows `SHOWCASE_GLOBAL_VISIBLE`, `SHOWCASE_ORG_VISIBLE`, `SHOWCASE_USER_VISIBLE` — three feature flags gating URL-chip visibility on `/my-animals`. Defaults `false`; admin enables each independently.

Migration file: `drizzle/0041_showcase_slugs.sql`.

### B. Public API (Next.js, edge runtime)

Endpoints keep the `/api/showcase/` namespace (server-side organization clarity); only the public Vite-app URLs drop the `/showcase` prefix. Whitelist-only field projection (mirrors `/api/contract/[id]` pattern). Cache-Control `public, max-age=60, stale-while-revalidate=600` on all GET responses.

- **`GET /api/showcase/all`** — paginated (cursor or offset), all `recordType='available'` rows with `adopterId IS NULL` and `deletedAt IS NULL`. Returns animal data + images + rescuer display info (org name if any, else user display name — never email). Backs the Vite `/` route.
- **`GET /api/showcase/org/[slug]`** — same shape, scoped by joining `orgMembers.userEmail` ↔ `adoptions.addedBy` for the resolved orgId. Backs the Vite `/org/[slug]` route.
- **`GET /api/showcase/user/[handle]`** — same shape, scoped by `adoptions.addedBy = userEmail` where `userEmail = user.email` for `userProfiles.handle = :handle`. Backs the Vite `/user/[handle]` route.
- **`GET /api/showcase/animal/[id]`** — single-animal detail. Same field whitelist. Includes the rescuer's display name + (if present) Instagram URL + the showcase URL of their org / handle so the detail page can link back. Backs the Vite `/animal/[id]` route.

**Hard whitelist** (no rescuer email, no adopter data, no flags, no ratings, no `comments` field since it may contain free-text PII):

```
id, animalName, species, age, estimatedBirthDate, sex, neutered,
color, microchip, details, date (listed-at),
images: [{ url, caption }],
rescuer: { displayName, orgName?, orgSlug?, userHandle? }
```

### C. Vite contract-app — new routes + components

`contract-app/src/App.tsx` already does pathname-based routing. Restructure the route matcher so UUID-shaped paths still go to ContractPage (preserving the existing `/{animalId}` contract flow), and named-prefix paths route to the new views:

- `/` → `Showcase` (scope='all') — **replaces today's "no animal ID" error card**
- `/org/:slug` → `Showcase` (scope='org')
- `/user/:handle` → `Showcase` (scope='user')
- `/animal/:id` → `AnimalDetail`
- `/{uuid}` → existing `ContractPage` (unchanged; UUID regex check happens first)
- `/form`, `/terms` → unchanged
- anything else → 404 / error card

**New components** in `contract-app/src/`:
- `Showcase.tsx` — list page; fetches the right API per scope; renders a card grid + header + empty state
- `AnimalDetail.tsx` — hero photo, gallery, species/age/sex/neutered/color/microchip badges, details paragraph, "Adoptar" CTA
- `components/AnimalCard.tsx` — reusable card (photo, name, badge row, hover state)
- `components/EmptyShowcase.tsx` — illustration + "sin animales disponibles" + Instagram button (only if INSTAGRAM_URL configured)
- `components/ShowcaseHeader.tsx` — title + animal count + share button

**Design system reuse**: all new components use the existing `ps-card`, `ps-btn--primary`, `ps-btn--ghost`, `ps-input`, color tokens (`--ps-bg`, `--ps-card`, `--ps-accent`) from `contract-app/src/petshield.css`. Add new minimal CSS for the card-grid layout and image-gallery — keep consistent with existing dark-indigo aesthetic.

### D. Form skip-steps integration

`contract-app/src/PetShieldForm.tsx` already handles URL params (`?u={userId}`). Extend:
- Read `?animal={animalId}` URL param at mount.
- When present:
  - Filter `DEFAULT_SCHEMA` to remove steps with `id === 'species'`, `lifeStage`, `specialNeeds` (steps 2/3/4 per the recon).
  - Pre-populate `answers.animalId = animalId` so it's included in the submit body.
  - Header shows "Aplicando para Luna" (animal name pulled from `/api/showcase/animal/[id]`) for visual anchoring.
- Submit body now includes `animalId` → backend pairs it with the form submission.

### E. Submit endpoint extension

`src/app/api/form/[userId]/submit/route.ts`:
- Accept new optional `animalId` field in request body.
- If present, attach to the `formSubmissions` row (new column `selected_animal_id` — schema addition; nullable).
- The rescuer notification body now includes the animal name + thumbnail when the submission was animal-specific: *"X aplicó para adoptar a Luna"* vs the current generic *"X completó el formulario"*.

`formSubmissions` schema: add `selectedAnimalId TEXT` nullable column. Migration in `0041_showcase_slugs.sql` alongside the slug/handle additions.

### F. `/my-animals` integration — URL copy chips, feature-flagged

`src/app/my-animals/page.tsx` — at the top, render a small "Tu showcase público" section with copyable URL chips. **Each chip is gated by its own feature flag**:

- **`SHOWCASE_GLOBAL_VISIBLE`** (default `false`) — when on, show the **`/`** root URL — "todos los animales en adopción"
- **`SHOWCASE_USER_VISIBLE`** (default `false`) — when on, show **`/user/[handle]`** (assuming the user has a handle, which they will after first login post-deploy) — "mis animales"
- **`SHOWCASE_ORG_VISIBLE`** (default `false`) — when on, show **`/org/[slug]`** for each org the user belongs to — "[Org name]"

If all three flags are off, the entire "Tu showcase público" section is hidden (no empty header). Mobile: stacked. Desktop: inline. Each chip: a small URL preview + a copy-to-clipboard button + a "Compartir" affordance.

Standard 5-place plumbing per `feedback_feature_flag_5_place.md` for each flag:
1. `src/config/features.ts` — `FEATURE_FLAGS` + `getAllFeatureFlags`
2. `src/app/api/admin/config/route.ts` — admin GET response
3. `src/app/admin/config/page.tsx` — UI toggles + state + hydration
4. `src/i18n/locales/{es,en}.ts` — `admin.flag_label_showcase_*` + `_desc_*`
5. `src/app/api/config/route.ts` — `PUBLIC_FLAG_KEYS` (the `/my-animals` page renders client-side and reads from `/api/config`)

### G. Admin config — Instagram URL

Follow the established 5-place flag plumbing (per `feedback_feature_flag_5_place.md`):
1. `src/config/features.ts` — N/A (this is a string, not a flag)
2. `src/app/api/admin/config/route.ts` — return `INSTAGRAM_URL` from app_config
3. `src/app/admin/config/page.tsx` — add an INSTAGRAM_URL text input
4. `src/i18n/locales/{es,en}.ts` — `admin.label_instagram_url` + `admin.desc_instagram_url`
5. **`src/app/api/config/route.ts`** — add `INSTAGRAM_URL` to `PUBLIC_FLAG_KEYS` so the Vite app's showcase pages can fetch it client-side (or include it in the showcase API responses directly, which is probably cleaner — TBD during impl)

### H. SEO + Open Graph

For `/showcase/*` and `/animal/[id]` routes:
- Server-render meta tags via static HTML in the Vite SPA's index.html template OR via Next.js if we route the showcase through Next.js instead of the Vite app. **Open question** — see "Open question" below.
- Per-animal: `og:title = "{name} busca hogar"`, `og:description = "{species} | {age} | {sex}"`, `og:image = first image URL`.
- Per-org: same shape, but with org info.
- Structured data (JSON-LD): `Pet` or `Product` schema for SEO ranking.

## Tech-stack call (engineer decision)

Spec: same domain as forms + contracts. That domain is currently the Vite contract-app deployment. Two ways to satisfy "same domain":

- **A. Build in the Vite app** (the literal-spec choice). Reuses `petshield.css` design tokens 1:1. SPA SEO is best-effort: meta tags injected client-side via React effects. Google indexes JS-rendered pages but slower / less reliably than SSR.
- **B. Build in Next.js, alias the routes onto the Vite-app domain via Cloudflare**. Better SEO (server-rendered meta + OG). But the Vite app is already a separate Cloudflare Pages project; re-routing a subset of paths to the Next.js worker would require a Cloudflare Worker route shim or a redirect/proxy, plus porting the indigo design tokens to Tailwind classes in Next.js. More moving parts, more deploy surface.

**Decision: A (Vite).** Reasons:
1. Visual consistency with forms + contracts is *the* CX win — petshield.css tokens are already there.
2. Routing-by-Cloudflare-worker-shim has its own deploy + caching complexity that's harder to debug than SPA-side meta tags.
3. SEO loss is real but acceptable for v1. Googlebot DOES execute JS; indexing will work, just slower than SSR. If indexing turns out to be load-bearing for adopter discovery, we revisit and consider option B as a Phase 2 refactor.

**SPA SEO mitigations** to include in v1:
- Set `document.title` and `<meta>` tags via React effects on each showcase / detail page mount.
- Open Graph tags injected client-side too (Twitter/Facebook crawlers run a headless browser, so OG previews work even without SSR).
- Animal detail pages link to a structured-data JSON-LD blob in a `<script type="application/ld+json">` — Google parses this regardless of render timing.
- Add a sitemap.xml served from the Next.js app listing all available animals; gives Google a discovery surface.

## Files to add/modify

**Schema + migration**
- `src/db/schema.ts` — `organizations.slug`, `user_profiles.handle`, `formSubmissions.selectedAnimalId`
- `drizzle/0041_showcase_slugs.sql` — migration with backfill SQL (apply `generateUniqueSlug` logic in a JS-driven backfill script if pure SQL is awkward)

**Next.js backend**
- `src/lib/slugify.ts` — NEW. Exports `generateUniqueSlug(rawName: string, exists: (slug) => Promise<boolean>): Promise<string>`. Kebab-cases the name, strips accents, removes special chars; loops with `-2`, `-3`, etc. until `exists` returns false. No hash.
- `src/lib/audit.ts` — extend `ensureUserProfile()` to auto-assign `handle` (via `generateUniqueSlug`) when missing.
- `src/app/actions/organizations.ts` — extend org creation/rename to set/update slug via `generateUniqueSlug`.
- `src/app/api/showcase/all/route.ts` — NEW
- `src/app/api/showcase/org/[slug]/route.ts` — NEW
- `src/app/api/showcase/user/[handle]/route.ts` — NEW
- `src/app/api/showcase/animal/[id]/route.ts` — NEW
- `src/app/api/sitemap.xml/route.ts` — NEW. Returns sitemap listing all available animal URLs + the global/org/user roots. SEO discovery surface for Google.
- `src/app/api/form/[userId]/submit/route.ts` — accept `animalId`, save to `selectedAnimalId`, include in notification body
- `src/app/my-animals/page.tsx` — URL copy chips section at top, each gated by its flag
- `src/config/features.ts` — three new flags: `SHOWCASE_GLOBAL_VISIBLE`, `SHOWCASE_ORG_VISIBLE`, `SHOWCASE_USER_VISIBLE` (default `false`)
- `src/app/api/admin/config/route.ts` — return the three flags + `INSTAGRAM_URL`
- `src/app/admin/config/page.tsx` — three toggles + Instagram URL text input
- `src/app/api/config/route.ts` — expose the three flags + `INSTAGRAM_URL` in `PUBLIC_FLAG_KEYS`
- `src/i18n/locales/{es,en}.ts` — `admin.flag_label_showcase_global/org/user` + descriptions, copy-chip labels, Instagram input labels

**Vite contract-app**
- `contract-app/src/App.tsx` — restructure route matcher: UUID regex check first (preserves existing `/{animalId}` contract flow), then named-path routes for `/`, `/org/:slug`, `/user/:handle`, `/animal/:id`, `/form`, `/terms`.
- `contract-app/src/Showcase.tsx` — NEW. Scope-aware list page. Fetches the right API per scope from `VITE_API_URL`. Sets `document.title` + OG meta tags via React effect for SEO.
- `contract-app/src/AnimalDetail.tsx` — NEW. Detail + Adoptar CTA. JSON-LD `Pet` structured data injected via `<script type="application/ld+json">`. OG meta with animal photo for social previews.
- `contract-app/src/components/AnimalCard.tsx` — NEW.
- `contract-app/src/components/EmptyShowcase.tsx` — NEW. Instagram CTA fallback (only renders when `INSTAGRAM_URL` resolves non-empty).
- `contract-app/src/components/ShowcaseHeader.tsx` — NEW. Title + count + share.
- `contract-app/src/PetShieldForm.tsx` — read `?animal={id}` param, skip steps 2/3/4, fetch animal name/photo for the "Aplicando para Luna" header anchor, attach animalId to submit body.
- `contract-app/src/petshield.css` — additions for card grid + image gallery (minimal, reuses existing tokens).
- `contract-app/index.html` — default OG fallback meta tags + viewport polish.

## Existing utilities reused

- **`/api/contract/[id]`** at `src/app/api/contract/[id]/route.ts` — model for public field whitelisting. Mirror its CORS + Cache-Control pattern.
- **`/api/badge/[orgId]`** — precedent for public org-scoped endpoints.
- **`ensureUserProfile()`** in `src/lib/audit.ts` — entry point for assigning the new `handle` on first sign-in.
- **petshield.css design tokens** — every new Vite component reuses `--ps-bg`, `--ps-card`, `--ps-accent`, `.ps-btn--primary`, etc. Visual consistency for free.
- **`localStorage.petshield_draft`** — the form's existing draft persistence already handles URL-param-initiated sessions; no change needed.
- **CLAUDE.md D1 patterns**: no `inArray()`, fan out with `Promise.all + eq` when fetching multiple animal images / org details.

## Verification

1. **Schema migration applies cleanly** on staging. Backfilled slugs for existing orgs are unique and human-readable.
2. **Public endpoints**: hit each `/api/showcase/*` route as anonymous (no session cookie). Confirm responses contain only the whitelisted fields — no `addedBy`, no adopter info, no flags. Use the same fixture data the e2e tests use.
3. **Showcase pages render** in the Vite app:
   - `/showcase/all` shows all animals
   - `/showcase/org/<existing-org-slug>` shows that org's
   - `/showcase/user/<existing-user-handle>` shows that user's
   - `/animal/<id>` shows detail
   - All match the petshield indigo dark aesthetic (no off-palette colors).
4. **Adopt flow end-to-end**: from `/showcase/all`, click animal → detail → Adoptar → form opens with steps 2/3/4 skipped → submit → rescuer receives a notification with the animal name.
5. **Empty state**: visit a showcase URL for an org with no available animals — see the polished empty state with Instagram CTA (only if `INSTAGRAM_URL` is set; otherwise just the "no animals" message).
6. **URL copy chips on `/my-animals`** — copy each, paste in an incognito browser, confirm the showcase loads with the expected scope.
7. **SEO**: use `curl -A "Googlebot" https://staging.../animal/<id>` to verify the meta tags. Per the SEO trade-off in "Open question", this is best-effort in v1.
8. `npx tsc --noEmit` clean.
9. `npm run lint` no new warnings beyond ratchet.
10. Existing Playwright e2e tests pass — showcase is additive, shouldn't affect any auth-gated flow.

## Out of scope (Phase 2+)

- **Filtering/search** on showcase lists (by species, age range, sex). v1 ships chronological-only.
- **Per-org/per-user Instagram override** — only global Instagram URL in v1. Per-entity overrides come later if requested.
- **QR-code generator** for shareable physical flyers.
- **Email notification to the rescuer** on form submission (currently in-app only; the existing notification flow stays).
- **Adopter side**: no account, no "favorites", no follow-an-animal-for-updates. Anonymous browsing only.
- **Animal status updates** (sold/reserved/adopted) visible on the showcase. v1 shows everything with `recordType='available' AND deletedAt IS NULL` — once an animal is given the `recordType='adoption'` treatment, it falls out of the showcase naturally.
- **Internationalization of showcase pages** beyond ES — copy is hardcoded ES for v1 since EN is best-effort everywhere else.
- **Phase-out of `/api/contract/[id]`** in favor of the new `/api/showcase/animal/[id]` — they're functionally similar but serve different surfaces (contract flow vs. browsing). Coexist for now.

## Risks I'd raise

- **Adopter-data leakage** via the public APIs is the biggest risk. Mitigated by hard field whitelist + reviewing every API response in the verification step. Worth adding e2e assertions that no email patterns appear in the response body.
- **Bundle size** (v2.14.9-19 lesson): the Vite app already deploys separately so its growth doesn't affect the Next.js worker bundle. But the showcase API routes ARE in the Next.js worker — each new `.func.js` adds ~50 KiB. Four new routes ≈ 200 KiB. Plenty of headroom post-Keystatic removal but watch for creep.
- **Slug collisions** for backfilled orgs/users: handled by appending a 4-char hash. Worst case the hash collides (1 in 65k) — unique constraint will fail the migration; we manually re-run with a different salt.
- **Animal staleness**: rescuer forgets to mark an adopted animal as `'adoption'` → showcase shows it as available. Operational hygiene issue, not a code issue. Surface a "last updated > 90 days" warning on the rescuer's own /my-animals row as a Phase 2 follow-up.
- **SEO best-effort in Vite**: see "Open question". If indexing turns out to matter and the SPA-side meta tags don't work, the showcase moves to Next.js as a Phase 2 refactor.
