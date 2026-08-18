# Import Wave 0 Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 engineering + 2 UX data-integrity/trust blockers (E1–E8, U1, U2) from `.agents/audits/2026-08-16-import-audit.md` so the import feature is safe to promote to production.

**Architecture:** Small, targeted fixes across four layers — the pure domain fingerprint (`src/domain/contentFingerprint.ts`), the parse layer (`src/lib/spreadsheetParse.ts`), the server bulk endpoints (`src/app/actions/importBatch.ts`, `importIdentical.ts`, `_recordWrite.ts`), and the client wizard (`src/components/SpreadsheetImportWizard.tsx`). Pure functions get vitest coverage; DB-touching changes get `tsc` + a described staging verification (the repo cannot run Playwright/better-sqlite3 locally on Node 26 — see `project_e2e_node26_bettersqlite`).

**Tech Stack:** Next.js 15 (App Router), React client components, Cloudflare D1 + Drizzle ORM, vitest (unit), Playwright (e2e, CI-only).

## Global Constraints

- **Every deploy needs a version bump** — `npm version <v> --no-git-tag-version`, commit `v<v>: …`, push `origin HEAD:staging`, NEVER push master. Bump on every staging iteration (`feedback_bump_every_deploy`). Batch related fixes into one push (`feedback_batch_pushes`).
- **Lint ratchet ≤ 125 warnings**; `npx tsc --noEmit` must be clean.
- **D1 has NO `inArray`/`IN ${array}`** — use `or(...ids.map(eq))` and keep any multi-row insert under **~100 bound params** (rows×cols < 100).
- **D1 has multi-region read-replica lag** (`project_d1_replica_lag`) — fail OPEN on auth gates, but for **dedup detection fail CLOSED / surface the error** (that's E2).
- **i18n: default locale is `es`**; update `src/i18n/locales/{es,en,pt}.ts` together for any new `t()` key or Spanish users see the raw key path.
- **Icons: inline SVG with `currentColor`** for functional affordances; emoji only as decorative markers next to a text label (`feedback_svg_over_emoji`).
- **Only themed Tailwind colors are theme-safe** (`feedback_themed_colors_only`) — no raw hex, gradient stops, or `ring-*` unless in the `[data-theme]` rules.
- **Error toasts need an 8-char errorId** via `extractErrorId` (server-thrown) or `reportClientError` (client runtime) (`feedback_error_toasts_need_id`).
- **Grep `tests/` before removing/renaming any UI selector** (`feedback_grep_tests_before_deletion`); no import-wizard e2e specs exist today but confirm each task.
- **`adopter.status` is deprecated** — never read it; ratings derive from activities (`project_adopter_status_deprecated`).

---

## File structure (what each task touches)

- `src/domain/contentFingerprint.ts` — E5 (name-only → empty fingerprint). Pure, vitest.
- `src/domain/contentFingerprint.test.ts` — E5 tests.
- `src/lib/spreadsheetParse.ts` — E4 (Excel Date/serial → ISO). Add pure `xlsxCellToString`.
- `src/lib/spreadsheetParse.test.ts` — **new** — E4 tests for `xlsxCellToString`.
- `src/app/actions/_recordWrite.ts` — E1 (`onConflictDoNothing` on animals/adopterEvents/placements inserts).
- `src/app/actions/importBatch.ts` — E1 (deterministic activity id + drop all-or-nothing gate), E7 (`onConflictDoUpdate` audit item).
- `src/app/actions/importIdentical.ts` — E2 (throw/signal on scan failure instead of `{}`).
- `src/components/SpreadsheetImportWizard.tsx` — E2 (surface degraded detection), E3 (detect on split contacts), E6 (retry/resume keep prior results + total), E8 (cancel-race finalize), U1 (visibility explainer + count), U2 (pre-import confirm summary).
- `src/i18n/locales/{es,en,pt}.ts` — only if U1/U2 introduce `t()` keys (this plan keeps U1/U2 copy inline Spanish to match the file's current all-Spanish reality — full i18n is Wave 1 U3, out of scope here; add a code comment tagging the debt).

---

## Task ordering rationale

Regressions I introduced this session (E8, E6) first — they must not reach prod. Then server data-integrity (E1, E7), then detection correctness (E2, E5, E3), then parse (E4), then UX trust (U1, U2). Tasks are independent; each ends green and committable.

---

### Task 1: E8 — cancel race no longer mislabels a completed run

**Files:**
- Modify: `src/components/SpreadsheetImportWizard.tsx` (the `sendBatches` finalization block — the `if (cancelRef.current) { … return; }` branch)

**Interfaces:**
- Consumes: existing `cancelRef` (useRef), `progress` state `{done,total}`, `finalResults`, `finishImportRun`, `setMyRuns`, `getMyImportRuns`.
- Produces: no new exports.

**Context:** Today the finalization treats `cancelRef.current === true` as "cancelled" unconditionally. If Cancel is clicked in the window between the last batch draining and `Promise.all` resolving, all rows are already created but the run is labeled cancelled and `finishImportRun` is never called, so it lingers forever as "en curso/interrumpida" and keeps offering Reanudar.

- [ ] **Step 1: Locate the cancel branch.** In `sendBatches`, find the block after `await Promise.all(...)` that reads:
```tsx
setImportDone(true);
setCancelling(false);

if (cancelRef.current) {
    setCancelled(true);
    getMyImportRuns().then(setMyRuns).catch(() => { /* best-effort */ });
    return;
}
```

- [ ] **Step 2: Distinguish "cancelled with work left" from "cancel after completion".** Replace the branch with a check on whether anything was actually left unsent. A cancel only truly interrupted the run if fewer rows were processed than the total:
```tsx
setImportDone(true);
setCancelling(false);

// A cancel only "interrupted" the run if work was actually left unsent. If Cancel
// arrived after the last batch already drained (done >= total), the run is complete —
// finalize it normally instead of leaving it un-closed and mislabelled 'cancelled'.
const trulyCancelled = cancelRef.current && done < total;
if (trulyCancelled) {
    setCancelled(true);
    getMyImportRuns().then(setMyRuns).catch(() => { /* best-effort */ });
    return;
}
setCancelled(false);
```
(`done` and `total` are already in scope in `sendBatches`.)

- [ ] **Step 3: Verify tsc.** Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Manual reasoning check (no local e2e — Node 26).** Confirm by reading: after Step 2, when `done >= total` the code falls through to the normal-completion path (`localStorage.removeItem` when `counts.failed===0`, `finishImportRun`, `getMyImportRuns`). Confirm `done` reaches `total` on a fully-drained import (each processed row increments `done`, skipped rows are seeded into `done = acc.size`).

- [ ] **Step 5: Commit** (defer version bump/push to the end of the batch per Global Constraints, OR bump now if shipping this task alone).
```bash
git add src/components/SpreadsheetImportWizard.tsx
git commit -m "fix(import): cancel arriving after last batch finalizes the run instead of mislabelling it cancelled"
```

---

### Task 2: E6 — retry/resume keeps prior results and the true total

**Files:**
- Modify: `src/components/SpreadsheetImportWizard.tsx` (`sendBatches` signature + seeding; `retryFailed`; `resumeImport`)

**Interfaces:**
- Consumes: `results` state (`RowResult[]`), `resumable` (`ResumeSnapshot`), `sendBatches`.
- Produces: `sendBatches` gains an optional `priorResults` + `displayTotal` so a subset re-send doesn't wipe the full picture.

**Context:** `retryFailed`/`resumeImport` call `sendBatches(runId, rows, rows.length, [], names)`, so `acc`/`progress`/`results` re-seed with ONLY the retried subset — the previously-created rows vanish from the results view, and `finishImportRun` overwrites the run's header counters with the subset numbers.

- [ ] **Step 1: Widen `sendBatches` to accept prior results + a display total.** Change its signature and the seeding of `acc`/`progress`. Current head:
```tsx
const sendBatches = async (
    runId: string, toSend: ImportBatchRow[], total: number,
    preResults: RowResult[], nameByIndex: Record<number, string>,
) => {
    setStep('import'); setImportDone(false); setFailureByIndex({});
    const acc = new Map<number, RowResult>();
    for (const p of preResults) acc.set(p.index, p);
    let done = acc.size;
```
Replace with:
```tsx
const sendBatches = async (
    runId: string, toSend: ImportBatchRow[], total: number,
    preResults: RowResult[], nameByIndex: Record<number, string>,
    priorResults: RowResult[] = [],
) => {
    setStep('import'); setImportDone(false); setFailureByIndex({});
    const acc = new Map<number, RowResult>();
    // Seed with the already-known results from the original run (retry/resume), so the
    // results view keeps the full picture and counts don't collapse to the subset.
    for (const p of priorResults) acc.set(p.index, p);
    for (const p of preResults) acc.set(p.index, p);
    // `total` reflects the WHOLE run (not just the re-sent subset); `done` counts every
    // row already accounted for (prior + skips), so progress reads e.g. 780/800 → 800/800.
    let done = acc.size;
```

- [ ] **Step 2: Update `retryFailed` to pass the prior results and the full total.** Current:
```tsx
try { await sendBatches(resumable.runId, rows, rows.length, [], resumable.names); }
```
Replace with:
```tsx
// Keep the full run in view: pass every current result as prior, and the ORIGINAL
// total so the tally/counters don't collapse to just the retried rows.
try { await sendBatches(resumable.runId, rows, resumable.total, [], resumable.names, results); }
```

- [ ] **Step 3: Update `resumeImport` similarly.** Current:
```tsx
await sendBatches(snap.runId, snap.rows, snap.rows.length, [], snap.names);
```
Replace with:
```tsx
// On a cancel-resume the current `results` already hold what got created; keep them so
// resume shows the whole run, not just the re-sent rows. On a refresh-resume `results`
// is empty (fresh mount) — harmless.
await sendBatches(snap.runId, snap.rows, snap.total, [], snap.names, results);
```

- [ ] **Step 4: Verify tsc.** Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Reasoning check.** Confirm: `finishImportRun` computes `counts` from `finalResults = [...acc.values()]`, which now includes prior results → the header counters reflect the whole run, not the subset. Confirm `resumable.total` exists on `ResumeSnapshot` (it does: `{ runId, fileName, total, rows, names }`).

- [ ] **Step 6: Commit**
```bash
git add src/components/SpreadsheetImportWizard.tsx
git commit -m "fix(import): retry/resume keep prior results and the true run total (no more vanishing rows / clobbered counts)"
```

---

### Task 3: E1 — non-atomic create no longer strands adopters without an activity

**Files:**
- Modify: `src/app/actions/_recordWrite.ts` (add `.onConflictDoNothing()` to the `animals`, `adopterEvents`, and `placements` inserts in `insertRecord`)
- Modify: `src/app/actions/importBatch.ts` (`createImportedAdopter`: give the activity a deterministic id, drop the all-or-nothing `if (!existing)` gate)

**Interfaces:**
- Consumes: `insertRecord(db, data, actor)` already accepts `data.id` to pre-seed the id (`_recordWrite.ts:63,68,89`).
- Produces: a deterministic activity id `deterministicAdopterId(runId,index) + '-act'`.

**Context:** The adopter INSERT and the activity `insertRecord` are separate autocommits; `if (!existing)` gates BOTH on the adopter row's existence, so a Worker kill (or retry) after the adopter commits but before the activity means the activity is never written and the row still reports `created`.

- [ ] **Step 1: Make `insertRecord`'s writes idempotent.** In `src/app/actions/_recordWrite.ts`, add `.onConflictDoNothing()` to the three inserts in `insertRecord`:
```tsx
// event-type branch:
await db.insert(adopterEvents).values({ /* …unchanged… */ }).onConflictDoNothing();
// animal branch:
await db.insert(animals).values({ /* …unchanged… */ }).onConflictDoNothing();
// placement branch:
if (isPlacementType(recordType) && data.adopterId) {
    await db.insert(placements).values(placementValues(animalId, data, recordType, data.adopterId, actor, date)).onConflictDoNothing();
}
```
(Only add the modifier; do not change the values. `data.id` is already respected as the animal/event id.)

- [ ] **Step 2: In `createImportedAdopter`, derive a deterministic activity id and drop the all-or-nothing gate.** Replace the body from `const existing = …` onward:
```tsx
async function createImportedAdopter(db: NonNullable<Db>, actor: string, country: string | null, row: ImportBatchRow, runId: string): Promise<string> {
    const newId = deterministicAdopterId(runId, row.index);
    // Each write is INDEPENDENTLY idempotent (deterministic ids + onConflictDoNothing),
    // so a mid-row Worker kill or a withDbRetry re-run re-attempts only the writes that
    // didn't commit — instead of the old all-or-nothing `if (!existing)` gate that could
    // skip the activity forever (adopter with no activity → no rating; orphan animal).
    const entries = deserializeContactEntries(row.contactEntries);
    const contactInfoStr = contactEntriesToBlob(entries) || null;
    await db.insert(adopters).values({
        id: newId,
        name: (row.name ?? '').trim(),
        contactInfo: contactInfoStr,
        contactEntries: entries.length ? JSON.stringify(entries) : null,
        familyMembers: null,
        status: '5',
        addedBy: actor,
        sourceUrl: null,
        country,
        isPublic: row.isPublic ? 1 : 0,
        source: 'imported',
    }).onConflictDoNothing();
    // Deterministic activity id keyed on (runId,index) so a retry is a DB no-op, not a
    // duplicate activity — and so a prior attempt that stranded the adopter still gets
    // its activity written on the next attempt.
    await insertRecord(db, {
        id: `${newId}-act`,
        adopterId: newId,
        animalName: row.adoption.animalName?.trim() || null,
        species: row.adoption.species || 'other',
        status: 'completed',
        rating: row.adoption.rating || 2,
        recordType: row.adoption.recordType,
        date: row.adoption.date ? new Date(row.adoption.date) : null,
        sourceUrl: null,
        details: row.adoption.details || null,
        neutered: row.adoption.neutered ?? null,
        age: row.adoption.age || null,
        onBehalfOf: row.adoption.onBehalfOf || null,
    }, actor);
    await tokenizeAdopter(newId);
    return newId;
}
```
Note: `RecordData.id` is `string` (see `_recordWrite.ts:120`); passing `id` on create is supported (`data.id || newId()`).

- [ ] **Step 3: Verify tsc.** Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Reasoning + staging verification.** Read `_recordWrite.ts` to confirm `animals`/`adopterEvents`/`placements` have single-column PKs so `onConflictDoNothing` targets the id. Staging check after deploy: import a small sheet twice with the same runId is not directly triggerable, but a resume (Task 2) re-sends rows → confirm no duplicate activities appear on the created adopters (open a few profiles).

- [ ] **Step 5: Commit**
```bash
git add src/app/actions/_recordWrite.ts src/app/actions/importBatch.ts
git commit -m "fix(import): make adopter+activity writes independently idempotent (no stranded adopters / orphan animals on retry)"
```

---

### Task 4: E7 — audit item status reflects the latest attempt

**Files:**
- Modify: `src/app/actions/importBatch.ts` (the per-batch `import_run_items` insert)

**Interfaces:** none new.

**Context:** Item id is `impitem-${runId}-${index}` inserted with `.onConflictDoNothing()`, so a `failed` item from attempt 1 is never overwritten by the `created` from a successful retry → the admin's derived counts (`dFailed`/`dCreated`) are wrong.

- [ ] **Step 1: Upsert the item on the id so a later authoritative result wins.** Replace the insert loop:
```tsx
for (let i = 0; i < itemRows.length; i += 8) {
    await db.insert(importRunItems).values(itemRows.slice(i, i + 8)).onConflictDoNothing();
}
```
with:
```tsx
// Upsert (not do-nothing): a row that was 'failed' on attempt 1 and 'created' on a
// retry must overwrite the stale item, or the admin's item-derived counts lie. Still
// ≤8 rows/insert (12 cols × 8 = 96 params < D1's ~100 limit).
for (let i = 0; i < itemRows.length; i += 8) {
    await db.insert(importRunItems).values(itemRows.slice(i, i + 8))
        .onConflictDoUpdate({
            target: importRunItems.id,
            set: {
                adopterId: sql`excluded.adopter_id`,
                action: sql`excluded.action`,
                status: sql`excluded.status`,
                matchedAdopterId: sql`excluded.matched_adopter_id`,
                matchedAdopterName: sql`excluded.matched_adopter_name`,
                matchConfidence: sql`excluded.match_confidence`,
                message: sql`excluded.message`,
                createdAt: sql`excluded.created_at`,
            },
        });
}
```

- [ ] **Step 2: Add the `sql` import.** At the top of `importBatch.ts`, change `import { eq } from 'drizzle-orm';` to `import { eq, sql } from 'drizzle-orm';`.

- [ ] **Step 3: Confirm the D1 `excluded.` column names match the schema.** Read `src/db/schema.ts` for the `importRunItems` table and verify the snake_case column names used above (`adopter_id`, `matched_adopter_id`, `matched_adopter_name`, `match_confidence`, `created_at`). Adjust any that differ.

- [ ] **Step 4: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 5: Commit**
```bash
git add src/app/actions/importBatch.ts
git commit -m "fix(import): audit item upserts so a failed→created retry reports created (honest admin counts)"
```

---

### Task 5: E2 — duplicate detection fails CLOSED (surfaces, never silently "no matches")

**Files:**
- Modify: `src/app/actions/importIdentical.ts` (return a discriminated result, or throw, on scan failure)
- Modify: `src/components/SpreadsheetImportWizard.tsx` (`runDetection`: on failure, set a `detectionDegraded` flag and surface it; do not present a failed scan as authoritative)

**Interfaces:**
- Produces: `matchFingerprints` returns `{ ok: true, map } | { ok: false, errorId }` (breaking change — update the sole caller).
- Consumes (client): new state `const [detectionDegraded, setDetectionDegraded] = useState(false);`

**Context:** `matchFingerprints(...).catch(() => ({}))` + the per-row `findAdopters` catch both swallow to "no match"; a transient D1 error disables dedup for the whole import silently → mass duplicates with a green checkmark.

- [ ] **Step 1: Change `matchFingerprints` to a discriminated result and log with an errorId.** Replace the function's return type and the two failure returns:
```tsx
export type MatchFingerprintsResult =
    | { ok: true; map: Record<string, { adopterId: string; adopterName: string | null }> }
    | { ok: false; errorId: string };

export async function matchFingerprints(fingerprints: string[]): Promise<MatchFingerprintsResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false, errorId: 'unauth' };
    const wanted = new Set(fingerprints.filter(Boolean));
    if (wanted.size === 0) return { ok: true, map: {} };
    try {
        const db = await getDb();
        if (!db) return { ok: false, errorId: 'nodb' };
        const rows = await db.select({ id: adopters.id, name: adopters.name, contactEntries: adopters.contactEntries })
            .from(adopters)
            .where(and(isNull(adopters.deletedAt), or(isNull(adopters.isDemo), eq(adopters.isDemo, 0))))
            .limit(SCAN_LIMIT);
        if (rows.length >= SCAN_LIMIT) {
            logger.warn('matchFingerprints: scan hit the cap — identical-detection may be incomplete', { scanned: rows.length, cap: SCAN_LIMIT });
        }
        const map: Record<string, { adopterId: string; adopterName: string | null }> = {};
        for (const r of rows) {
            const fp = computeContentFingerprint({ name: r.name, ...groupContacts(r.contactEntries) });
            if (fp && wanted.has(fp) && !map[fp]) map[fp] = { adopterId: r.id, adopterName: r.name };
        }
        return { ok: true, map };
    } catch (e) {
        const errorId = logger.error('matchFingerprints failed', e, { fingerprintCount: wanted.size });
        return { ok: false, errorId };
    }
}
```

- [ ] **Step 2: Add the degraded flag to the wizard.** Near the other detection state (`detecting`, `detectionDone`):
```tsx
const [detectionDegraded, setDetectionDegraded] = useState(false);
```

- [ ] **Step 3: Update `runDetection`'s fingerprint call to handle the discriminated result and flag degradation.** Replace:
```tsx
const idMap = uniqueFps.length ? await matchFingerprints(uniqueFps).catch(() => ({} as Record<string, { adopterId: string; adopterName: string | null }>)) : {};
```
with:
```tsx
setDetectionDegraded(false);
let idMap: Record<string, { adopterId: string; adopterName: string | null }> = {};
if (uniqueFps.length) {
    const res = await matchFingerprints(uniqueFps).catch(() => ({ ok: false as const, errorId: 'net' }));
    if (res.ok) idMap = res.map;
    else setDetectionDegraded(true); // surfaced in the UI; do NOT treat as "no matches"
}
```

- [ ] **Step 4: Flag per-row fuzzy failures too.** In the per-row worker's catch, keep the fallback but record that detection was incomplete:
```tsx
} catch {
    found[index] = null; actions[index] = 'create';
    detectionHadError = true;
}
```
Declare `let detectionHadError = false;` at the top of `runDetection`, and after the workers finish add:
```tsx
if (detectionHadError) setDetectionDegraded(true);
```

- [ ] **Step 5: Surface the degraded state in the UI.** Where the "no buscaste duplicados" amber banner renders (near the `Buscar duplicados` control), add — when `detectionDone && detectionDegraded`:
```tsx
{detectionDone && detectionDegraded && (
    <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
        La búsqueda de duplicados no se completó del todo (error temporal). Algunos registros podrían no haberse comparado — revisá antes de importar o volvé a buscar duplicados.
    </div>
)}
```

- [ ] **Step 6: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 7: Commit**
```bash
git add src/app/actions/importIdentical.ts src/components/SpreadsheetImportWizard.tsx
git commit -m "fix(import): duplicate detection fails closed — surface a degraded scan instead of silently reporting no matches"
```

---

### Task 6: E5 — a name-only record is never auto-treated as "identical"

**Files:**
- Modify: `src/domain/contentFingerprint.ts` (return `''` when there is no contact identifier)
- Modify: `src/domain/contentFingerprint.test.ts` (add cases)

**Interfaces:** `computeContentFingerprint` unchanged signature; behavior: name-only → `''`.

**Context:** A name-only input produces a non-empty digest, so two homonyms collide and the wizard auto-pre-selects `upsert` into a possibly-wrong person.

- [ ] **Step 1: Write the failing tests.** Add to `src/domain/contentFingerprint.test.ts`:
```ts
it('returns empty for a name-only record (no contact) — homonyms must not auto-merge', () => {
    expect(computeContentFingerprint({ name: 'Juan Pérez' })).toBe('');
    expect(computeContentFingerprint({ name: 'Juan Perez', phones: [], emails: [] })).toBe('');
});
it('still fingerprints a record that has a name AND at least one contact', () => {
    expect(computeContentFingerprint({ name: 'Juan', phones: ['11-4796-3445'] })).not.toBe('');
    expect(computeContentFingerprint({ emails: ['a@b.com'] })).not.toBe('');
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run src/domain/contentFingerprint.test.ts`
Expected: FAIL — the name-only case currently returns a non-empty string.

- [ ] **Step 3: Implement.** In `computeContentFingerprint`, replace the emptiness guard:
```tsx
if (!name && !phones.length && !emails.length && !socials.length && !ids.length && !addresses.length) return '';
```
with:
```tsx
// A name alone is NOT enough to claim two records are "identical" (homonyms). Require at
// least one contact identifier; a name-only record returns '' → treated as "no match" →
// routed to review/create instead of auto-upsert into a possibly-different person.
const hasContact = phones.length || emails.length || socials.length || ids.length || addresses.length;
if (!hasContact) return '';
```

- [ ] **Step 4: Run tests to verify pass (including the existing suite).** Run: `npx vitest run src/domain/contentFingerprint.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**
```bash
git add src/domain/contentFingerprint.ts src/domain/contentFingerprint.test.ts
git commit -m "fix(import): name-only records return an empty fingerprint (no homonym auto-merge)"
```

---

### Task 7: E3 — duplicate detection runs on the SPLIT contacts (combined_contact no longer bypasses it)

**Files:**
- Modify: `src/components/SpreadsheetImportWizard.tsx` (`runDetection`: derive detection inputs from `buildImportBody(eff).body.contactEntries`, not the raw `eff.*` arrays)

**Interfaces:**
- Consumes: `buildImportBody` (already imported), `deserializeContactEntries` from `@/lib/contactEntries` (add import), `computeContentFingerprint`.

**Context:** When the AI maps a column to `combined_contact`, phones/emails live in `eff.combinedContacts` and are only split inside `buildImportBody`. Detection reads `eff.phones/emails/...` → misses them → guaranteed duplicate on re-import.

- [ ] **Step 1: Add a helper that yields grouped contacts from the SPLIT entries.** Near the top of the component module (after imports), add:
```tsx
// Group an import row's POST-SPLIT contact entries (combined_contact cells are split
// inside buildImportBody) so duplicate detection sees the same contacts that will be
// saved — not the pre-split eff.* arrays (which omit combined_contact values).
function splitGroupedContacts(eff: MappedRow): { phones: string[]; emails: string[]; socials: string[]; ids: string[]; addresses: string[] } {
    const g = { phones: [] as string[], emails: [] as string[], socials: [] as string[], ids: [] as string[], addresses: [] as string[] };
    const built = buildImportBody(eff);
    for (const e of deserializeContactEntries(built.body?.contactEntries ?? '[]')) {
        const v = e.value?.trim(); if (!v) continue;
        if (e.type === 'phone') g.phones.push(v);
        else if (e.type === 'email') g.emails.push(v);
        else if (e.type === 'social') g.socials.push(v);
        else if (e.type === 'id') g.ids.push(v);
        else if (e.type === 'address') g.addresses.push(v);
    }
    return g;
}
```
Add `deserializeContactEntries` to the existing `@/lib/contactEntries` import if not already present.

- [ ] **Step 2: Use it for the fingerprint.** In `runDetection`, replace the `fpByIndex` construction:
```tsx
for (const t of targets) {
    fpByIndex[t.index] = computeContentFingerprint({ name: t.eff.name, phones: t.eff.phones, emails: t.eff.emails, socials: t.eff.socials, ids: t.eff.dnis, addresses: t.eff.addresses });
}
```
with:
```tsx
for (const t of targets) {
    const g = splitGroupedContacts(t.eff);
    fpByIndex[t.index] = computeContentFingerprint({ name: t.eff.name, ...g });
}
```

- [ ] **Step 3: Use it for the fuzzy `findAdopters` call.** Replace the per-row `findAdopters` input:
```tsx
const res = await findAdopters(
    {
        name: eff.name || undefined, phones: eff.phones, emails: eff.emails, socials: eff.socials,
        contactInfo: eff.dnis.length ? eff.dnis.map(d => `DNI ${d}`).join('\n') : undefined,
    },
    { mode: 'duplicate', limit: 1, minRelevance: 5 },
);
```
with:
```tsx
const g = splitGroupedContacts(eff);
const res = await findAdopters(
    {
        name: eff.name || undefined, phones: g.phones, emails: g.emails, socials: g.socials,
        contactInfo: g.ids.length ? g.ids.map(d => `DNI ${d}`).join('\n') : undefined,
    },
    { mode: 'duplicate', limit: 1, minRelevance: 5 },
);
```
(This also removes the `extractedData.phones` dual-state footgun for detection — the split entries are the single source of truth per `project_extracteddata_dualstate_smell`.)

- [ ] **Step 4: Perf guard.** `buildImportBody` now runs once per target inside the fingerprint loop AND once per row in the worker. For an 800-row detection that's ~1600 calls; acceptable (detection already loops per row), but note it and, if visible lag appears, memoize `splitGroupedContacts` per index into a `Record<number, …>` computed once before the workers. (Not required for correctness.)

- [ ] **Step 5: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 6: Commit**
```bash
git add src/components/SpreadsheetImportWizard.tsx
git commit -m "fix(import): run duplicate detection on split contact entries so combined_contact columns are compared (no bypass)"
```

---

### Task 8: E4 — Excel Date/serial cells parse to a correct ISO date

**Files:**
- Modify: `src/lib/spreadsheetParse.ts` (add pure `xlsxCellToString`; use it in `parseXlsxFile`)
- Create: `src/lib/spreadsheetParse.test.ts`

**Interfaces:**
- Produces: `export function xlsxCellToString(cell: unknown): string` — Date → `YYYY-MM-DD`; number that looks like an Excel date serial → `YYYY-MM-DD`; everything else → `String(cell ?? '')`.

**Context:** `read-excel-file` yields JS `Date` objects (and sometimes numeric serials) for date cells; `.toString()` → `"Fri Jun 15 2024 …"`, which the prose-oriented `normalizeImportDate` coarsens to the 1st or drops. Emit ISO at parse time instead.

- [ ] **Step 1: Write the failing tests.** Create `src/lib/spreadsheetParse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { xlsxCellToString } from './spreadsheetParse';

describe('xlsxCellToString', () => {
    it('formats a Date cell as YYYY-MM-DD (day preserved, no timezone drift)', () => {
        // read-excel-file builds UTC-midnight Dates for date cells.
        expect(xlsxCellToString(new Date(Date.UTC(2024, 5, 15)))).toBe('2024-06-15');
        expect(xlsxCellToString(new Date(Date.UTC(2009, 2, 1)))).toBe('2009-03-01');
    });
    it('passes strings through unchanged', () => {
        expect(xlsxCellToString('Juan Pérez')).toBe('Juan Pérez');
        expect(xlsxCellToString('11-4796-3445')).toBe('11-4796-3445');
    });
    it('renders non-date numbers as their string form (not a date)', () => {
        expect(xlsxCellToString(5)).toBe('5');
        expect(xlsxCellToString(11479634)).toBe('11479634');
    });
    it('handles null/undefined as empty', () => {
        expect(xlsxCellToString(null)).toBe('');
        expect(xlsxCellToString(undefined)).toBe('');
    });
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run src/lib/spreadsheetParse.test.ts`
Expected: FAIL — `xlsxCellToString` is not exported yet.

- [ ] **Step 3: Implement `xlsxCellToString` and use it.** In `src/lib/spreadsheetParse.ts` add (above `parseXlsxFile`):
```tsx
/** Convert one xlsx cell (which read-excel-file may hand back as a Date, number, or
 *  string) into the string the import pipeline expects. Date cells become ISO
 *  `YYYY-MM-DD` (using UTC parts — the library builds UTC-midnight Dates, so UTC parts
 *  avoid the local-timezone day-shift), so the day of month survives instead of being
 *  coarsened to the 1st by the prose date parser. Plain numbers are NOT treated as date
 *  serials here (ambiguous with phone/DNI columns); only real Date objects convert. */
export function xlsxCellToString(cell: unknown): string {
    if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        const y = cell.getUTCFullYear().toString().padStart(4, '0');
        const m = (cell.getUTCMonth() + 1).toString().padStart(2, '0');
        const d = cell.getUTCDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return (cell ?? '').toString();
}
```
Then in `parseXlsxFile` replace the row mapping:
```tsx
const rows = data.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').toString()));
```
with:
```tsx
const rows = data.slice(1).map((r) => headers.map((_, i) => xlsxCellToString(r[i])));
```

- [ ] **Step 4: Run tests to verify pass.** Run: `npx vitest run src/lib/spreadsheetParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Decision note (do not implement).** Numeric date serials (e.g. `"45458"`) still fall through as plain numbers — a deliberate choice, because a bare number in a date column is ambiguous with phone/DNI data, and the review step's date picker shows what will be saved. Leave a code comment saying serial-number date columns are not auto-converted; the user maps/edits them in review. (Full serial handling is a Wave 1 item if it recurs.)

- [ ] **Step 6: Commit**
```bash
git add src/lib/spreadsheetParse.ts src/lib/spreadsheetParse.test.ts
git commit -m "fix(import): Excel Date cells parse to ISO YYYY-MM-DD (day preserved, no coarsening to the 1st)"
```

---

### Task 9: U1 — make público/protegido comprehensible and safe at the decision point

**Files:**
- Modify: `src/components/SpreadsheetImportWizard.tsx` (per-row blue/gray visibility badge; visibility explainer near the bulk-visibility control; a running "N públicos · N protegidos" count; reconsider the anon→public default)

**Interfaces:**
- Consumes: `records`, `importable`, per-row `eff.isPublic`, the existing `isPublic = eff.isPublic ?? isAnon` logic in `buildBatchRow`, the per-row `isPublicEff` already computed in the grid-row component (`isPublicEff = eff.isPublic ?? isAnon`).
- Produces: a memoized `visibilityCounts` derived from the selected records.
- Reuses the canonical badge treatment from `src/domain/visibilityBadge.ts` / `VisibilityBadgeModal.tsx`: **public → `var(--status-sky-bg)`/`var(--status-sky-text)` (blue); protected → `var(--surface-muted)`/`var(--text-muted)` (gray)** — themed CSS vars (theme-safe; do NOT use raw Tailwind color classes here).

**Context:** `isPublic = eff.isPublic ?? isAnon` silently publishes anonymous rows; "Público" is never explained; there's no pre-import count. The per-row pill also exists today but is colored **emerald/green** — which collides with the app's convention where green = "con acceso" and **blue = público** (Nielsen #4 consistency; `feedback_nielsen_heuristics_on_ui`, `feedback_themed_colors_only`).

- [ ] **Step 1: Decide the default (recommended: keep anon→public but make it explicit + counted).** Do NOT change the merge/showcase semantics — anonymous public records are the intended showcase behavior. Instead make it visible. Keep the `?? isAnon` default; add explanation + a count so it's an informed choice, not a surprise. (Flipping the default to protected-by-default is a product decision; leave a `// PRODUCT:` comment flagging it for the user rather than changing it unilaterally.)

- [ ] **Step 2: Recolor the per-row visibility badge to the canonical blue/gray.** The grid row already renders a `Público`/`Protegido` pill (currently emerald/green for public, which collides with the app's green="con acceso"). Find it:
```tsx
<span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold align-middle ${isPublicEff ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
    {isPublicEff ? 'Público' : 'Protegido'}
</span>
```
Replace with the canonical themed treatment (blue público / gray protegido), matching `computeVisibilityBadge`'s `public` / `protected-locked` colors:
```tsx
<span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold align-middle"
    style={isPublicEff
        ? { backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' }
        : { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)' }}>
    {isPublicEff ? 'Público' : 'Protegido'}
</span>
```
Every grid row now shows a blue (público) or gray (protegido) badge, consistent with the profile/search-card badges. (The badge already renders unconditionally on every row, so there's no "no badge" gap.)

- [ ] **Step 3: Compute the visibility counts (memoized).** Near `importable`/`tally`, add:
```tsx
// How each selected, importable row will be saved (público vs protegido), so the user
// sees the consequence BEFORE importing. Mirrors buildBatchRow's rule: explicit
// per-row/bulk choice wins, else anonymous→público / named→protegido.
const visibilityCounts = useMemo(() => {
    let publicCount = 0, protectedCount = 0;
    for (const r of importable) {
        const isAnon = !r.eff.name?.trim();
        const pub = r.eff.isPublic !== undefined ? r.eff.isPublic : isAnon;
        if (pub) publicCount++; else protectedCount++;
    }
    return { publicCount, protectedCount };
}, [importable]);
```

- [ ] **Step 4: Add an explainer + count near the bulk-visibility control.** Where the bulk visibility `<select>` / toolbar renders, add (use the same themed blue for the públicos number as the per-row badge — `--status-sky-text`):
```tsx
<p className="text-xs text-stone-500 mt-1">
    <b style={{ color: 'var(--status-sky-text)' }}>Público</b> = cualquiera puede encontrar este registro al buscar. <b>Protegido</b> = solo vos, tu grupo y administradores.
    {' '}Se importarán <b style={{ color: 'var(--status-sky-text)' }}>{visibilityCounts.publicCount} públicos</b> y <b className="text-stone-600">{visibilityCounts.protectedCount} protegidos</b>.
</p>
```

- [ ] **Step 5: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 6: Check both themes.** Confirm the blue público badge + gray protegido badge render legibly in **light and "Azul Noche" dark** (the CSS vars flip per theme — that's why we use them instead of raw Tailwind classes).

- [ ] **Step 7: Commit**
```bash
git add src/components/SpreadsheetImportWizard.tsx
git commit -m "feat(import): per-row blue/gray visibility badge + explainer + públicos/protegidos count before importing"
```

---

### Task 10: U2 — pre-import confirmation summary

**Files:**
- Modify: `src/components/SpreadsheetImportWizard.tsx` (intercept the "Importar N registros" click with a confirmation summary; reuse `visibilityCounts` from Task 9)

**Interfaces:**
- Consumes: `visibilityCounts` (Task 9), `records`, `matches`, `rowAction`, `importable`, `runImport`.
- Produces: `const [confirmOpen, setConfirmOpen] = useState(false);` and an `importSummary` memo (create/update/skip counts).

**Context:** One click on "Importar N registros →" starts writing immediately; some rows were auto-set to `upsert` (mutating existing records). No summary of create vs update vs skip vs público before the commit.

- [ ] **Step 1: Compute the action summary (memoized).** Near `visibilityCounts`:
```tsx
// What the import will actually DO, so the commit is informed (esp. the auto-upsert rows
// that mutate existing records). Mirrors buildBatchRow's action resolution.
const importSummary = useMemo(() => {
    let create = 0, update = 0;
    for (const r of importable) {
        const action = rowAction[r.index] ?? 'create';
        if (action === 'upsert') update++; else create++;
    }
    return { create, update, skipCount: records.filter(x => x.selected).length - importable.length };
}, [importable, rowAction, records]);
```

- [ ] **Step 2: Add the confirm state.** `const [confirmOpen, setConfirmOpen] = useState(false);`

- [ ] **Step 3: Intercept the import button.** Change the primary import button's `onClick={runImport}` to `onClick={() => setConfirmOpen(true)}`.

- [ ] **Step 4: Render the confirmation modal** (canonical `fixed inset-0` centered modal; themed colors only):
```tsx
{confirmOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-stone-900">Confirmar importación</h3>
            <ul className="text-sm text-stone-700 space-y-1">
                <li><b className="text-emerald-700">{importSummary.create}</b> registros nuevos a crear</li>
                {importSummary.update > 0 && <li><b className="text-sky-700">{importSummary.update}</b> registros existentes a actualizar (se agregan datos a un registro ya guardado)</li>}
                {importSummary.skipCount > 0 && <li><b className="text-amber-700">{importSummary.skipCount}</b> filas omitidas</li>}
                <li className="pt-1 border-t border-stone-100"><b className="text-sky-700">{visibilityCounts.publicCount}</b> públicos · <b className="text-stone-700">{visibilityCounts.protectedCount}</b> protegidos</li>
            </ul>
            <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded-lg">Cancelar</button>
                <button onClick={() => { setConfirmOpen(false); runImport(); }} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700">Importar</button>
            </div>
        </div>
    </div>
)}
```

- [ ] **Step 5: Verify tsc + lint.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems`
Expected: tsc exit 0; warnings ≤ 125.

- [ ] **Step 6: Grep tests for the import button label** (it moved behind a modal): `grep -rn "Importar" tests/` — confirm no e2e selector clicks the primary import button directly (none exist for the wizard today). Update if any.

- [ ] **Step 7: Commit**
```bash
git add src/components/SpreadsheetImportWizard.tsx
git commit -m "feat(import): pre-import confirmation summary (create/update/skip + públicos/protegidos)"
```

---

### Task 11: Ship — version bump, changelog, deploy, verify

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Full local verification.** Run: `npx tsc --noEmit && npm run lint 2>&1 | grep problems && npx vitest run src/domain/contentFingerprint.test.ts src/lib/spreadsheetParse.test.ts src/domain/importRow.test.ts`
Expected: tsc exit 0; warnings ≤ 125; all vitest green.

- [ ] **Step 2: Bump + changelog.** `npm version 2.34.0 --no-git-tag-version` (minor — a correctness/safety milestone bundling Wave 0). Add a `## [2.34.0]` CHANGELOG entry summarizing E1–E8, U1, U2 with the audit reference.

- [ ] **Step 3: Commit + push.** `git commit -am "v2.34.0: import Wave 0 — data-integrity + trust fixes (E1–E8, U1, U2)"` then `git push origin HEAD:staging`.

- [ ] **Step 4: Watch the pipeline to green** (capture the run id for `v2.34.0`, don't watch "latest" — `feedback_capture_run_id_after_merge`).

- [ ] **Step 5: MANUAL VANA end-to-end on clean staging** (the verification CI can't do — `feedback_pipeline_watch_output`, and no import-wizard e2e exists): import the VANA sheet, confirm no mass failures, dates land correctly (incl. year/month-year/Excel), detection surfaces matches (and degraded state if forced), the confirm summary reads right, público/protegido counts are correct, cancel→resume and retry keep the full picture, and `/admin/imports` counts are honest.

---

## Self-review

**Spec coverage:** E1→T3, E2→T5, E3→T7, E4→T8, E5→T6, E6→T2, E7→T4, E8→T1, U1→T9, U2→T10. All Wave 0 items covered; ship in T11. ✅

**Placeholder scan:** every code step carries real code; the two "decision note" steps (T8 serials, T9 default) are explicit non-implementation product calls flagged for the user, not TODOs. ✅

**Type consistency:** `matchFingerprints` returns `MatchFingerprintsResult` (T5) and its only caller is updated in the same task; `sendBatches` gains one optional trailing param (T2) so existing calls stay valid; `xlsxCellToString` (T8) and the `splitGroupedContacts` helper (T7) are named consistently across their tasks; `insertRecord`'s `id` pre-seed (T3) matches its existing `data.id || newId()` support. ✅

**Environment caveat:** DB-touching tasks (T3, T4, T5) can't run Playwright locally (Node 26); their verification is `tsc`/lint + the T11 manual staging pass. Pure-function tasks (T6, T8) and the existing `importRow` suite carry real vitest coverage.
