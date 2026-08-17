# Import functionality — audit (EM + UX)

**Date:** 2026-08-16 · **Reviewer:** Claude (senior-EM + UX lenses) · **Scope:** the whole
spreadsheet-import subsystem as of `staging` @ v2.33.9.

**Method:** 4 parallel deep readers (server/data, client state-machine, domain/parse, UX),
each returning file:line-cited findings; synthesized + de-duplicated + re-severitized here.
Several findings were independently corroborated by ≥2 readers — flagged **[corroborated]**.

**Files in scope:** `src/components/SpreadsheetImportWizard.tsx`, `src/app/actions/{importBatch,importRuns,importIdentical,importUpsert,importSheet,duplicates,findAdopters}.ts`,
`src/domain/{importRow,importFields,importMerge,contentFingerprint}.ts`, `src/lib/{importRow,spreadsheetParse}.ts`,
`src/app/admin/imports/page.tsx`.

---

## TL;DR — verdict

The import feature is **feature-rich and unusually good on resilience UX** (adaptive
batch-splitting, resume-after-refresh, live ETA, error CSV, drill-down audit). But the
audit surfaced **genuine data-integrity bugs** — non-atomic writes, silent fail-open
duplicate detection, Excel date corruption, and homonym auto-merge — that on a
**PII-vetting tool** can corrupt real rescuer data or create mass duplicates, silently.

**Prod-promotion recommendation:** the 2.32.0→2.33.9 batch is a net improvement, but this is
the **first-time prod ship** of most of this surface. **Do not promote until Wave 0 is
fixed** and the manual VANA end-to-end pass is done. None of Wave 0 is exotic; most are a
few lines each.

---

# PART 1 — EM audit (engineering)

Severity = my calibrated judgment (blast radius × likelihood × silence), not the raw
reader label. "Silent" bugs rank higher: a vetting tool that quietly does the wrong thing
is worse than one that errors loudly.

## 🔴 Wave 0 — fix before prod (data integrity / silent-wrong)

### E1. Non-atomic create → adopters with no activity/rating; orphan animals. `importBatch.ts:84-118`
The adopter INSERT and the activity `insertRecord` are two independent D1 autocommits (no
transaction), and the idempotency gate `if (!existing)` keys the whole row's "done" state on
the **adopter row alone**. If the Worker is CPU/time-killed (we've *seen* these kills this
session) after the adopter commits but before the activity, a retry finds `existing` truthy →
**skips the activity forever**. The adopter is reported `created` but has no activity, so
`avgRating` derives from nothing. For placement types, a kill between `animals` and
`placements` leaves an orphan animal.
**Fix:** give the activity a deterministic id (`deterministicAdopterId(runId,index)+'-act'`) +
`.onConflictDoNothing()` on the `animals`/`adopterEvents`/`placements` inserts, and drop the
all-or-nothing `if (!existing)` gate so a retry re-attempts the missing activity.

### E2. Duplicate detection fails **open** → mass duplicate creation on any DB blip. `importIdentical.ts:62-65` + `SpreadsheetImportWizard.tsx:323` **[corroborated: server+client]**
`matchFingerprints(...).catch(() => ({}))` and the per-row `findAdopters` catch both swallow
errors and return "no match" (only a `warn`). An empty map means *every* row is treated as new
→ `create` for all. A single transient D1 error / replica-lag hiccup (a **known** issue here —
`project_d1_replica_lag`) during the one up-front `matchFingerprints` call silently disables
dedup for the entire import; re-importing an already-present sheet then creates a full
duplicate set — with a green "0 duplicados" checkmark. This defeats the core purpose of the
tool. Exactly the "a DB outage looks like 'no results'" landmine CLAUDE.md warns about.
**Fix:** distinguish "scanned, no matches" from "scan failed." Surface an `errorId`, set a
`detectionDegraded` flag, and let the wizard halt/warn instead of proceeding as authoritative.

### E3. `combined_contact` contacts bypass BOTH detection paths → guaranteed duplicates. `SpreadsheetImportWizard.tsx:320,341-345` **[matches memory: project_extracteddata_dualstate_smell]**
Detection reads `eff.phones/emails/socials/dnis` — never `eff.combinedContacts`, and never the
post-split `built.body.contactEntries`. When the AI maps a messy column to `combined_contact`
(its *documented purpose*), the phone/email live in `combinedContacts` and are only split
*later* inside `buildImportBody`. So those contacts are invisible to fingerprint AND fuzzy
detection → the record can never match an existing person by phone/email → duplicate created on
every re-import. The known footgun ("prefers structured arrays over the blob").
**Fix:** run `buildImportBody` (or `categorizeContactText`) **before** detection and feed the
split `contactEntries` into both the fingerprint and the fuzzy inputs.

### E4. Excel date cells lose the day (coarsened to the 1st) or are dropped. `spreadsheetParse.ts:55,58` → `importRow.ts`
`read-excel-file` yields JS `Date` objects for date cells; `.toString()` produces
`"Fri Jun 15 2024 …"`, which `normalizeImportDate` can't parse as a full date → it falls to the
month+year branch → **`2024-06-01`, day 15 lost**. Raw numeric serials (`"45458"`) match nothing
→ date dropped. Timezone conversion can even shift the day across a month boundary before
coarsening. An Excel "Fecha de adopción" column silently imports every row as the 1st.
**Fix:** in `parseXlsxFile`, detect `Date` cells → emit `d.toISOString().slice(0,10)`; convert
serials explicitly. Don't funnel Excel Dates through the prose-oriented parser.

### E5. Name-only fingerprint auto-merges distinct homonyms. `contentFingerprint.ts:43-60` + `SpreadsheetImportWizard.tsx:329-332`
`computeContentFingerprint` returns a non-empty digest for a name-only input, so any two people
with the same normalized name collide. The wizard treats ANY fingerprint hit as
`matchTypes:['identical']` and **unconditionally pre-selects `upsert`** — additively merging the
import into a possibly-wrong existing person, as the default the reviewer may not override.
Common with sparse legacy rows ("Juan Pérez", no phone).
**Fix:** return `''` for name-only inputs in `matchFingerprints` (like the content-less case),
or default name-only "identical" hits to `create`/review, never auto-`upsert`.

### E6. Retry/resume clobbers the run's counts and wipes the results view. `SpreadsheetImportWizard.tsx:232,485-490,497` **[corroborated: client+server]** · *(regression — introduced this session)*
`retryFailed`/`resumeImport` call `sendBatches` with `preResults:[]` and `total:rows.length`, so
`acc`/`results`/`progress` are re-seeded with **only the retried subset**. After 780 created /
20 failed, clicking "Reintentar 20" makes the "Registros creados" list show ~20 and the prior
780 vanish (looks catastrophic), and `finishImportRun` **overwrites** the header counters with
the subset numbers. Combined with E7, `/admin/imports` and "Importaciones anteriores" then show
wrong totals.
**Fix:** seed `acc` from the existing `results`, keep `total` as the original; have
`finishImportRun` accumulate (or don't re-finalize on a subset retry).

### E7. Audit item status is frozen to first-observed; a `failed→created` retry stays `failed`. `importBatch.ts:179,197`
Item id is `impitem-${runId}-${index}` written with `.onConflictDoNothing()`, and the admin
counts are **derived from items** (`enrichRuns`). A row that fails on attempt 1 (item=`failed`)
then succeeds on retry (`created`) keeps the stale `failed` item → the audit permanently
misreports it, and `dFailed`/`dCreated` are wrong. (Good news: this is also *why* there's no
double-count — dedup works; but the status is dishonest.)
**Fix:** `onConflictDoUpdate` the item so a later authoritative result overwrites the stale one.

### E8. Cancel race mislabels a completed run and never finalizes it. `SpreadsheetImportWizard.tsx:456-482` · *(regression — introduced this session)*
If Cancel arrives between the last batch draining and `Promise.all` resolving, all rows are
actually created but `cancelRef.current===true` → run labeled `cancelled`, snapshot kept,
`finishImportRun` **never called**. The run has no `finishedAt`, so it lingers as "en
curso/interrumpida" forever and keeps offering Reanudar for a 100%-done import.
**Fix:** on the cancel branch, if nothing was left unsent (`done>=total`), treat as normal
completion (finalize + clear snapshot).

## 🟠 Wave 1 — fix soon (correctness/consistency, not silent-catastrophic)

### E9. Upsert path is not reliably idempotent → duplicate activities. `importUpsert.ts:79-92`
`saveAdoption` uses a fresh `randomUUID` each call; the only guard against a double-add on
re-send is a **soft content match** in `planRecordMerge`. Two holes: (1) existing dates are
`toYmd`-normalized but the incoming date is passed **raw**, so a non-canonical date string never
matches → duplicate activity on every retry; (2) replica lag can hide the just-written activity.
**Fix:** normalize `incomingActivity.date` via the same `toYmd`; or give the activity a
deterministic id `(runId,index)` + `onConflictDoNothing`.

### E10. Upsert silently drops `sex`, `color`, `microchip`. `importUpsert.ts:30-34,116-128`
`buildImportBody` produces them and the *create* path persists them, but the *upsert* input type
and `saveAdoption` call omit all three — asymmetric data loss on update.
**Fix:** thread `sex/color/microchip` through `ImportUpsertInput.adoption` → `saveAdoption`.

### E11. Imported contact entries never stamped with per-entry `addedBy`. `importBatch.ts:88-94` **[corroborated: server+domain; matches memory: project_import_wizard_polish_gaps]**
Create-path entries are inserted with no `addedBy`; the upsert path (via `addContactEntry`) DOES
stamp it. So provenance depends on which branch ran, the per-entry edit gate can't attribute
imported entries, and it violates the "audit identity is at-a-glance" expectation.
**Fix:** stamp `addedBy: actor` on each entry in `createImportedAdopter`.

### E12. Concurrent batches (CONCURRENCY=2) race on the same matched adopter. `SpreadsheetImportWizard.tsx:452` → `duplicates.ts:tokenizeAdopter`, `addContactEntry`
Two rows for the same person in different in-flight batches: `tokenizeAdopter`'s
delete-all→insert→update is non-atomic (interleave → partial/duplicated token set), and
`addContactEntry`'s optimistic-concurrency `rowsAffected=0` is silently dropped in
`upsertImportRecord` (contact not added, not reported failed).
**Fix:** retry `addContactEntry` on the concurrent-modification signal; make `tokenizeAdopter`
resilient (serialize per adopterId or upsert tokens by natural key).

### E13. Fingerprint identifier normalization disagrees with the merge planner. `contentFingerprint.ts:22-24,48`
Phones use **full** digits (vs last-8 everywhere else) → same person differing by area code gets
different fingerprints. IDs strip letters → `AA123456` and `BB123456` collide (false-positive
merge, silent under E5's auto-upsert). Two layers contradict.
**Fix:** normalize phone to last-8 and IDs via `normalizeEntryValue` in the fingerprint too.

### E14. No `errorId` surfaced on client catches. `SpreadsheetImportWizard.tsx:166,196,234,529,548` **[corroborated: client]**
The wizard imports neither `extractErrorId` nor `reportClientError` (unlike ~20 sibling
components). Every error shows a raw message with no 8-char id → server `logger.error` can't be
correlated → triage impossible. Violates the repo error-toast convention.
**Fix:** wrap server-thrown errors with `extractErrorId`; use `reportClientError` for client
runtime failures.

### E15. Perf: `records` memo re-runs `buildImportBody` for ALL rows on every edit keystroke; several un-memoized full scans per render. `SpreadsheetImportWizard.tsx:267-276,299-301,747-749`
On an 800-row sheet, each keystroke in a row editor triggers ~800 `buildImportBody` calls +
~6 full-array scans (the 1s ETA ticker re-renders too). Visible input lag.
**Fix:** memoize `importable/selectedInvalid/selectedWarnings` + dropdown counts; compute
per-row `built` lazily/memoized so one edit doesn't rebuild all.

### E16. US `MM/DD/YYYY` dates dropped (day>12) or silently mis-parsed (day≤12). `importRow.ts:37-41`
Hard day-first: `03/14/2009`→null (dropped); `12/05/2009`→May 12 (silent). An en/US export loses
~half its dates and mis-dates the rest.
**Fix:** day>12 && month≤12 → retry month-first before returning null; document the day-first
assumption in the UI.

## 🟡 Wave 2 — backlog (tech debt, tests, hygiene)

- **E17. Zero tests for 4 high-risk modules** — `importFields.ts`, `importMerge.ts`,
  `lib/importRow.ts`, `spreadsheetParse.ts` (column projection, merge planner, body builder,
  parsing). Findings E3/E5/E10/E11/E13 all live in untested code. Add unit suites.
- **E18. Dead `checkTokenDuplicates` still exported, contains a D1-forbidden `inArray`.**
  `duplicates.ts:833` — `@deprecated`, no callers, but re-exported from the barrel; a future
  caller inherits a silently-broken path. Delete it + the barrel export.
- **E19. `matchFingerprints` unbounded scan + hard 20k cap.** `importIdentical.ts:20,49-55` —
  loads up to 20k adopter rows (with PII) into the Worker per import, fingerprints in JS; past
  20k, dedup silently truncates. Persist an indexed `contentFingerprint` column at save time;
  query it directly (D1-safe fan-out).
- **E20. `finishImportRun` persists client-supplied counts that no read path trusts.**
  `importRuns.ts:119-123` — vestigial + client-trusted. Drop them or compute server-side.
- **E21. `reset()` doesn't clear the resume snapshot** → stale "importación sin terminar"
  banner on a fresh upload. `SpreadsheetImportWizard.tsx:572`. Decide semantics.
- **E22. `startImportRun` TOCTOU** (`select`-then-`insert`, no `onConflictDoNothing`) — harmless
  (batch re-ensures the header) but inconsistent. `importRuns.ts:86-91`.
- **E23. `resumeImport` re-sends ALL snapshot rows**, not just the missing ones — correct
  (idempotent) but wasteful re-tokenize/scan; on a *cancel*-resume the known `results` are
  unused. `SpreadsheetImportWizard.tsx:546`.
- **E24. localStorage quota** for 800+ rich rows can exceed ~5MB; failure is swallowed →
  in-memory resume works until a refresh, then unrecoverable with no warning.
  `SpreadsheetImportWizard.tsx:523`.
- **E25. `normalizeRating` over-permissive** — `"3-5"`→3, `"1st"`→1. Match a standalone `[1-5]`
  token. `importRow.ts:13`.
- **E26. Duplicated `norm()`/normalization helpers** across `importMerge`, `contentFingerprint`,
  `importFields` (root cause of E13). Extract one shared util.
- **E27. Top-level `runImport` catch renders "Importación completa" on an errored import**
  (0/N + error banner = contradictory). Track a terminal-error flag → "Importación fallida".

## Cross-cutting themes (EM)
1. **Silent fail-open is the systemic risk** (E2, E7, E12, E24, and the swallowed catches). On a
   vetting tool, degrade *loudly*.
2. **Idempotency is asserted but not enforced end-to-end** (E1, E9) — deterministic ids exist for
   the adopter row but not the activity/contacts/upsert.
3. **The `eff.*` structured arrays vs the split `contactEntries` are a two-source-of-truth
   smell** (E3, E11) — everything downstream should read the split entries.
4. **Identifier normalization is not centralized** (E13, E26) — three divergent implementations.
5. **The highest-risk logic is the least tested** (E17).

---

# PART 2 — UX audit

## 🔴 Critical / High

### U1. Público/Protegido: personal data can silently become **public**, and "public" is never explained at the decision point. `SpreadsheetImportWizard.tsx:383-384,767-771,940-955`
`isPublic = eff.isPublic ?? isAnon` → **anonymous rows default to Público**. A messy sheet with
many blank-name rows silently publishes those contact records. The only signal is a small
per-row pill; nowhere does the UI say what "Público" *means* (visible to whom? searchable?), no
legend, no pre-import "N se importarán como públicos" count. Highest trust risk in the flow,
least explained.
**Fix:** explainer copy ("Público = cualquiera lo encuentra al buscar; Protegido = solo vos y
admins"); a running "X públicos · Y protegidos" count; reconsider the anon→public default (at
least make it explicit copy, not a surprise).

### U2. No pre-import confirmation / summary before writing (and **updating**) hundreds of records. `SpreadsheetImportWizard.tsx:813`
One click on "Importar N registros →" starts writing immediately; the button doesn't break down
create vs update vs skip, and some rows were auto-set to `upsert` (mutating **existing**
records) by detection. The create/update tally only appears *during* import. Violates the
project's own "confirmation for large/destructive actions" rule.
**Fix:** a lightweight confirm summary before sending — Crear X · Actualizar Y (existentes) ·
Omitir Z · Públicos P — using the canonical modal pattern.

### U3. Entire feature is hardcoded Spanish — zero `t()`. whole wizard + `admin/imports` **[corroborated: client+UX]**
Every string is a Spanish literal; the component never imports `useLanguage`. en/pt users get a
100% Spanish importer while the rest of the app switches, and copy can't be reviewed via locale
files.
**Fix:** route all strings through `t()` with es/en/pt keys together (per CLAUDE.md i18n rule).

### U4. Mobile: review grid overflows; inputs <16px (iOS zoom); tap targets <44px. `SpreadsheetImportWizard.tsx:784-801,743,979,999-1003`
5-column table with no `overflow-x-auto` wrapper (violates CLAUDE.md's own wide-content rule);
7 stacked `text-sm` selects; Crear/Actualizar/Omitir toggles and the ✎ edit button far under
44px. "Sometimes on mobile" per the personas.
**Fix:** wrap the table in `overflow-x-auto`; bump inputs to 16px; enlarge tap targets; consider
a card layout at `sm:`.

## 🟡 Medium / Low

- **U5.** Review-grid summary shows **raw model values** (`adoption · dog · 5`) while the editor
  and filters use friendly labels — the string read 800× is the untranslated one. Run it through
  `RECORD_TYPE_LABELS`/species labels + `★`. `:972-973`
- **U6.** Emoji as **functional** icons (✎ edit, ✕ clear, ✗ fail, 🔍 search, 🧩 combined) — an
  explicitly walked-back anti-pattern (memory: `feedback_svg_over_emoji`). Replace functional
  ones with inline SVG (`currentColor`); 🧩 needs a text label.
- **U7.** Confidence dots (column-map + duplicate) have **no legend** and color is the only
  signal. Add a tiny legend / `aria-label`.
- **U8.** Filtered-empty grid has **no empty state** — blank table body reads as "broken." Add a
  designed empty row + clear-filters. `:790-800`
- **U9.** `reset()` / "Empezar de nuevo" discards all mapping + per-row edits with **no
  confirmation**; and there's **no path back** from results to the review grid to fix a
  mis-mapped column. `:812,572`
- **U10.** No onboarding / template / "which columns can I include?" help for the messy-sheet
  persona; no hint that Google Sheets must be exported first. `:601-608`
- **U11.** Duplicate detection's **blind spots** (address-only rows never match; scope is
  name/phone/email/DNI) aren't disclosed in the UI — "done" reads as comprehensive. `:805-810`
- **U12.** Accessibility: fire-and-forget `<select>` action menus (snap-back value), missing
  `aria-expanded` on disclosure buttons, unlabeled row checkbox. `:761-771,721,797,945`
- **U13.** Admin `/admin/imports` has no filter/search/pagination (grows unbounded). Low
  priority.

## What's already good (don't "re-fix")
- **Visibility of system status is strong** — per-chunk AI progress, detection progress, import
  progress + live ETA + filename + "no cierres la pestaña."
- **Error recovery is above-average** — failed rows show reason + source-row trace, error-CSV
  download, targeted retry, resume-after-refresh/cancel, idempotent re-send.
- **Duplicate match display is clear** — ● Idéntico / ● Duplicado / ○ Posible, %, matched fields,
  "Abrir ↗".
- **Status vocabulary is consistent** (creado/actualizado/omitido/fallido) and correctly hides
  the `upsert` jargon behind "Actualizar."

## UX — top 5 highest-leverage
1. Make **público/protegido** comprehensible + safe at the decision point (U1).
2. **Pre-import confirmation summary** (U2) — covers the auto-upsert surprise too.
3. **Mobile**: horizontal-scroll grid, 16px inputs, 44px targets (U4).
4. **i18n** the whole feature (U3).
5. **De-jargon the grid** + empty/legend states (U5, U7, U8).

---

## Recommended remediation order (tied to prod)
- **Before prod (Wave 0):** E1, E2, E3, E4, E5, E6, E7, E8 + U1, U2. Then the manual VANA E2E.
- **Fast-follow (Wave 1):** E9–E16 + U3, U4.
- **Backlog (Wave 2):** E17–E27 + U5–U13.

Regressions introduced **this session** (should not ship to prod unfixed): **E6, E8** (and E21).
Everything else pre-dates this session's work but ships to prod for the first time in this batch.
