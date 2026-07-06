# Scope: Normalize `adoptions` → `animals` + `placements` + `adopter_events`

## Context & goal

The `adoptions` table conflates **three** concepts, which is why history is lost on a
move and why every feature that touches it is awkward:

- **Animal identity** — name, species, birthdate, neutered, sex, color, microchip, photos.
- **Placement/custody** — an animal held by an adopter (`foster`/`adoption`), with a start/end.
- **Adopter-level events** — `observation`, `adoption_request` (no animal at all),
  `follow_up`, `returned_pet` (events *about* a prior placement).

Goal: a clean, normalized model where each concept is its own table, so an animal's
custody trail and an adopter's history are both first-class and permanent — replacing
the interim `animal_placements` ledger with a proper `placements` table.

This is a **multi-week, multi-PR** effort. It supersedes the append-only ledger
(`animal_placements`) built earlier this session.

## Target schema (three tables)

### `animals` — identity + status
`id, name, species, estimatedBirthDate, age(legacy), neutered, sex, color, microchip,
details, sourceUrl, addedBy, createdAt, updatedAt, deletedAt`
- Current placement is derived: `SELECT ... FROM placements WHERE animalId=? AND endedAt IS NULL`.
  See **Fork B** on whether to also denormalize a `currentPlacementId` pointer.

### `placements` — custody spans (subsumes the interim ledger)
`id, animalId(FK→animals), adopterId(FK→adopters), recordType('foster'|'adoption'),
startedAt, endedAt(NULL=active), rating, status, deliveredToHome, verifiedAddress,
identityVerified, onBehalfOf, comments(contract JSON), date, recordedBy, createdAt`
- **Active** = `endedAt IS NULL`. **History** = ended rows. One mechanism for both.
- A foster→foster / foster→adoption move: set the prior placement's `endedAt`, insert a
  new active placement. (`deriveEndedPlacement` from the interim work feeds directly into
  this — the logic isn't wasted, only its storage target changes.)

### `adopter_events` — adopter-scoped activity
`id, adopterId(FK), eventType('observation'|'adoption_request'|'follow_up'|'returned_pet'),
animalId?(NULL for observation/adoption_request), placementId?, species, rating, details,
date, onBehalfOf, sourceUrl, recordedBy, createdAt`
- `observation`/`adoption_request` carry **no animal**. `follow_up`/`returned_pet`
  reference a prior placement/animal (and `returned_pet` should also set the referenced
  placement's `endedAt`).

### recordType → target mapping
| old `recordType` | target |
|---|---|
| `available` | `animals` row, no active placement |
| `foster`, `adoption` | `animals` row + `placements` row |
| `adoption_request`, `observation` | `adopter_events` (no `animalId`) |
| `follow_up`, `returned_pet` | `adopter_events` (with `animalId`/`placementId`) |

## Two design keys that shrink the migration

**1. Preserve ids across the split.** Each old `adoptions.id` becomes *either* an
`animals.id` (available/foster/adoption) *or* an `adopter_events.id` (the 4 event types).
Placements get **new** ids. Result: the existing soft/hard references keep resolving with
no re-mapping table:
- `contractInvitations.animalId` → now an `animals.id` ✓
- `formSubmissions.selectedAnimalId` → `animals.id` ✓
- `adopterImages.adoptionId` → `animals.id` or `adopter_events.id` (see Images below)
- `piiAccessRequests.activityId` → soft display link ("activity that prompted the PII
  request"); post-split points at a placement/event id. Nullable, resolved only in
  `PiiAccessRequestPanel`; low-risk, fix at read-migration time.

**2. Adopter-centric aggregations span two tables now** (`placements` + `adopter_events`).
See **Fork A** for how to combine them.

## Images — explicit resolution (NOT automatic)

Today `AdoptionHistory` iterates an adopter's rows and calls `getAdoptionImages(row.id)`;
`adopterImages.adoptionId` = that row id, `adoptionId IS NULL` = profile pics.

**Decision:** adoption/foster/available photos are **photos of the animal** → own them by
**`animals.id`**. With id-preservation, existing `adoptionId` values for those rows already
equal the new `animals.id`, so the data needs no move — but the **read must change**: the
adoption/placement surface must fetch images by `animalId`, not `placement.id` (placements
have new ids → `getAdoptionImages(placement.id)` would return an empty gallery *silently*).
Event photos (`follow_up`/`returned_pet`) stay keyed to the event row id (`adopter_events.id`).
Profile pics (`adoptionId IS NULL`) unchanged. Rename `adopterImages.adoptionId` →
`subjectId` (or keep the name) but **rewrite `getAdoptionImages` callers to pass the animal
id**. Bonus vs today: photos now follow the animal across placements instead of being
stranded on a since-moved row.

## Two forks to decide (do not pre-commit)

**Fork A — combine adopter aggregations in JS vs a SQL union view.**
The ~6 sites that aggregate an adopter's records (`getAverageRating`, `computeAvgRating`
callers in applicants/enrichAdopters/dashboard/admin-duplicates/login-gate,
`computeMaxDensityPeriod`, `computeStats`, dedup `onBehalfOf`) currently do one
`WHERE adopterId=X`. Options:
- **(Recommended) Fan-out + combine in JS** — two `eq(adopterId)` queries (placements +
  adopter_events), concatenate, feed the existing pure domain fns. Matches the codebase
  idiom (CLAUDE.md "fan out, combine in JS"), no D1/Drizzle view friction.
- **SQL `adopter_records` UNION view** — one read per site, but Drizzle-view ergonomics on
  D1 are awkward (you flagged this).

**Fork B — derive current placement vs denormalize a `currentPlacementId` pointer.**
- **(Recommended) Derive** — active placement is `WHERE animalId=X AND endedAt IS NULL`, a
  trivial indexed query (NOT latest-per-group). No sync obligation.
- **Denormalize a pointer on `animals`** — only earns its cost for the `/my-animals`
  **list** scan (many animals at once). Reintroduces a mutable-sync obligation on every
  placement start/end — the exact drift we avoided with the append-only ledger. Choose only
  if the list scan proves slow.

## Couplings the migration must preserve (from code audit)

- **Ratings**: `computeAvgRating` counts non-null `rating` across ALL types;
  `getAverageRating` = `AVG(rating) WHERE adopterId`. Ratings live on **both** placements
  and adopter_events (follow_up/returned_pet carry ratings). Aggregate over both.
- **Density/thresholds**: `computeMaxDensityPeriod` counts `adoption` (placements) +
  `adoption_request` (adopter_events); `tooManyAdoptions`/`tooManyRequests`, login gate.
- **Stats**: `computeStats` counts adoption (placements) + request (adopter_events).
- **Dedup**: `tokenizeAdopter`/`extractTokens` read `onBehalfOf` (now on placements + events).
- **Contract**: `contractInvitations.animalId`, `/api/contract/[id]/submit` (id = animal),
  `createContractInvitation` ownership checks.
- **Images**: see Images section.
- **Demo**: `isDemo` is on `adopters`, not adoptions — unaffected.
- **Write sites to re-point**: `saveAdoption` + `/api/adopters`, `/api/adopters/[id]/add-record`,
  `/api/contract/[id]/submit`, wizard, edit form, ImportWizard (the ~8 mapped earlier).

## PROGRESS

- **Phase 0 (reset) — DONE.** Reverted all interim session work; kept
  `src/domain/placements.ts` (+test). Tree at 121-lint baseline, tsc clean.
- **Fork A = JS-combine, Fork B = derive (no pointer). Decided (EM call).**
- **Phase 1 (expand) — DONE.** Added `animals`/`placements`/`adopter_events` to
  `schema.ts`; migrations `0054` (create) + `0055` (backfill, id-preserving);
  applied to `local.db`. `date`→`placements.startedAt`; all backfilled placements
  active (`endedAt NULL`).
- **Phase 2 (parity) — DONE (local).** `scripts/parity-check-normalization.sql`
  passes on local: exact row conservation + zero rating/adoption-count/request-count
  mismatches. STILL TODO: run it against **staging** D1 before migrating reads.
- **CI-seed caveat for Phase 4:** `setup-test-db.js` runs migrations against an EMPTY
  db then seeds `adoptions` via `seed.sql` — so `0055` backfill is a no-op in CI and
  the new tables stay empty there. Harmless in Phase 1 (reads unchanged); before
  Phase 4 flips any read, either seed the new tables in `seed.sql` or re-run backfill
  post-seed in `setup-test-db.js`.

## PROGRESS (session 2)

- **Phase 3/4 (write cutover + transitional view) — DONE.** `adoptions` is now a
  read-only VIEW (`0056`) reconstructing the old row shape from the 3 tables; the
  normalized tables are the source of truth. All 14 write sites cut over to
  `animals`/`placements`/`adopter_events` via `src/app/actions/_recordWrite.ts`
  (`insertRecord`/`updateRecord`/`deleteRecordById`/`deleteAdopterRecords`/
  `reassignAdopterRecords`, reusing `deriveEndedPlacement` for transitions).
  `seed.sql` + the two E2E specs that wrote `adoptions` (`contract-link`,
  `adopter.spec`) rewritten to the normalized tables (ids preserved). `'request'`
  alias normalized to `adoption_request`.
- **Verified:** view is byte-faithful to the old table (0-diff by-name, incl.
  synthetic available + foster rows); tsc clean; lint 121; 178 vitest pass; no
  writes to `adoptions` remain in `src/` or `tests/`.
- **NOT verified (needs CI/staging):** the write paths at RUNTIME — only exercised
  by the E2E specs, which run in CI (Node 26 blocks them locally). Run the E2E suite
  + parity on staging before trusting prod.
- **Deliberately still pending (the "peel" tail):** reads still go through the view,
  so behavior is externally IDENTICAL to before — the original "foster vanishes from
  /my-animals" bug is still live and the foster-display UX is NOT rebuilt. Peeling
  the view (reads → normalized tables directly, delete the facade) + rebuilding the
  foster-display feature on the new model remain.

## Migration strategy — expand/contract (phased, reversible)

Big-bang is too risky (~10 read + ~8 write sites, 5 FK refs, E2E can't run locally). Use
expand/contract:

- **Phase 0 — reset the interim session work.** No stopgap ships (user decision: the
  refactor is the only deliverable). Revert everything built this session against the OLD
  model — the `animal_placements` ledger (table + migration + hooks + read actions + the two
  UI surfaces) AND the old-model foster-display patch (`/my-animals` query broadening,
  badge, two-button move, wizard prefill, `getAvailableAnimals` change). **Preserve:**
  `src/domain/placements.ts` + its tests (`deriveEndedPlacement` feeds the `placements`
  write logic). **Preserve as behavior spec, not code:** the foster-display UX (foster
  animals appear in `/my-animals` with a Tránsito badge; two explicit next-step actions
  "dar en adopción" / "mover a otro tránsito") becomes a **requirement of Phase 4's
  `/my-animals` read rewrite** on the new model.
- **Phase 1 — Expand.** Create `animals`, `placements`, `adopter_events`. Hand-authored
  migration ([[project_drizzle_migrations_handwritten]]). Backfill from `adoptions`
  preserving ids per the mapping. No reads switched yet.
- **Phase 2 — Parity harness (first-class deliverable, named phase).** Compute
  rating + adoption-density + request-count **from old `adoptions` AND from the new tables**
  on real staging data; assert equal per adopter. This is the check that actually proves the
  split is faithful — tsc/lint can't. Gate later phases on it.
- **Phase 3 — Dual-write.** Route every adoptions write through a shared layer that writes
  the normalized tables too, keeping them in sync while reads still use `adoptions`.
- **Phase 4 — Migrate reads surface-by-surface** (my-animals, adopter profile, /my-adoptions,
  ratings/density, contract, images), re-running parity after each.
- **Phase 5 — Contract.** Stop writing `adoptions`; drop it (or keep archived).

## Testing

- Domain fns (`deriveEndedPlacement`, aggregation combiners) — vitest, runs locally.
- Parity harness (Phase 2) — SQL-level, validate via `sqlite3` CLI locally
  ([[project_e2e_node26_bettersqlite]]) + against staging D1 (read-only pre-authorized).
- E2E per migrated read surface — runs in CI.

## Effort & risk

Multi-week, multiple PRs (one per phase minimum). Highest-risk areas: the backfill
correctness (Phase 1/2 parity), the images read rewrite (silent blank galleries), and the
adopter-aggregation-across-two-tables (silent rating drift). The expand/contract phasing
keeps each step reversible.

## Sequencing (decided)

One deliverable: the normalization refactor. **No interim foster-display PR** (user
decision — "no need for the foster fix if we're shipping a fully working refactor"). The
refactor delivers correct foster display as part of Phase 4's `/my-animals` read rewrite.
Consequence, accepted: the production "foster animals vanish from /my-animals" bug remains
until the refactor lands. The interim session work is reset in Phase 0 (keeping the reusable
`deriveEndedPlacement` domain logic and the foster-display UX as a behavior spec).
