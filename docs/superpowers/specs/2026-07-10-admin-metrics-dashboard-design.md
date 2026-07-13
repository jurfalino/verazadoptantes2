# Admin Metrics Dashboard — Design

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan
**Author:** Jon + Claude

## Goal

A dedicated `/admin/metrics` page that visualizes operational health and product
usage as **time-series charts** sourced from Axiom, replacing reliance on the
compact numbers-and-lists summary on the `/admin` landing. Hand-rolled SVG charts,
an interactive period selector, env-scoped, graceful degradation.

## Context — what already exists

The query-side of Axiom is **already built and live** since v2.14.9-12:

- `src/lib/axiom.ts` — query helper using `AXIOM_QUERY_TOKEN` (query scope, distinct
  from the ingest `AXIOM_TOKEN` in `logger.ts`). Handles auth, the legacy-API flat-field
  quirk, compound filters, **auto env-scoping** (`getCurrentEnv()` so staging `/admin`
  sees staging only), a 5-min per-worker cache, and null-degradation (Axiom failure →
  caller renders "no disponible", never crashes the page).
- Existing typed wrappers: `getErrorsCount`, `getTopErrors`, `getTraceLatencies`,
  `getActiveRescuers`, `getAxiomDeepLinkUrl`.
- `src/app/admin/page.tsx` already renders these as flat totals + top-N lists.
- All four Axiom secrets (`AXIOM_QUERY_TOKEN`, `AXIOM_ORG_SLUG`, `AXIOM_DATASET`,
  `AXIOM_TOKEN`) are set on the `verazadoptantes2` Pages project, which serves **both**
  `buenadoptante.org` (prod) and staging — so the feature works in every environment.

This design **extends** that foundation with time-bucketed series + a dedicated
charted page. It does not replace the existing landing summary.

## Scope

**In:**
- New `src/app/admin/metrics/page.tsx` + client island + SVG chart primitives.
- New time-series data function in `axiom.ts` (`getTimeSeries`) + centralized metric defs.
- Interactive `24h / 7d / 30d` period control.
- Seven metric cards (4 ops, 3 usage) — see Metric Set.
- A targeted cache-key fix in `axiom.ts` (rounded window boundaries).

**Out (YAGNI / later):**
- Alerting/monitors (Axiom has its own).
- Custom date-range picker beyond the three presets.
- Per-user drilldowns; export/CSV.
- Touching the existing `/admin` landing metrics (left as-is).

## Architecture

### 1. Route & navigation
`src/app/admin/metrics/page.tsx` — server component, admin-gated by the existing
`/admin` middleware + admin check. Add a nav entry in the admin layout and a link
from the `/admin` landing.

### 2. Data layer — `src/lib/axiom.ts` additions

**`getTimeSeries(metric: MetricKey, window: Window): Promise<SeriesPoint[] | null>`**
- Returns **gap-filled** buckets `{ t: string; value: number }[]` — every bucket in the
  window is present; missing buckets are `0` (staging is sparse; raw Axiom output skips
  empty buckets and would distort the x-axis).
- Fetches via Axiom's **APL query endpoint** (`POST /v1/datasets/_apl`) with
  `… | summarize value = <agg> by bin(_time, <bucket>)`. APL is cleaner for binning than
  the legacy `resolution` param. Auth, env-scoping (`| where env == '<env>'`), and cache
  reuse the existing plumbing.
- **Window → bucket:** `24h → 1h`, `7d → 1d`, `30d → 1d`.
- Returns `null` on Axiom failure (caller degrades that card to "no disponible").

**Cache-key fix (targeted improvement):** the current cache keys on absolute
`startTime`/`endTime` from `new Date()` per request, so within the 5-min TTL two loads
produce different keys and almost never hit. Round the window's end boundary **down to
the bucket granularity** (hour or day) before building the query/key, so repeated loads
and period toggles inside the TTL cache correctly. Apply to the new series queries; the
existing total wrappers can adopt the same rounding opportunistically.

**Metric definitions** — one central `METRICS` map keyed by `MetricKey`, each entry
declaring: label, APL aggregation/filter, chart type, and deep-link filter. Single source
of truth so the page, the series fetch, and the deep-link stay consistent.

### 3. Interactive period control (chosen: interactive)
- Client island `src/components/admin/MetricsDashboard.tsx` owns `window` state
  (`'24h' | '7d' | '30d'`, default `7d`).
- First paint: the server component fetches the default-window payload and passes it as
  initial props (SSR, no loading flash).
- Toggling a period calls a server action **`fetchMetrics(window)`**
  (`src/app/actions/metrics.ts`) returning all cards' `{ series, total, prevTotal }` for
  that window. Per-toggle loading state on the cards. Rounded-window cache makes repeat
  toggles instant.

### 4. Charts — `src/components/charts/`
Pure inline SVG, no dependencies, edge-safe, driven by design tokens + 8px grid:
- `LineChart` — for count-over-time trends (errors, rescuers, imports).
- `BarChart` — for discrete daily/hourly counts (AI failures, activity, sign-in failures).
- `Sparkline` — compact variant if needed.
- Gap-aware (renders 0 buckets), minimal hover (endpoint dot + value label). ~100 lines each.

## Metric Set

Each card: **title · big total · trend vs. the immediately-prior equal-length period ·
chart · "Ver en Axiom →" deep-link** (via `getAxiomDeepLinkUrl`).

### Operational health
| Card | Chart | Source (APL filter) |
|---|---|---|
| Errores | line | `level == 'error'` |
| Fallos de IA (Gemini) | bar | `message == 'Gemini extraction failed'` |
| Fallos de inicio de sesión | bar | `message in ('next-auth error', 'auth-error page hit')` |
| Latencia p95 por operación | table | `summarize percentiles(duration, 50, 95) by trace` (reuse `getTraceLatencies`) |

### Product usage
| Card | Chart | Source (APL filter) |
|---|---|---|
| Rescatistas activos | line | distinct actor emails across `user`/`changedBy`/`email`/`userEmail` (reuse `getActiveRescuers` logic, bucketed) |
| Actividad registrada | bar | events carrying an actor `count()` — `isnotempty(user) or isnotempty(userEmail) or isnotempty(changedBy) or isnotempty(email)` (the broad "any user activity" signal; excludes system/trace-only noise) |
| Importaciones | line | import completion events (posts + spreadsheet) |

Notes:
- Sign-in failures verified in Axiom (last 30d): `auth-error page hit` (13), `next-auth error` (4).
- "Rescatistas activos" as a **bucketed** distinct-count needs one APL query per bucket-field
  union; keep the existing 4-field union approach but per bucket. If cost/complexity is high,
  fall back to a coarser daily distinct via a single `summarize dcount()` over a coalesced
  actor field — decide in the plan.

## Error handling
- Per-card null-degradation: a failed metric renders "no disponible" in that card only;
  the rest of the page and the other cards still render. One Axiom hiccup never blanks
  the dashboard. (Reuses the established pattern.)
- The server action wraps each metric fetch in `.catch(() => null)` so a single failing
  query never rejects the whole payload.

## Testing
- **vitest (pure):** `getTimeSeries` gap-fill (sparse Axiom rows → full bucket set),
  window→bucket mapping, boundary rounding, and trend math (current vs prior period %).
- **vitest:** `METRICS` deep-link filters produce the expected Axiom `_q` strings.
- **E2E (CI Playwright):** `/admin/metrics` loads for an authed admin; toggling a period
  updates the cards; non-admin is redirected. (Node 26 blocks local E2E — validate logic
  via vitest, let CI run Playwright.)
- Charts are pure SVG functions of their data — covered by a couple of render-shape unit
  checks, not pixel snapshots.

## File-by-file
- `src/lib/axiom.ts` — add `getTimeSeries`, `MetricKey`/`Window` types, `METRICS` map,
  window-rounding helper. (Extend, don't rewrite.)
- `src/app/actions/metrics.ts` — `fetchMetrics(window)` server action; export via `actions/index.ts`.
- `src/app/admin/metrics/page.tsx` — server component, initial SSR fetch.
- `src/components/admin/MetricsDashboard.tsx` — client island (period state + cards).
- `src/components/charts/{LineChart,BarChart,Sparkline}.tsx` — SVG primitives.
- `src/components/admin/*` — nav entry + landing link.
- `src/i18n/locales/{es,en}.ts` — all new labels in **both** locales (default es).
- Tests: `src/lib/axiom.test.ts` (or existing test file), E2E spec under `tests/`.

## Risks & mitigations
- **Axiom APL endpoint shape** differs from the legacy structured endpoint the current
  wrappers use — de-risked: MCP APL queries already returned correct binned series against
  the live staging dataset. Confirm the raw HTTP `POST /v1/datasets/_apl` response shape in
  the first implementation step.
- **Sparse data** → mandatory gap-fill (in scope).
- **Bucketed distinct-count cost** (active rescuers) → fallback plan noted above.
- **Interactive re-fetch cost** → rounded-window cache + 5-min TTL keeps toggles cheap;
  each window is a bounded set of parallel queries.
- **Field-name inconsistency** in actor logging is pre-existing debt (noted in `axiom.ts`);
  this feature works around it, doesn't fix it.
