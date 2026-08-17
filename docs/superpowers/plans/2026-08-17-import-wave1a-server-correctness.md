# Import Wave 1a — server write-path correctness (E9, E10, E11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the three highest-value residual import defects in the server write path: E9 (upsert not idempotent → resume double-adds an activity), E10 (upsert+create drop sex/color/microchip), E11 (imported contact entries not stamped with per-entry addedBy).

**Architecture:** All changes live in `src/app/actions/importBatch.ts` and `src/app/actions/importUpsert.ts` (+ a type touch on the wizard's `ImportBatchRow` producer only if needed). The idempotency fix reuses the deterministic-id + `onConflictDoNothing` pattern already established in Wave 0's `insertRecord`/`saveAdoption` path.

**Tech Stack:** Next.js 15 server actions, Cloudflare D1 + Drizzle, vitest (domain only — DB paths verified by tsc + reasoning; repo can't run Playwright/better-sqlite3 on Node 26).

## Global Constraints

- **Every deploy needs a version bump** (`npm version <v> --no-git-tag-version`, commit `v<v>:`, push `origin HEAD:staging`, never master). Batch these three fixes into one push.
- `npx tsc --noEmit` clean; lint ratchet ≤ 125 warnings.
- **D1:** no `inArray`/`IN ${array}`; multi-row inserts < ~100 bound params.
- **D1 replica lag** (`project_d1_replica_lag`): the idempotency fix must survive `getAdoptions` NOT yet seeing a prior attempt's write — the DB-level conflict/existence check is authoritative, content-match is only an optimization.
- **Collaborative model** (`project_collaborative_vetting_model`): imported contacts are open contributions; stamping per-entry `addedBy` is what lets the original contributor edit them later.
- Repo CANNOT run Playwright/DB-vitest locally (Node 26) — server-path verification = tsc + lint + a written reasoning trace.

## Established facts (verified while planning — implementers can rely on these)

- `saveAdoption(data)` (`src/app/actions/adoptions.ts:13,26,88`): if `data.id` matches an existing `adoptions` row → UPDATE path; else → INSERT via `insertRecord`, whose `animals`/`adopterEvents`/`placements` inserts got `.onConflictDoNothing()` in Wave 0 (T3). So passing a DETERMINISTIC id makes a re-send either update-in-place or a DB no-op — never a duplicate.
- `insertRecord` (`_recordWrite.ts:63`) reads `data.sex/color/microchip` (→ `animals`, lines 98-100); `RecordData` carries them.
- Wizard `buildBatchRow` (`SpreadsheetImportWizard.tsx:453`) already passes `adoption: built.body.adoption`, and `ImportBody.adoption` (`lib/importRow.ts:82,85,86`) INCLUDES sex/color/microchip — so the runtime data already flows to the server; only the `ImportBatchRow.adoption` TYPE (which omits them) and the server read-sites need widening.
- `ContactEntry.addedBy?: string` exists (`lib/contactEntries.ts:36`); `addContactEntry` stamps `addedBy: actor` (lines 81,83) — the upsert path already stamps, only the create path (`createImportedAdopter`, direct `deserializeContactEntries`) does not.
- `upsertImportRecord` is called from exactly one place: `importAdoptersBatch` (`importBatch.ts:143`), which has `runId` + `row.index` in scope.

---

### Task 1: E9 — idempotent upsert activity (no double-add on resume/retry)

**Files:**
- Modify: `src/app/actions/importUpsert.ts` (accept a deterministic `activityId`; use it in `saveAdoption`; normalize the incoming date for the content-match)
- Modify: `src/app/actions/importBatch.ts` (pass the deterministic `activityId` from the upsert call site)

**Interfaces:**
- `ImportUpsertInput` gains `activityId?: string | null`.
- The upsert call in `importBatch.ts:142-143` passes `activityId: \`impups-${runId}-${row.index}-act\``.

**Context:** `upsertImportRecord` decides whether to add the incoming activity via `planRecordMerge` (content-match against `getAdoptions`), then calls `saveAdoption({ id: crypto.randomUUID(), … })` — a fresh random id ALWAYS inserts. Two holes: (1) the incoming date is passed RAW (`input.adoption.date ?? ''`) while existing dates are `toYmd`-normalized, so a non-canonical incoming date never content-matches → duplicate; (2) D1 replica lag can hide the prior attempt's activity from `getAdoptions` → `addActivity=true` → duplicate. A deterministic id closes both: `saveAdoption` finds the existing row (UPDATE, no dup) or `insertRecord`'s `onConflictDoNothing` no-ops.

- [ ] **Step 1: Add `activityId` to the input type.** In `importUpsert.ts`, extend `ImportUpsertInput`:
```tsx
export interface ImportUpsertInput {
    adopterId: string;
    /** Deterministic id for the merged activity (from runId+rowIndex) → a re-sent
     *  import row updates-in-place / no-ops instead of double-adding the activity. */
    activityId?: string | null;
    name?: string | null;
    contactEntries: string;
    adoption: {
        animalName: string | null; species: string | null; recordType: string;
        rating: number | null; date: string | null; details: string | null; onBehalfOf: string | null;
        neutered?: number | null; age?: string | null;
    };
}
```

- [ ] **Step 2: Normalize the incoming date for the content-match.** In `upsertImportRecord`, change the `incomingActivity` passed to `planRecordMerge` (currently `date: input.adoption.date ?? ''`):
```tsx
incomingActivity: { recordType: input.adoption.recordType, date: toYmd(input.adoption.date), details: input.adoption.details },
```
(`toYmd` already exists in this file and is what the existing activities are normalized through — this makes the comparison symmetric.)

- [ ] **Step 3: Use the deterministic id in `saveAdoption`.** Change the `saveAdoption({ id: crypto.randomUUID(), … })` call so the id comes from the input when provided:
```tsx
await saveAdoption({
    id: input.activityId ?? crypto.randomUUID(), // deterministic on import ⇒ retry-safe
    adopterId: input.adopterId,
    // …rest unchanged…
});
```

- [ ] **Step 4: Pass the deterministic id from the batch call site.** In `importBatch.ts`, the upsert branch (currently `upsertImportRecord({ adopterId: row.matchedAdopterId!, name: row.name, contactEntries: row.contactEntries, adoption: row.adoption })`):
```tsx
const r = await withDbRetry(() => upsertImportRecord({
    adopterId: row.matchedAdopterId!,
    activityId: `impups-${runId}-${row.index}-act`,
    name: row.name,
    contactEntries: row.contactEntries,
    adoption: row.adoption,
}));
```

- [ ] **Step 5: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 6: Reasoning trace (record in report).** A resume re-sends an upsert row: attempt 1 added the activity under id `impups-${runId}-${i}-act`. On the resend, `saveAdoption` is called with the SAME id → `existing` is found (or, under replica lag, `insertRecord`'s `onConflictDoNothing` no-ops) → NO duplicate activity. Also confirm `retryFailed` is unaffected (a failed upsert never applied its activity, so the deterministic id is simply first-write). Confirm `impups-${runId}-${index}-act` can't collide across rows (index differs) or runs (runId differs) or with the create path's `${newId}-act` (different prefix).

- [ ] **Step 7: Commit**
```bash
git add src/app/actions/importUpsert.ts src/app/actions/importBatch.ts
git commit -m "fix(import): idempotent upsert activity — deterministic id + symmetric date match (no double-add on resume/retry)"
```

---

### Task 2: E10 — carry sex/color/microchip through create AND upsert

**Files:**
- Modify: `src/app/actions/importBatch.ts` (`ImportBatchRow.adoption` type + `createImportedAdopter`'s `insertRecord` call)
- Modify: `src/app/actions/importUpsert.ts` (`ImportUpsertInput.adoption` type + the `saveAdoption` call)

**Interfaces:** `ImportBatchRow.adoption` and `ImportUpsertInput.adoption` each gain `sex?: string | null; color?: string | null; microchip?: string | null`.

**Context:** `buildImportBody` produces `adoption.sex/color/microchip`, and the wizard passes the whole `built.body.adoption` into `ImportBatchRow.row.adoption` — but the `ImportBatchRow.adoption` TYPE omits those three, so neither the create path (`createImportedAdopter`'s `insertRecord` call) nor the upsert path reads them. The runtime data is already flowing; widen the types and read them.

- [ ] **Step 1: Widen `ImportBatchRow.adoption`.** In `importBatch.ts`, the `adoption` field of `ImportBatchRow` (currently `{ animalName, species, recordType, rating, date, details, onBehalfOf, neutered?, age? }`) gains three fields:
```tsx
    adoption: {
        animalName: string | null; species: string | null; recordType: string;
        rating: number | null; date: string | null; details: string | null; onBehalfOf: string | null;
        neutered?: number | null; age?: string | null;
        sex?: string | null; color?: string | null; microchip?: string | null;
    };
```

- [ ] **Step 2: Read them in the create path.** In `createImportedAdopter`'s `insertRecord(db, { … }, actor)` call, add the three fields alongside `neutered`/`age`:
```tsx
    neutered: row.adoption.neutered ?? null,
    age: row.adoption.age || null,
    sex: row.adoption.sex || null,
    color: row.adoption.color || null,
    microchip: row.adoption.microchip || null,
    onBehalfOf: row.adoption.onBehalfOf || null,
```
(`insertRecord`/`RecordData` already accept `sex/color/microchip` → `animals` — no `_recordWrite.ts` change needed; verify by reading `_recordWrite.ts:98-100`.)

- [ ] **Step 3: Widen `ImportUpsertInput.adoption`** to the same three fields (mirror Step 1's shape).

- [ ] **Step 4: Pass them through `saveAdoption` in the upsert path.** In `upsertImportRecord`'s `saveAdoption({ … })` call, add `sex/color/microchip`. **Verify first** that `saveAdoption`'s param type (`typeof adoptions.$inferInsert`) accepts them, OR that they thread through to `insertRecord` — since the call already passes `animalName/species/neutered/age` (not all `adoptions` columns) and compiles, the shape is loose enough; if tsc rejects `sex/color/microchip`, that's the same mechanism the existing fields use, so widen/cast consistently with them (do NOT introduce a new `any` — match the existing call's typing).

- [ ] **Step 5: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 6: Reasoning trace (record in report).** Confirm an imported row carrying sex="Hembra", color="Negro", microchip="123" now persists all three to the `animals` row on BOTH the create path and the upsert path (previously dropped on both because the type hid them). Confirm no other caller of `ImportBatchRow`/`ImportUpsertInput` breaks from the widened (all-optional) fields.

- [ ] **Step 7: Commit**
```bash
git add src/app/actions/importBatch.ts src/app/actions/importUpsert.ts
git commit -m "fix(import): carry sex/color/microchip through the create and upsert paths (were silently dropped)"
```

---

### Task 3: E11 — stamp per-entry addedBy on imported contact entries (create path)

**Files:**
- Modify: `src/app/actions/importBatch.ts` (`createImportedAdopter` — stamp `addedBy` on each entry before serialize)

**Interfaces:** none new.

**Context:** The create path deserializes `row.contactEntries` and inserts them with no `addedBy`. The per-entry edit/remove gate keys on entry-level `addedBy` (owner ∨ admin ∨ original contributor), so an un-stamped imported entry can only be edited by owner/admin — a contributor can't fix their own imported contact. The upsert path (via `addContactEntry`) already stamps; make the create path consistent.

- [ ] **Step 1: Stamp `addedBy: actor` on each entry.** In `createImportedAdopter`, after `const entries = deserializeContactEntries(row.contactEntries);`, stamp the actor as the contributor (preserving any pre-existing `addedBy`):
```tsx
const entries = deserializeContactEntries(row.contactEntries).map(e => ({ ...e, addedBy: e.addedBy ?? actor }));
```
The existing lines that follow — `contactInfoStr = contactEntriesToBlob(entries)` and `contactEntries: entries.length ? JSON.stringify(entries) : null` — then serialize the stamped entries unchanged.

- [ ] **Step 2: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125. (`ContactEntry.addedBy?: string` already exists, so no type change.)

- [ ] **Step 3: Reasoning trace (record in report).** Confirm every imported contact entry on the create path now carries `addedBy = actor`, so the original importing contributor passes the per-entry edit gate (owner ∨ admin ∨ contributor) for their own imported entries — matching the upsert path. Confirm entries that already had an `addedBy` (shouldn't happen on import, but defensively) are preserved.

- [ ] **Step 4: Commit**
```bash
git add src/app/actions/importBatch.ts
git commit -m "fix(import): stamp per-entry addedBy on create-path imported contacts (parity with upsert)"
```

---

### Task 4: Ship — version bump, changelog, deploy, verify

**Files:** `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Full local verification.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems && npx vitest run src/domain/contentFingerprint.test.ts src/lib/spreadsheetParse.test.ts src/domain/importRow.test.ts`
Expected: tsc exit 0; warnings ≤ 125; vitest green (these fixes touch no domain tests, but confirm nothing regressed).

- [ ] **Step 2: Bump + changelog.** `npm version 2.34.1 --no-git-tag-version` (patch — a correctness fast-follow to Wave 0's 2.34.0). Add a `## [2.34.1]` entry summarizing E9/E10/E11.

- [ ] **Step 3: Commit + push.** `git commit -am "v2.34.1: import Wave 1a — upsert idempotency + sex/color/microchip + per-entry addedBy"` then `git push origin HEAD:staging`.

- [ ] **Step 4: Watch the pipeline to green** (capture the `v2.34.1` run id, not "latest").

- [ ] **Step 5: Manual staging note.** Record that the E9/E10/E11 fixes, like Wave 0's server changes, are verified by tsc + review + reasoning only — they need the same manual VANA end-to-end pass (import → cancel → resume a run containing upsert rows → confirm NO duplicate activities; import a row with sex/color/microchip → confirm they persist; check a contributor can edit their own imported contact).

---

## Self-review

**Spec coverage:** E9→T1, E10→T2, E11→T3, ship→T4. ✅
**Placeholder scan:** every code step has real code; the one "verify the type accepts it" note (T2/S4) is a genuine verification the implementer must do, not a placeholder. ✅
**Type consistency:** `activityId?: string | null` on `ImportUpsertInput` (T1) is set by the one call site (T1/S4); `sex/color/microchip` added to both `ImportBatchRow.adoption` and `ImportUpsertInput.adoption` with the same `?: string | null` shape (T2); `addedBy` reuses the existing `ContactEntry.addedBy` field (T3). ✅
**Scope:** deliberately excludes E12 (concurrency), E13 (fingerprint normalization), E16 (US dates), E17 (tests), and the UX wave (i18n/mobile) — those are Wave 1b/1c.
