# Plan — Guided demo walkthrough (mocked data, click-Next)

## Decision summary (locked with user, 2026-06-24)
- **Replaces** the driver.js spotlight tour. Reuse the `ENABLE_GUIDED_WALKTHROUGH` flag, the relaunch button, the new-user auto-launch, and the i18n scaffolding. **Remove** driver.js + the `data-walkthrough` markers + `WalkthroughProvider`'s spotlight logic.
- **Data = real `adopters` rows** (3), **soft-deleted from creation** (`deletedAt` SET) + a new **`isDemo`** marker. Soft-delete means every existing `isNull(adopters.deletedAt)` query (~12 sites) excludes them for free — no scattered new filters. The walkthrough + a small admin panel fetch them **by `isDemo`**, bypassing the deletedAt guard.
- **No child rows** (no seeded `adoptions` / `adopterFlags` / `duplicateTokens` / `adopterStats`). The card's derived display values (avgRating, flags, stats) come from a **display overlay** (code-default fixtures, optional `appConfig` override), NOT from the real enrichment pipeline. This avoids the child-row leak paths (adoption-search, global analytics counts, token index) entirely.

## Why no child rows (the subtlety)
A result card's `avgRating`, `flags` (verified_address, tooManyAdoptions…) and `stats` are NOT columns on `adopters` — they're computed by `enrichAdopters` from `adoptions`, `adopterFlags`, `duplicateCandidates`, `adopterStats`. Seeding those to make "rating 4 / verified address / 4 adoptions in 20 days" real would (a) be a lot of seed data and (b) reintroduce leak paths the parent soft-delete doesn't cover (e.g. `searchAdoptionMatches`, any global adoption count). So:
- The 3 real adopter rows provide only the **maskable PII** (name, contactEntries, addressInfo, isPublic, source, sourceUrl) — so the *Datos protegidos* masking demo is genuine via the real `maskAdopterContact`.
- A **display overlay** supplies `avgRating`, `AdopterFlags`, `stats` per demo id. The walkthrough builds each `DiscoveryMatch = { realMaskedAdopterRow, ...overlay }`.

## The 3 records
| id | name | rating (overlay) | flags (overlay) | PII | source |
|----|------|--------|-------|-----|--------|
| `demo-juan-bueno` | Juan BuenAdoptante | 4 | `verified_address` | gated (isPublic=0, real contactEntries → masked) | manual |
| `demo-juan-malo` | Juan MalAdoptante | 1 | — | public (isPublic=1 → contact shown unmasked) | imported, sourceUrl=facebook |
| `demo-juan-dudoso` | Juan Dudoso | 2 | `tooManyAdoptions {count:4, periodDays:20}` | gated | manual |

## Schema + seed
- `src/db/schema.ts`: add `isDemo: integer('is_demo').notNull().default(0)` to `adopters`.
- Hand-write `drizzle/NNNN_add_is_demo.sql`: `ALTER TABLE adopters ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;` (drizzle-kit generate hangs — hand-author per repo convention). Run schema-sync for local.
- **Seed via an idempotent admin action** (`seedWalkthroughDemo`), not the migration, so the content lives in code fixtures and re-seeds cleanly across envs. Upsert (INSERT OR REPLACE) the 3 rows with fixed ids, `isDemo=1`, `deletedAt=<fixed sentinel>`. The walkthrough data-fetch also falls back to the code fixtures if the rows don't exist yet (so auto-launch never renders empty before an admin seeds).

## Exclusion / safety
- Soft-delete covers the ~12 adopter surfaces automatically.
- **+1 filter:** `/admin/deleted` (Trash) — add `AND is_demo = 0` so demo rows don't clutter the trash list.
- **Tokenization:** skip when `isDemo=1` (defensive; the dup-token lookup already joins `deletedAt IS NULL`).
- The walkthrough fetch is a dedicated action `getWalkthroughDemoMatches(viewer)` that selects `where eq(isDemo,1)` (ignores deletedAt), runs the real `maskAdopterContact` against the viewer, attaches the overlay, returns `DiscoveryMatch[]`.

## Walkthrough UI (modal, click-Next)
- New `WalkthroughDemoModal` (client) — a centered modal/overlay "mini search results" surface; dark-mode themed via CSS vars. No driver.js, no MutationObserver, no live-DOM coupling.
- Steps advance on a **Next** button (Back/Close available):
  1. **Buscás "Juan"** — a mock search box pre-filled "Juan".
  2. **Resultados (3)** — the 3 cards render.
  3. **Juan BuenAdoptante** — rating 4 + verified address + *Datos protegidos* (its contact is really masked).
  4. **Juan MalAdoptante** — rating 1 + público (importado de Facebook → contacto a la vista).
  5. **Juan Dudoso** — rating 2 + alerta "4 adopciones en 20 días".
  6. **Cierre** — "Buscá siempre antes de entregar un animal."
- Copy: re-map the approved 5 concepts (Buscar / Calificación / Datos protegidos / Alertas / Historial) onto these steps. **Draft sent for approval before wiring** (same as the earlier copy round). Both locales.

## Card rendering
- Extract SearchSection's result-card JSX (lines ~399–470) into a shared `<AdopterResultCard match={DiscoveryMatch} demo? />`. SearchSection uses it for real results; the demo modal uses it with `demo` (inert: no profile link, no login gate). Keeps masking/rating/flags rendering identical — no drift.
- Grep Playwright selectors that target result-card internals before/after the extract (tests aren't type-checked).

## Admin surface
- `/admin/walkthrough` panel (or a section in `/admin`): "Seed/reset demo data" button, an Edit form for each demo row's PII (reuses the adopter-form fields, loaded via the isDemo-bypass action), and editors for the overlay values (rating/flags/stats) saved to the `WALKTHROUGH_DEMO` appConfig JSON.

## Trigger / flag plumbing
- Reuse `ENABLE_GUIDED_WALKTHROUGH` (already plumbed ~11 spots). RelaunchButton → opens the modal. Auto-launch (new-user `walkthrough_pending`) → opens the modal. `playwright_test_mode` still suppresses auto-launch.

## Removal
- Delete `driver.js` dep, `WalkthroughProvider`'s driver/observer logic (keep a thin provider for flag + start()), `steps.ts` driver shape, `walkthrough.css` driver overrides, the 6 `data-walkthrough` markers in SearchSection, the css.d.ts driver subpath note. Keep RelaunchButton (re-point), i18n keys (re-map), the flag.

## Verification
- `npx tsc --noEmit`, `npm run lint` (≤125), e2e green.
- **Browser-verify** the modal end-to-end (the prior rounds proved inference isn't enough): seed → flag on → relaunch → Next through all steps; confirm BuenAdoptante's contact is masked and MalAdoptante's is not.
- Confirm a real search for "Juan" / a duplicate check / `/admin/adopters` do NOT return the demo rows (prove the soft-delete exclusion).
- Migration applies on staging.

## Open item for approval
- The per-step ES/EN copy (re-mapped from the approved 5 cards). APPROVED 2026-06-24.

## Future enhancement (deferred, user-noted 2026-06-24)
- Let a demo card be **clickable to open the real record** (its full profile) so the
  walkthrough can also teach the profile view. Deferred; the demo cards are inert for v1.
