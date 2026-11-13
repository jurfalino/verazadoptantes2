# Group Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Groups set a logo, optional banner, light/dark theme, one of 8 accent colours and Instagram/Facebook/website links; the public form, catalogues, animal page, thank-you screen and contract page (enadopcion.org) show the branding of the group the rescuer shares as.

**Architecture:** Branding lives on `organizations` (new columns). Which group a rescuer's pages carry is the existing `user_profiles.adoption_docs_source` («Al compartir, usar:»), with a new default for never-chosen single-group users. The Next app resolves branding server-side and adds a `branding` object to the public JSON responses the contract-app already fetches; the contract-app applies it as CSS custom properties + a `data-ps-theme` attribute. Everything is behind `ENABLE_GROUP_BRANDING`.

**Tech Stack:** Next.js 15 server actions + edge API routes, Drizzle/D1, R2 (`IMAGES_BUCKET`), Vite/React contract-app, Vitest (root + `contract-app/`), Playwright (API-level e2e against `next dev`).

**Spec:** `docs/superpowers/specs/2026-11-13-group-branding-design.md`. Reference prototypes: branch `prototype/group-branding` (`contract-app/src/proto/*`: palette values, light tokens, header CSS) and the dashboard mock in the session scratchpad (`dashboard-proto/organizations.html`, `settings.html`). Copy their values and layout, not their code structure.

## Global Constraints

- Public pages stay in `contract-app/`; never move them into the Next app.
- D1: never `inArray()` / array `IN (...)`; fan out with `Promise.all`.
- Every catch logs with the op's context (`orgId`, `actorEmail`, masked rescuer email on public routes via `maskEmail`), never silently swallows; user-facing errors show an errorId (`resolveErrorId(e, source)` / `userFacingMessage`).
- New i18n keys in **es + en + pt** (dashboard `src/i18n/locales/*.ts`; public `contract-app/src/i18n/catalogs/*.ts` has `es`/`en`/`pt` blocks). Spanish copy is rioplatense voseo.
- Flag `ENABLE_GROUP_BRANDING`, default `false`, registered in all 5 places (see Task 3). Flag off ⇒ every public response and every screen is byte-identical to today.
- Migrations are hand-written SQL in `drizzle/` (next free number; `0110` at time of writing — re-check `origin/staging`). Never run `drizzle-kit generate`.
- Never `git add -A`/`-u` (tracked `local.db` / sqlite files are the e2e seed); add explicit paths.
- Design rules: 8px grid, type scale {11,12,13,14,15,16,20,28}, 12px button radius / weight 700, 16px card radius, SVG icons with `currentColor`, tap targets ≥ 44px, colour never the only signal, themed Tailwind colours only in the dashboard.
- Palette (copy exactly; `d*` = dark-theme shades, `l*` = light-theme shades):

| id | name | d | dStrong | dHover | l | lStrong | lHover |
|---|---|---|---|---|---|---|---|
| violeta | Violeta | #818cf8 | #a5b4fc | #6366f1 | #4f46e5 | #4338ca | #3730a3 |
| azul | Azul | #60a5fa | #93c5fd | #3b82f6 | #2563eb | #1d4ed8 | #1e40af |
| turquesa | Turquesa | #2dd4bf | #5eead4 | #14b8a6 | #0f766e | #115e59 | #134e4a |
| verde | Verde | #4ade80 | #86efac | #22c55e | #15803d | #166534 | #14532d |
| naranja | Naranja | #fb923c | #fdba74 | #f97316 | #c2410c | #9a3412 | #7c2d12 |
| rosa | Rosa | #f472b6 | #f9a8d4 | #ec4899 | #be185d | #9d174d | #831843 |
| ambar | Ámbar | #fbbf24 | #fcd34d | #f59e0b | #b45309 | #92400e | #78350f |
| grafito | Grafito | #cbd5e1 | #e2e8f0 | #94a3b8 | #334155 | #1e293b | #0f172a |

  Defaults: theme `dark`, accent `violeta` (= today's look). Button text on accent: `#0f172a` in dark, `#ffffff` in light.

## Review Focus

1. **Forged group hint** — `?g=<slug>` of a group the rescuer is not in must never show that group's branding (falls back to the rescuer's own effective group). Pinned in Task 5 e2e.
2. **Rescuer left the chosen group / group deleted** — pages fall back to «Los míos» (no branding), never 500. Pinned in Task 1 (`effectiveDocsSource`, `pickBrandingOrgId`) and Task 5 e2e.
3. **Bad social input** — `javascript:` URLs, a Facebook URL pasted in the Instagram box, 500-char strings: rejected with the field named, never stored. Pinned in Task 1 `normalizeSocialLink` tests.
4. **Non-image or oversized upload** (SVG, HTML renamed `.png`, 20 MB photo) — refused with a message; R2 bucket is public so bytes are sniffed. Pinned in Task 4 test on `storeOrgImageDataUrl` input checks and the client compress step in Task 8.
5. **Branding lookup failure on a public page** — form/catalogue still render in today's look (branding `null`), logged as warn. Pinned in Task 4 (`resolveBrandingForRescuer` never throws) and Task 7 (form shows after the existing 3s timeout).

---

### Task 1: Domain — palette, link normalisation, effective source

**Files:**
- Create: `src/domain/groupBranding.ts`, `src/domain/groupBranding.test.ts`
- Modify: `src/domain/adoptionDocs.ts:254-275` (add `effectiveDocsSource`, change `serializeDocsSource`), `src/domain/adoptionDocs.test.ts`

**Interfaces:**
- Produces (`groupBranding.ts`):
  - `GROUP_THEMES = ['dark','light'] as const`, `type GroupTheme`
  - `ACCENTS: readonly Accent[]` (table above), `type AccentId`, `DEFAULT_THEME: GroupTheme = 'dark'`, `DEFAULT_ACCENT_ID: AccentId = 'violeta'`
  - `type SocialKind = 'instagram' | 'facebook' | 'website'`
  - `normalizeSocialLink(kind: SocialKind, raw: string): { ok: true; url: string | null } | { ok: false }`
  - `type BrandingFields = { theme: GroupTheme; accentId: AccentId; instagramUrl: string | null; facebookUrl: string | null; websiteUrl: string | null }`
  - `type BrandingInput = { theme: string; accentId: string; instagram: string; facebook: string; website: string }`
  - `sanitizeBrandingInput(input: unknown): { ok: true; value: BrandingFields } | { ok: false; field: 'theme' | 'accent' | SocialKind }`
  - `type PublicBranding = BrandingFields & { orgName: string; orgSlug: string | null; logoUrl: string | null; bannerUrl: string | null }`
  - `hasBranding(b: Omit<PublicBranding, 'orgName' | 'orgSlug'>): boolean` — true if any image/link set or theme/accent differ from defaults
  - `pickBrandingOrgId(a: { hintOrgId: string | null; memberOrgIds: readonly string[]; source: DocsSource }): string | null`
  - `ORG_IMAGE_KINDS = ['logo','banner'] as const`, `type OrgImageKind`, `ORG_IMAGE_MAX_DATA_URL = 3_000_000`, `LOGO_MAX_PX = 512`, `BANNER_MAX_PX = 1600`
- Produces (`adoptionDocs.ts`):
  - `effectiveDocsSource(raw: string | null | undefined, memberOrgIds: readonly string[], soleGroupDefault: boolean): DocsSource`
  - `serializeDocsSource(s)` now returns `'self'` for self (was `null`)

- [ ] **Step 1: Write failing tests** in `groupBranding.test.ts` and `adoptionDocs.test.ts`:

```ts
it('instagram: handle, @handle and profile URL all become the canonical URL', () => {
  for (const raw of ['michisdeltren', '@michisdeltren', 'https://www.instagram.com/michisdeltren/?hl=es'])
    expect(normalizeSocialLink('instagram', raw)).toEqual({ ok: true, url: 'https://instagram.com/michisdeltren' });
});
it('empty means no link', () => expect(normalizeSocialLink('website', '  ')).toEqual({ ok: true, url: null }));
it('rejects a facebook URL in the instagram box', () => expect(normalizeSocialLink('instagram', 'https://facebook.com/x')).toEqual({ ok: false }));
it('facebook: handle and fb.com/m. URLs normalise to facebook.com', () => {
  expect(normalizeSocialLink('facebook', 'michis.del.tren')).toEqual({ ok: true, url: 'https://facebook.com/michis.del.tren' });
  expect(normalizeSocialLink('facebook', 'https://m.facebook.com/michis.del.tren?ref=x')).toEqual({ ok: true, url: 'https://facebook.com/michis.del.tren' });
});
it('website: adds https, rejects other schemes and hostless text', () => {
  expect(normalizeSocialLink('website', 'michisdeltren.org')).toEqual({ ok: true, url: 'https://michisdeltren.org' });
  expect(normalizeSocialLink('website', 'javascript:alert(1)')).toEqual({ ok: false });
  expect(normalizeSocialLink('website', 'hola')).toEqual({ ok: false });
  expect(normalizeSocialLink('website', 'https://a.org/' + 'x'.repeat(300))).toEqual({ ok: false });
});
it('sanitizeBrandingInput names the bad field', () => {
  expect(sanitizeBrandingInput({ theme: 'pink', accentId: 'azul', instagram: '', facebook: '', website: '' })).toEqual({ ok: false, field: 'theme' });
  expect(sanitizeBrandingInput({ theme: 'light', accentId: 'oro', instagram: '', facebook: '', website: '' })).toEqual({ ok: false, field: 'accent' });
});
it('hasBranding is false for the defaults with nothing uploaded', () => {
  expect(hasBranding({ theme: 'dark', accentId: 'violeta', instagramUrl: null, facebookUrl: null, websiteUrl: null, logoUrl: null, bannerUrl: null })).toBe(false);
});
it('pickBrandingOrgId: a hint is used only for a member', () => {
  expect(pickBrandingOrgId({ hintOrgId: 'A', memberOrgIds: ['A', 'B'], source: { type: 'org', orgId: 'B' } })).toBe('A');
  expect(pickBrandingOrgId({ hintOrgId: 'X', memberOrgIds: ['A', 'B'], source: { type: 'org', orgId: 'B' } })).toBe('B');
  expect(pickBrandingOrgId({ hintOrgId: null, memberOrgIds: ['A'], source: { type: 'self' } })).toBe(null);
  expect(pickBrandingOrgId({ hintOrgId: null, memberOrgIds: [], source: { type: 'org', orgId: 'B' } })).toBe(null); // left the group
});
// adoptionDocs.test.ts
it('effectiveDocsSource: never-chosen + exactly one group + default on → that group', () => {
  expect(effectiveDocsSource(null, ['A'], true)).toEqual({ type: 'org', orgId: 'A' });
  expect(effectiveDocsSource(null, ['A'], false)).toEqual({ type: 'self' });
  expect(effectiveDocsSource(null, ['A', 'B'], true)).toEqual({ type: 'self' });
  expect(effectiveDocsSource('self', ['A'], true)).toEqual({ type: 'self' });
  expect(effectiveDocsSource('org:B', ['A', 'B'], true)).toEqual({ type: 'org', orgId: 'B' });
});
it('serializeDocsSource stores an explicit «Los míos» as self', () => expect(serializeDocsSource({ type: 'self' })).toBe('self'));
```

- [ ] **Step 2:** `npx vitest run src/domain/groupBranding.test.ts src/domain/adoptionDocs.test.ts` → FAIL (missing exports / `null` vs `'self'`).
- [ ] **Step 3:** Implement. Instagram handle regex `^[A-Za-z0-9._]{1,30}$`, hosts `instagram.com|www.instagram.com`; Facebook handle `^[A-Za-z0-9.]{5,50}$`, hosts `facebook.com|www.facebook.com|m.facebook.com|fb.com`, keep only the path's first segment (or `profile.php?id=N` kept whole); website max 200 chars, scheme `http:`/`https:` only, hostname must contain a dot. `pickBrandingOrgId` result must always be in `memberOrgIds`. Grep callers of `serializeDocsSource`/`parseDocsSource` (`git grep -n "DocsSource("`) and confirm `'self'` round-trips through `parseDocsSource`.
- [ ] **Step 4:** Re-run → PASS. Run full `npx vitest run src/domain` → PASS.
- [ ] **Step 5:** Commit `feat(branding): palette, link normalisation and effective share source (domain)`.

### Task 2: Schema + migration (+ «Los míos» backfill)

**Files:**
- Modify: `src/db/schema.ts` (`organizations`), `tests/seed.sql`
- Create: `drizzle/0110_group_branding.sql`

**Interfaces:**
- Produces columns on `organizations` (Drizzle name → SQL): `logoUrl`→`logo_url` text, `bannerUrl`→`banner_url` text, `brandTheme`→`brand_theme` text, `brandAccent`→`brand_accent` text, `instagramUrl`→`instagram_url` text, `facebookUrl`→`facebook_url` text, `websiteUrl`→`website_url` text, `brandingUpdatedAt`→`branding_updated_at` integer timestamp, `brandingUpdatedBy`→`branding_updated_by` text (email). All nullable; NULL theme/accent = defaults.

- [ ] **Step 1:** Write the migration: nine `ALTER TABLE organizations ADD COLUMN ...` plus the backfill that keeps explicit «Los míos» choices (today stored as NULL, indistinguishable from never-chosen):

```sql
UPDATE user_profiles SET adoption_docs_source = 'self'
WHERE adoption_docs_source IS NULL AND user_id IN (
  SELECT u.id FROM user u JOIN audit_log a ON lower(a.user_email) = lower(u.email)
  WHERE a.action = 'adoption_docs_source_changed' AND json_extract(a.details, '$.source') = 'self');
```
  Header comment: why, spec path, additive.
- [ ] **Step 2:** Mirror the columns in `schema.ts`. Seed (`tests/seed.sql`): new org `test-org-fixture-brand` («Refugio Marca E2E», slug `refugio-marca-e2e`, theme `light`, accent `naranja`, instagram/website set, logo `https://example.com/logo.jpg`); users `e2e-brand-solo@example.com` (only member of it, `adoption_docs_source` NULL) and `e2e-brand-two@example.com` (member of it and `test-org-fixture-1`, source `org:test-org-fixture-1`); one available listed animal `test-animal-fixture-brand` added by the solo user. Use `test-*-fixture-*` ids.
- [ ] **Step 3:** Apply locally per `.agents/workflows/schema-sync.md`; `npx wrangler d1 execute pet-adoption-db --local --command "PRAGMA table_info(organizations);"` shows the 9 columns. `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit `feat(branding): organizations branding columns + keep explicit «Los míos»`.

### Task 3: Feature flag `ENABLE_GROUP_BRANDING`

**Files:** `src/config/features.ts`, `src/app/api/admin/config/route.ts`, `src/app/admin/(admin-only)/config/page.tsx`, `src/lib/publicConfig.ts` (public keys + default `'false'`), `src/i18n/locales/{es,en,pt}.ts` (`flag_label_*`, `flag_desc_*`), Create `src/lib/groupBrandingFlag.ts`

**Interfaces:** Produces `fetchGroupBrandingFlag(): Promise<boolean>` (zero imports, same contract as `src/lib/adoptionDocsFlag.ts`).

- [ ] **Step 1:** `npx vitest run src/config/featureFlagRegistration.test.ts` after adding only the `FEATURE_FLAGS` entry → FAIL (not registered).
- [ ] **Step 2:** Register in the other places, copying `ENABLE_CUSTOM_ADOPTION_DOCS` line by line (`git grep -n ENABLE_CUSTOM_ADOPTION_DOCS -- src`). Desc copy (es): «Logo, portada, colores y redes de los grupos en el formulario y el catálogo públicos».
- [ ] **Step 3:** Re-run → PASS. Commit `feat(branding): ENABLE_GROUP_BRANDING flag (off)`.

### Task 4: Server side — repo, R2, server actions, effective source everywhere

**Files:**
- Create: `src/lib/groupBrandingRepo.ts`, `src/app/actions/groupBranding.ts`
- Modify: `src/lib/r2.ts` (add `storeOrgImageDataUrl`), `src/lib/adoptionDocsRepo.ts` (`getEffectiveDocsSource`; `resolveDocsForRescuer` uses it), `src/app/actions/adoptionDocs.ts` (`getAdoptionDocsOverview` uses it and returns branding summary per org), `src/lib/showcase.ts:126-146` (`buildPublicRescuer` org = effective group when flag on), `src/app/actions/index.ts` if barrel-exported
- Test: `src/lib/r2.orgImage.test.ts`, `tests/group-branding.spec.ts` (started here, extended in Task 5)

**Interfaces:**
- Consumes: Task 1 exports, Task 2 columns, `getMemberOrgIds`, `getUserDocsSource` raw read, `getFeatureFlag`.
- Produces:
  - `getEffectiveDocsSource(db: Db, email: string): Promise<{ source: DocsSource; memberOrgIds: string[] }>` (in `adoptionDocsRepo.ts`; sole-group default only when `ENABLE_GROUP_BRANDING` is on)
  - `getOrgBranding(db: Db, orgId: string): Promise<PublicBranding | null>`
  - `resolveBrandingForRescuer(db: Db, rescuerEmail: string | null | undefined, hintOrgSlug?: string | null): Promise<PublicBranding | null>` — flag off / no group / `!hasBranding` / any error ⇒ `null`; never throws; warn-logs with masked email
  - `resolveBrandingForOrgSlug(db: Db, slug: string): Promise<PublicBranding | null>`
  - `storeOrgImageDataUrl(dataUrl: string, orgId: string, kind: OrgImageKind): Promise<string | null>` — JPEG/PNG/WEBP only (type + magic bytes via the existing `isAllowedImageBytes`), ≤ `ORG_IMAGE_MAX_DATA_URL`, key `orgs/${orgId}/${kind}-${crypto.randomUUID()}.${ext}`
  - Server actions:
    - `getGroupBranding(orgId: string): Promise<{ success: boolean; data?: GroupBrandingView; error?: 'disabled' | 'forbidden' | 'generic'; errorId?: string }>` where `GroupBrandingView = BrandingFields & { logoUrl: string | null; bannerUrl: string | null; updatedAt: number | null; updatedByName: string | null }`
    - `saveGroupBranding(orgId: string, input: BrandingInput): Promise<{ success: boolean; field?: 'theme' | 'accent' | SocialKind; error?: 'disabled' | 'forbidden' | 'invalid' | 'generic'; errorId?: string }>`
    - `setGroupImage(orgId: string, kind: OrgImageKind, dataUrl: string | null): Promise<{ success: boolean; url?: string | null; error?: 'disabled' | 'forbidden' | 'invalid' | 'generic'; errorId?: string }>` (`null` removes)
    - All three: flag check → `'disabled'`; caller must be a member (`getMemberOrgIds`) → else `'forbidden'`; writes set `branding_updated_at/by`; `logAudit({ action: 'group_branding_changed', details: { orgId, fields } })`.
  - `getAdoptionDocsOverview` `orgs[]` items gain `branded: boolean; logoUrl: string | null`.

- [ ] **Step 1: Failing tests.** `r2.orgImage.test.ts`: `storeOrgImageDataUrl('data:image/svg+xml;base64,...', 'o', 'logo')` → `null`; a PNG-typed data URL whose bytes are `<html>` → `null`; a data URL longer than `ORG_IMAGE_MAX_DATA_URL` → `null` (stub `uploadToR2`/bucket so no network). `tests/group-branding.spec.ts` (unauthed project, API level, flag on via seed `app_config`): 

```ts
test('a single-group rescuer who never chose gets the group branding on the form API', async ({ request }) => {
  const body = await (await request.get(`/api/form/${SOLO_USER_ID}`)).json();
  expect(body.branding).toMatchObject({ orgSlug: 'refugio-marca-e2e', theme: 'light', accentId: 'naranja' });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement repo, R2 helper and actions. Switch `resolveDocsForRescuer` and `getAdoptionDocsOverview` to `getEffectiveDocsSource` (so docs and branding always agree). `buildPublicRescuer`: when flag on and the effective source is an org the poster belongs to, `orgName/orgSlug` come from it; else today's first-membership lookup. Do not add `branding` to the form API yet beyond what the test needs — Task 5 does the routes.
- [ ] **Step 4:** `npx vitest run src/lib src/domain` → PASS; `npx playwright test tests/group-branding.spec.ts tests/adoption-docs.spec.ts tests/adoption-docs-collab.authed.spec.ts` → PASS. If an adoption-docs spec relied on «NULL = own docs» for a single-group seeded user, set that user's seed source to `'self'` (that is the new meaning of an explicit choice) — don't weaken the test.
- [ ] **Step 5:** `node scripts/check-action-surface.mjs` → raise `EXPECTED_ACTIONS` by 3 **only once Task 8 references the actions** (Next records referenced actions only); note it in that task. Commit `feat(branding): resolve, store and edit group branding (server)`.

### Task 5: Public API responses carry `branding`

**Files:** `src/app/api/form/[userId]/route.ts`, `src/app/api/showcase/org/[slug]/route.ts`, `src/app/api/showcase/user/[handle]/route.ts`, `src/app/api/showcase/animal/[id]/route.ts`, `src/app/api/contract/[id]/route.ts`, `src/app/api/contract/by-token/[token]/route.ts`; Test `tests/group-branding.spec.ts`

**Interfaces:** Each JSON body gains `branding: PublicBranding | null`. Form and animal routes accept `?g=<orgSlug>` as a hint (passed to `resolveBrandingForRescuer`). Org route: `resolveBrandingForOrgSlug(slug)`. User route: owner's effective group. Contract routes: owner = `animal.addedBy`. Flag off ⇒ the `branding` key is **omitted**, so responses stay byte-identical (Global Constraints); flag on ⇒ always present (`null` when there is nothing to show).

- [ ] **Step 1: Failing e2e tests** (add to `tests/group-branding.spec.ts`):
  - `GET /api/form/${TWO_USER_ID}?g=refugio-marca-e2e` → `branding.orgSlug === 'refugio-marca-e2e'` (member, hint wins over chosen `test-org-fixture-1`, which has no branding).
  - `GET /api/form/${SOLO_USER_ID}?g=refugio-e2e` (not a member) → `branding.orgSlug === 'refugio-marca-e2e'` (hint ignored).
  - `GET /api/showcase/org/refugio-marca-e2e` → `branding.logoUrl === 'https://example.com/logo.jpg'`; `GET /api/showcase/org/refugio-e2e` → `branding === null` (no branding set).
  - `GET /api/showcase/animal/test-animal-fixture-brand` → `branding.orgSlug === 'refugio-marca-e2e'` and `animal.rescuer.orgSlug === 'refugio-marca-e2e'`.
  - A member who left: run with a seeded user whose source is `org:test-org-fixture-brand` but no membership row → `branding === null`, status 200.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (one `resolveBranding*` call per route, inside the existing try; contract routes keep their light page — only data is added). **Step 4:** Run → PASS; run `tests/catalogue.unauthed.spec.ts tests/forms.spec.ts tests/contract-link.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(branding): public form/showcase/contract responses carry the group branding`.

### Task 6: contract-app — palette mirror, light theme tokens, `applyBranding`

**Files:**
- Create: `contract-app/src/lib/branding.ts`, `contract-app/src/lib/branding.test.ts`, `src/domain/groupBranding.mirror.test.ts`
- Modify: `contract-app/src/petshield.css`

**Interfaces:**
- Produces: `type PublicBranding` (same shape as Task 1), `ACCENTS` (mirror), `brandingCssVars(b: PublicBranding): Record<string, string>` (keys `--ps-accent`, `--ps-accent-strong`, `--ps-accent-hover`, `--ps-text-accent`, `--ps-accent-glow-rgb` as `"r, g, b"`, `--ps-on-accent`), `applyBranding(b: PublicBranding | null, root?: HTMLElement): void` (null ⇒ removes `data-ps-theme` and the vars), `parseBranding(raw: unknown): PublicBranding | null` (drops anything malformed / unknown accent → null).

- [ ] **Step 1: Failing tests.** `branding.test.ts`: `brandingCssVars({ theme: 'light', accentId: 'naranja', ... })['--ps-accent'] === '#c2410c'` and `--ps-on-accent === '#ffffff'`; dark naranja → `#fb923c` / `#0f172a`; `--ps-accent-glow-rgb` for `#c2410c` → `'194, 65, 12'`; `parseBranding({ theme: 'light', accentId: 'oro' })` → `null`. Mirror test: ids and the six hexes per accent in `contract-app/src/lib/branding.ts` equal `ACCENTS` in `src/domain/groupBranding.ts` (regex-read the file, as `adoptionDocs.mirror.test.ts` does).
- [ ] **Step 2:** `cd contract-app && npx vitest run src/lib/branding.test.ts` and root `npx vitest run src/domain/groupBranding.mirror.test.ts` → FAIL.
- [ ] **Step 3:** Implement. In `petshield.css`: add `--ps-on-accent: #0f172a` to `:root`; add the `:root[data-ps-theme="light"]` token block (values from `prototype/group-branding:contract-app/src/proto/proto.css`); replace the hard-coded values with tokens — `.ps-btn--primary { color: var(--ps-on-accent) }`, check-mark strokes (`PetShieldForm.tsx` `stroke="#0f172a"` → `style={{ stroke: 'var(--ps-on-accent)' }}`), `rgba(99, 102, 241, …)` → `rgba(var(--ps-accent-glow-rgb), …)` (`.ps-showcase-card:hover`, `.ps-showcase-card__photo`, `.ps-animal-hero`, `.ps-animal-badge`, `.ps-form-animal__photo--empty`, `.ps-home-card-skeleton__photo`), and a light override for `.ps-nav` / `.ps-animal-cta-sticky` backgrounds and `.ps-showcase-card__photo-fade`. With no `data-ps-theme` set, computed styles must equal today's.
- [ ] **Step 4:** Tests → PASS; `cd contract-app && npx tsc --noEmit && npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(branding): contract-app light theme tokens + applyBranding`.

### Task 7: contract-app — header, links, pages

**Files:**
- Create: `contract-app/src/components/BrandHeader.tsx` (exports `BrandHeader`, `BrandBar`, `BrandLinks`, `BrandLogo`), `contract-app/src/brand.css` (pb-* styles from the prototype, imported in `main.tsx`)
- Modify: `contract-app/src/Showcase.tsx`, `contract-app/src/components/AnimalCard.tsx` (link carries `?g=`), `contract-app/src/AnimalDetail.tsx`, `contract-app/src/PetShieldForm.tsx`, `contract-app/src/ContractPage.tsx`, `contract-app/src/i18n/catalogs/{showcase,form,contract}.ts`
- Test: `contract-app/src/lib/brandLinks.test.ts` (pure helper `withGroupHint(href: string, slug: string | null): string`) in `contract-app/src/lib/brandLinks.ts`

**Interfaces:** Consumes `parseBranding`, `applyBranding` (Task 6) and the `branding` key (Task 5).

- [ ] **Step 1: Failing test:** `withGroupHint('/animal/abc?lang=en', 'refugio')` → `'/animal/abc?lang=en&g=refugio'`; `withGroupHint('/form?u=1', null)` → `'/form?u=1'`. Run → FAIL; implement; PASS.
- [ ] **Step 2:** Pages (each: `applyBranding(parseBranding(body.branding))` when the response arrives):
  - **Org/user catalogue:** `branding` ⇒ `BrandHeader` (banner `height: clamp(120px, 33vw, 280px)`, 72px logo overlapping the banner by 36px, name, subtitle, count, links) instead of `ShowcaseHeader`; `/all` unchanged. Org catalogue cards link with `withGroupHint(…, scope.slug)`.
  - **Animal:** `BrandBar` (40px logo + name) above the back link; read `g` from the URL and pass it to the API and into the adopt link (`/form?u=…&animal=…&g=…`).
  - **Form:** pass `g` to `/api/form/…`; **hold rendering behind a neutral loading screen until the existing config fetch settles** (it already times out at 3s and falls back to standard); then `BrandBar` above the step container. Thank-you screen: logo + «Mientras tanto, seguí a {name}» + `BrandLinks` (labelled).
  - **Contract page:** logo + group name in its header and the accent on its primary button only; page stays white (no `data-ps-theme`).
  - Links: `target="_blank" rel="noopener noreferrer"`, only set ones, ≥ 44px, 3-column grid at < 768px.
  - New strings (es/en/pt): `showcase.follow_*`, `form.follow_title` («Mientras tanto, seguí a {name}»), link labels «Instagram», «Facebook», «Sitio web» / «Website» / «Site».
- [ ] **Step 3:** `cd contract-app && npx tsc --noEmit && npx vitest run && npm run build` → PASS. Local look check against the prototype screenshots (dark + light, 390 + 1280, scrollWidth == clientWidth) is a smoke test only — real verification is on staging (Task 10).
- [ ] **Step 4:** Commit `feat(branding): group header, links and theme on the public pages`.

### Task 8: Dashboard — «Personalizar» on each group card

**Files:**
- Create: `src/components/GroupBrandingSection.tsx`, `src/components/GroupBrandingPreview.tsx`
- Modify: `src/app/organizations/page.tsx` (OrgCard, flag via `fetchGroupBrandingFlag`), `src/i18n/locales/{es,en,pt}.ts` (`groupBranding.*`), `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS` +3)
- Test: `tests/group-branding.authed.spec.ts`

**Interfaces:** Consumes `getGroupBranding`, `saveGroupBranding`, `setGroupImage` (Task 4), `ACCENTS`/`GROUP_THEMES` (Task 1), `compressImage(file, maxSize)` from `src/lib/imageCompress.ts` (logo `LOGO_MAX_PX`, banner `BANNER_MAX_PX`).

- [ ] **Step 1: Failing e2e** (authed, member of `test-org-fixture-1`): open `/organizations`, expand «Personalizar» (`data-testid="group-branding-toggle"`), choose «Claro» and «Turquesa», type `@refugioe2e` in Instagram, Guardar → success toast; reload → still selected and `GET /api/showcase/org/refugio-e2e` returns `branding.accentId === 'turquesa'`. Typing `javascript:x` in Sitio web → inline error on that field, nothing saved. Use the existing fixture org; reset its columns in the test's teardown.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Build per the dashboard mock: collapsed `<details>`-style row «Personalizar · Logo, colores y redes»; intro «Así ven a tu grupo los adoptantes en el formulario y el catálogo. Todo es opcional. Lo puede cambiar cualquier miembro.» + «Se usa cuando un miembro elige «Los de {grupo}» al compartir.» + «Ver en Configuración» link (`/settings#adoption-docs`); Logo (camera-badge affordance from `AdopterForm.tsx`, Cambiar/Quitar); Portada · opcional (3:1 frame, Cambiar/Quitar, empty state «Agregar portada»); Redes y sitio web (3 inputs, 16px text, leading SVG icon); Fondo (Oscuro / Claro radio cards); Color (8 swatches, 4 per row < 768px, selection = check + ring + bold name); Vista previa (`GroupBrandingPreview`, same header as the public page, swatch dots show the shade for the chosen Fondo with a 1px ring so Grafito/Ámbar stay visible); Guardar; «Última edición: {name}, {date}». Images upload on pick (`setGroupImage`), the rest saves with Guardar. Errors: toast with errorId.
- [ ] **Step 4:** e2e → PASS; `node scripts/check-action-surface.mjs` → PASS with `EXPECTED_ACTIONS` +3. Commit `feat(branding): Personalizar section on group cards`.

### Task 9: Settings — «Al compartir, usar:» also decides the look

**Files:** `src/components/AdoptionDocsSettingsSection.tsx`, `src/i18n/locales/{es,en,pt}.ts`; Test: extend `tests/group-branding.authed.spec.ts`

**Interfaces:** Consumes `getAdoptionDocsOverview` `orgs[].branded/logoUrl` (Task 4), `fetchGroupBrandingFlag`.

- [ ] **Step 1: Failing e2e:** with the flag on, `/settings#adoption-docs` shows the hint «Elegí qué formulario y contrato se envían cuando compartís un link, y con qué logo, colores y redes los ven los adoptantes (también en tu catálogo).», each row has its sub-line («Aspecto estándar de BuenAdoptante» / «Con el logo, los colores y las redes del grupo» / «El grupo todavía no cargó logo ni colores») and the «Logo y colores de los grupos» link; choosing «Los míos» then reloading keeps «Los míos» selected (stored as `'self'`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement: 32px thumbnail (group logo, initials tile, or person icon for «Los míos») + sub-line per row; flag off ⇒ today's markup exactly. **Step 4:** PASS. Commit `feat(branding): sharing choice shows and sets the look`.

### Task 10: Release prep and verification

- [ ] **Step 1: Production impact count (read-only, pre-authorized):** `npx wrangler d1 execute pet-adoption-db --remote --command "<query>"` counting users with `adoption_docs_source IS NULL` (after the Task 2 backfill logic, i.e. excluding audit-log «self» choosers) and exactly one `org_members` row, and how many of those groups have an `adoption_doc_settings` row (customised form/contract). Report both numbers to Jon before the flag goes on.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint` (≤ ratchet), `npx vitest run`, `cd contract-app && npx vitest run && npm run build`, `npm run build`, full `npx playwright test` → all PASS (record output).
- [ ] **Step 3:** Follow `.agents/workflows/deploy.md`: version bump above `origin/staging`, CHANGELOG entry, list `origin/staging..HEAD` before pushing; push to `staging` only when Jon says to ship. The contract-app deploys via its own workflow (`contract-app.yml`) — run it for staging after the Next deploy is live (the public app needs the new API fields first; with `branding` absent it renders as today).
- [ ] **Step 4:** On staging with the flag on: walk form → thank-you, group catalogue, animal, contract in both themes at 390 and 1280 (scrollWidth == clientWidth), forged `?g=`, and flag off = today. Independent review before production (this touches public routes).
