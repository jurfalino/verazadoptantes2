# Plan: Public-mode profiles — bypass PII gating per-entry and per-profile

## Context

The PII gating model masks all contact identifiers (phone, email, social, id,
address) to non-owner viewers. But some data isn't actually private — when an
adopter profile is created by importing a public social-network post, the
phone / email / handles in the post were already public when ingested. Re-
gating them as PII is over-cautious; on a vetting platform the whole point
is that authenticated rescuers can see the relevant signal fast.

We want to relax PII gating for:

- **Contact entries that were imported from a public social source** —
  marked at import time, per-entry.
- **Whole profiles that an admin has confirmed are publicly known** — a
  per-profile escalation that overrides everything, including entries a
  later contributor added through other (non-public) channels.

Crucial caveat the user surfaced: a contributor may add a phone (not from a
public source) to an imported profile after the fact. A whole-profile
"public" flag would expose that contributor-added phone too — violating the
contributor's reasonable expectation that PII gating still protects it. So
the granularity must be **per-contact-entry by default, with the per-profile
flag as an admin override** for cases where they've confirmed everything is
publicly known.

Authentication is unchanged — "public" here means *not PII-gated for
authenticated viewers*, NOT unauthenticated. The route stays on
buenadoptante.org behind the existing auth check.

One feature flag (`ENABLE_PUBLIC_PROFILES`) gates the entire behavior as a
clean kill switch — off ⇒ both flags are ignored by the resolver, the admin
toggle is hidden, no new imports auto-mark entries as public.

Shipped as **`v2.16.0-12`**.

## Approach

### Data model

**Per-entry (the load-bearing primitive):**
`ContactEntry` (in `src/lib/contactEntries.ts`) gains an optional
`isPublic?: boolean`. Stays in the JSON column — no DDL. Set `true` on
entries created at import time; absent/false everywhere else. Preserved
through `deserializeContactEntries` (length-capped boolean cast) and
through `dedupe` (older entry wins, same as `id` / `addedBy`).

**Per-profile (admin override):**
`adopters.isPublic` integer (boolean) column, default `0`. Added via
hand-written migration `drizzle/0046_adopter_is_public.sql` (`ALTER TABLE
adopters ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`). Schema entry
in `src/db/schema.ts`.

### Feature flag

`ENABLE_PUBLIC_PROFILES: false` in `src/config/features.ts`. **Off ⇒**
- Visibility resolver behaves exactly as it does today (both columns are
  ignored).
- Admin "mark as public" toggle is hidden.
- Imports don't auto-stamp `isPublic` on entries (column simply isn't
  populated; admin can flip it on later via the per-profile escalation
  once the flag flips).

**On ⇒**
- For each entry: if `entry.isPublic === true` OR the parent
  `adopter.isPublic === true`, the visibility resolver treats it as
  unlocked (no mask).
- For the name: if `adopter.isPublic === true`, render the full name
  unmasked (treat as `nothingMasked` for the name column).
- For the legacy `addressInfo` column: only the per-profile flag applies
  (it's a single free-text field, no per-entry concept).
- Family members and notes are already not in `MASKED_ENTRY_TYPES` —
  unchanged.

### Visibility resolver changes

`src/lib/piiAccess.ts`:

- `maskContactEntries(entries, visibility, opts?)` — gains an
  `adopterIsPublic?: boolean` option. The per-entry skip check becomes:
  ```
  if (e.type === 'other' || e.type === 'alias') return e;
  if (adopterIsPublic) return e;
  if (e.isPublic) return e;
  if (visibility.unlockedEntryHashes.has(...)) return e;
  // mask
  ```
- `maskAdopterContact(adopter, visibility, opts?)` — accepts the same
  `adopterIsPublic` option, threads it through to `maskContactEntries`, and
  short-circuits the `addressInfo` mask when set.
- `renderName(name, visibility, currentQuery?, opts?)` — when
  `adopterIsPublic` is set, returns the unmodified name.
- New helper exported: `isPublicVisibilityActive(flag, adopter) → boolean`
  computed as `flag && adopter.isPublic`, so the read-side call sites have
  one place to derive it.

### Server callsites that thread the new flag

`src/lib/piiAccessServer.ts` (or wherever `resolveAdopterVisibility` lives
and the masking helpers are called): read `ENABLE_PUBLIC_PROFILES` once via
`getFeatureFlag`, compute `adopterIsPublic = flag && adopter.isPublic ===
1`, and pass to `maskAdopterContact` + `renderName` in:

- `getAdopter` (`src/app/actions/adopters.ts`)
- `findAdopters` discovery path (`src/app/actions/findAdopters.ts`) —
  including the per-result mask + the `renderName` call
- `/api/adopters/route.ts` GET (the duplicate-check surface)
- `getHistory` if it currently passes through `redactHistoryChanges`

### Import path stamps isPublic on entries

`src/app/api/adopters/route.ts` (POST — the importer write path). When the
flag is on AND the row is being created as imported (the `source` value or
the route context tells us so), pass `isPublic: true` on each entry in the
constructed `contactEntries` JSON before write. If the route doesn't
currently set `source='imported'` explicitly, do that too (or trace to
wherever the import write actually happens — `_adopterFactory.ts` handles
form + contract, not import).

The `addContactEntry` / `updateContactEntry` / `removeContactEntry`
contributor paths do NOT set `isPublic` — contributor-added entries stay
PII-gated unless the per-profile admin flag overrides. `updateContactEntry`
preserves the original `isPublic` value on the updated entry (typo fix on
an imported entry stays public).

### Admin UI

New per-row toggle in `src/components/AdminAdopterList.tsx` — a small
"🌐 Público" / "🔒 Privado" pill per adopter row. Click → calls new server
action `setAdopterPublic(adopterId, isPublic)` in `src/app/actions/admin.ts`
(admin-gated via `checkIsAdminAsync`, logAudit, revalidate). When the flag
is off, the pill is hidden entirely.

### Out of scope (named, not in this PR)

- Backfill of `isPublic=true` onto entries of pre-existing source='imported'
  rows. Those rows stay opt-in via the per-profile admin flag for now.
  A one-shot admin action mirroring `backfillLegacyContactEntries` is the
  natural follow-up if real usage shows the gap.
- Per-entry admin toggle to flip `isPublic` on a single existing entry.
  The two switches we have (import-time per-entry stamp + per-profile admin
  override) cover the common cases; finer-grain admin editing is a later
  add.
- Unauthenticated public reads. Auth still required. If we ever want a
  truly public-web display, that's the "showcase domain" pattern from the
  memory — separate work.

## Files

**New:**
- `drizzle/0046_adopter_is_public.sql` — adds `is_public INTEGER NOT NULL
  DEFAULT 0` to `adopters`.

**Modified:**
- `src/db/schema.ts` — add `isPublic` to the `adopters` table definition.
- `src/lib/contactEntries.ts` — add `isPublic?: boolean` to `ContactEntry`,
  persist through `deserializeContactEntries`.
- `src/lib/contactEntries.test.ts` — round-trip test for `isPublic`
  preservation through deserialize + merge.
- `src/config/features.ts` — add `ENABLE_PUBLIC_PROFILES: false`.
- `src/lib/piiAccess.ts` — extend `maskContactEntries`, `maskAdopterContact`,
  `renderName` to honor `adopterIsPublic`. Update the per-entry skip check
  for `entry.isPublic`. Add `isPublicVisibilityActive` helper.
- `src/lib/piiAccess.test.ts` — coverage for the new bypass cases:
  - flag off ⇒ `isPublic` ignored
  - flag on + `entry.isPublic=true` ⇒ entry unmasked even for non-privileged viewer
  - flag on + `adopter.isPublic=true` ⇒ all entries unmasked + name fully revealed
  - contributor-added entry (no `isPublic`) on imported profile (per-entry
    bypass only) ⇒ still masked
- `src/lib/piiAccessServer.ts` — read the flag once, thread
  `adopterIsPublic` to the masking helpers.
- `src/app/actions/adopters.ts` (`getAdopter`, `getHistory`) — thread the
  flag.
- `src/app/actions/findAdopters.ts` — thread the flag in the per-result
  masking + `renderName` call.
- `src/app/api/adopters/route.ts` — GET: thread the flag for the duplicate-
  check mask. POST (import write): stamp `isPublic: true` on each entry of
  the constructed `contactEntries` JSON when the flag is on AND this is the
  import path.
- `src/app/actions/admin.ts` — new `setAdopterPublic(adopterId, isPublic)`
  server action, admin-gated, audited.
- `src/app/actions/index.ts` — export `setAdopterPublic`.
- `src/components/AdminAdopterList.tsx` — per-row "🌐 Público / 🔒 Privado"
  toggle when the flag is on.
- `src/i18n/locales/{es,en}.ts` — new keys for the admin toggle label and
  any user-facing copy.

**Unchanged but verified:**
- `addContactEntry` / `updateContactEntry` / `removeContactEntry` — do NOT
  set `isPublic` on contributor-added or contributor-edited entries.
  `updateContactEntry` already preserves `original.isPublic` via the
  spread-existing-fields pattern from v2.16.0-9; double-check it threads
  through the address branch too.

## Verification

- `npx tsc --noEmit` clean.
- `npm run lint` within the 125 ratchet.
- `npx vitest run` — baseline 133 + new piiAccess + contactEntries cases.
- **Manual on staging after deploy (flag OFF):**
  1. Existing profiles render identically to today. No admin toggle visible.
  2. Import a profile via ImportWizard — verify the new entry has NO
     `isPublic` field in the persisted JSON.
- **Manual on staging after flipping `ENABLE_PUBLIC_PROFILES` on:**
  1. Admin toggle visible on `/admin/adopters`. Click on a profile → it
     becomes public. Reload as a non-owner authenticated viewer → contact
     entries render unmasked, name renders fully.
  2. Add a contact entry to that public profile as a contributor →
     contributor's entry IS visible too (because adopter.isPublic
     overrides). Toggle the profile back to private → contributor's entry
     becomes masked again per existing rules (no `entry.isPublic`).
  3. Import a fresh profile via ImportWizard → its entries render unmasked
     to all viewers (per-entry `isPublic=true`). Add a contributor entry
     to it → contributor entry stays masked (no per-entry flag, profile
     itself not admin-flipped).
  4. Flip the flag back off → public profile reverts to PII-gated as
     before; admin toggle hidden.

## Prod-rollout plan

This is the last item before the staging→master PR. The plan is the same
clean-flag-off rollout as PII gating used:

1. Ship `v2.16.0-12` to staging with `ENABLE_PUBLIC_PROFILES=false`. CI
   green, manual flag-off check confirms no behavior change.
2. Merge staging→master. Migration `0046` adds the column to prod (default
   0 ⇒ no rows public, no behavior change).
3. After prod deploy is verified healthy, run the v2.16.0-8 contact-entry
   backfill admin button (still needed for prod's legacy rows).
4. Flip `ENABLE_PUBLIC_PROFILES` in prod appConfig when ready to roll the
   feature out. Imports from that point forward stamp `isPublic=true` per
   entry; admin can use the per-profile toggle on existing rows.
