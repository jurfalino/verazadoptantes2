# Identity verdict — steps 3–5 (form family, post import, Pendientes, API exact, search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every remaining surface asks the shared verdict (built in steps 1–2) the same way the sheet import does, and acts on it per the spec's surface table.

**Architecture:** One server-side helper `findPersonMatches` (lib) wraps `judgeCandidates` (src/lib/identityCandidates.ts) and returns `IdentityMatch[]` (a `DuplicateMatch` plus `verdict: 'same' | 'possible'`, same first). Each surface swaps its own `findAdopters(…, { mode: 'duplicate' })` call for it; screens read `verdict` instead of percentage bands. API exact gets socials as an identifier and «DNI alone = found» in the pure `decideExactOutcome`. Discovery search promotes «same» profiles to the top of the main list. The golden test flips one column per task.

**Tech Stack:** Next.js 15 server actions, Drizzle on D1/better-sqlite3, vitest with `src/test-utils/migratedDb`.

**Spec:** `docs/superpowers/specs/2026-11-02-identity-verdict-design.md` (§3 rules, §4 surface table, §5 search, decisions 1–10; decision 5 now: visible-name socials stay exactly as typed, never become aliases — step 6 is dropped).

**Reference (throwaway, do not copy blindly):** worktree `../vz-proto-tobe`, commit `ac539aaa` — the prototype wiring of the same surfaces (`git -C ../vz-proto-tobe show ac539aaa`). Its `protoVerdict.ts` turned visible-name socials into aliases: **do not** do that (decision 5). It hard-coded `country: 'AR'`: use the actor's country instead.

## Global Constraints

- Layers (CLAUDE.md): `src/domain/` pure — no DB, no server imports; server actions thin.
- D1: never `inArray()` / `IN (array)`; fan out with `Promise.all`; every `.catch` logs (`logger.warn('op: D1 fallback hit', {…ctx, ...redactedErrorFields(e)})`), never silent.
- Never log names, contacts or raw tokens; ids and counts only. Use `redactedErrorFields` (src/lib/identityCandidates.ts) for errors from lookups bound to contact values.
- Visible-name social values (with spaces, not URLs) are passed through untouched; never converted, never stored differently (decision 5).
- Node 20: `PATH=/opt/homebrew/opt/node@20/bin:$PATH`.
- Git: stage explicit paths only (never `-A`/`-u`/`commit -a`); never commit `local.db`, `.wrangler`, `.env.local`, `playwright.local.config.ts`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No push, no version bump, no CHANGELOG, no dev server, no Playwright (the controller runs e2e at the end).
- i18n: any new key goes in **es, en and pt** locale files. No copy changes are planned; the strip copy «Posible coincidencia exacta» stays (Jon's call, pending).
- Verification per task: `npx tsc --noEmit` clean; `npx vitest run <files>`; at the end `npx vitest run` (all), `npm run lint` warnings ≤ 125, `npm run build` OK, `node scripts/check-action-surface.mjs` OK.
- Golden test (`src/lib/identityGolden.test.ts`): each task changes its surface's helper in `surfaces()` to call the surface's **real new entry point**, and flips that column's expectations to the values in the task. Other columns stay as today. No skipped/`fails` tests.

## Review Focus

1. A verdict lookup failure on any surface must degrade to today's "no suggestion / nothing promoted" **with a logged warn** — never throw into the form, never block an API save, never make a Pendientes pair from a failure. Tasks 1, 4, 6 tests.
2. A placeholder DNI (`00000000`) or an identifier held by 4+ differently-named profiles must never give «same» on API exact or promote in search (junk guard). Tasks 5, 6 tests.
3. «DNI alone» on API exact must not copy the request's other contacts onto that profile (only `nameMatchedAs: 'profile'` adds contacts). Task 5 test.
4. The excluded profile (the one being edited / just created / the household anchor) is never its own candidate. Tasks 1, 4 tests.
5. A visible-name social («Lau Benítez Rescate») is neither an identifier nor dropped from what is saved. Task 1 test (no match by it), Task 5 test (API create keeps it as text).

---

### Task 1: `findPersonMatches` — one call for every surface

**Files:**
- Create: `src/lib/identityMatch.ts`, `src/lib/identityMatch.test.ts`
- Modify: `src/app/actions/importIdentityMatches.ts` (use the helper; behavior unchanged), `src/app/actions/types.ts`

**Interfaces:**
- Consumes: `judgeCandidates(db, facts, ctx, { limit })` and `redactedErrorFields` from `src/lib/identityCandidates.ts`; `cachedOwnerCountry(db, actor, requestId)` from `src/lib/actorCountry.ts`.
- Produces:
  ```ts
  export interface PersonInput { name?: string; aliases?: string[]; phones?: string[]; emails?: string[]; socials?: string[]; documentIds?: string[] }
  export type IdentityMatch = DuplicateMatch & { verdict: 'same' | 'possible' };
  export async function findPersonMatches(
      db: Db, input: PersonInput,
      opts: { actor?: string | null; country?: string | null; excludeAdopterId?: string; limit?: number; ctx?: Record<string, unknown> },
  ): Promise<IdentityMatch[]>
  ```
  - `types.ts`: `DiscoveryMatch.verdict?: 'same' | 'possible'` and `DuplicateMatch.verdict?: 'same' | 'possible'` (optional — old callers unaffected).
  - Throws on retrieval failure (callers own their fallback + log); no silent `[]`.

- [ ] **Step 1: Tests** in `identityMatch.test.ts` on `migratedDb` (seed like the golden test's `seed()`): (a) MJ phone + «Juan Carlos Ruiz» → `[{adopterId:'mj', verdict:'possible'}]`; (b) «Majo Pérez» + DNI `30.123.456` → `mj` `same`; (c) `excludeAdopterId:'mj'` removes it; (d) a social value `'Lau Benítez Rescate'` matches nobody and does not throw; (e) `country` read once via `cachedOwnerCountry` when `actor` given and phones present, not read when no phones; (f) only `same`/`possible` returned, `same` before `possible`; (g) `limit` honored.
- [ ] **Step 2: Run, verify fail.** `npx vitest run src/lib/identityMatch.test.ts`
- [ ] **Step 3: Implement.** Map `PersonInput` → `PersonFacts` (trim, drop empties, `aliases` default `[]`). Country: `opts.country` if given (even null), else `cachedOwnerCountry` when `actor` and phones present (failure → warn + null). `excludeAdopterId` filtered **before** applying `limit` (ask `judgeCandidates` for `limit + 1` when excluding). Output `DuplicateMatch` fields from `j.candidate` (`adopterId`, `adopterName: candidate.name`, `relevancePercent`, `matchTypes`, `matchValues`, `source`) plus `verdict`.
- [ ] **Step 4:** Switch `matchImportRow` to the helper; its own tests (`importIdentityMatches.test.ts`) must pass unchanged.
- [ ] **Step 5: Run tests + tsc, commit** `feat(identity): findPersonMatches — one verdict call for every surface`.

### Task 2: «Nuevo adoptante» family on the verdict

**Files:**
- Modify: `src/lib/formDuplicates.ts`, `src/components/AdopterForm.tsx` (`getDuplicateInput` adds `documentIds: pick('id')`), `src/app/actions/households.ts` (`getHouseholdMatchCandidates` passes `documentIds: pick('id')`), `src/lib/interviews/store.ts` (pass known DNIs if the interview state holds any; if not, leave it), `src/lib/matchChips.ts`, `src/components/StrongMatchStrip.tsx`, `src/components/DuplicatePeek.tsx`, golden test, existing formDuplicates/household tests.

**Interfaces:**
- Consumes: `findPersonMatches` (Task 1); `hydrateDuplicateMatches` (unchanged).
- Produces: `FormDuplicateInput.documentIds?: string[]`; `searchFormDuplicates` results carry `verdict`, ordered same → possible; `export function isSamePerson(r: { verdict?: 'same'|'possible'; matchValues?: MatchValue[] }): boolean` in `matchChips.ts` (verdict when present, else `hasStrongMatch`).

- [ ] **Step 1: Golden** — `form` column calls `searchFormDuplicates` with `documentIds: ids` and expects: 1 `[MJ, MP]`, 2 `[MJ]`, 3 `[MJ, MP]`, 4 `[MJ, MP]`, 5 `[MJ]`, 6 `[MJ, MP]`, 7 `[MJ]`. Add a unit test that the result for case 7 has `verdict: 'same'` and case 2 `verdict: 'possible'`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `searchFormDuplicates` calls `findPersonMatches(db, {...}, { actor: await viewer(), excludeAdopterId, limit })`, hydrates, attaches `verdict` by id. Keep the existing signature and options; `minRelevance` no longer filters verdict matches (the verdict decides) — keep the param accepted for callers. `allowContactOnly` / name < 2 chars behavior: a nameless input with a contact is «possible» (decision 9) and is shown; keep whatever gate the function applies today for the name length *only* as far as it decides whether to search at all. Failure path unchanged (`{ results: [], failed: true }` + warn). StrongMatchStrip and DuplicatePeek use `isSamePerson(r)` wherever they use `hasStrongMatch(r.matchValues)` to decide «same person» presentation.
- [ ] **Step 4:** Run golden + `npx vitest run src/lib src/app/actions/households` (fix fixtures that asserted today's lists only where the new list is the spec's), tsc.
- [ ] **Step 5: Commit** `feat(identity): «Nuevo adoptante», «Agregar conviviente» and interview check on the verdict (DNI included)`.

### Task 3: Social-post import on the verdict

**Files:**
- Modify: `src/components/ImportWizard.tsx`, golden test.

**Interfaces:**
- Consumes: `matchImportRow({ name, phones, emails, socials, documentIds })` (existing server action; returns `{ ok, matches: JudgedMatch[] }` with `verdict`).

- [ ] **Step 1: Golden** — `postImport` calls `matchImportRow` with the typed fields the wizard would build from `contactEntries` (phone/email/social/id entries → arrays; the social as the bare handle as entered) and computes `preselected = matches[0]?.verdict === 'same'`. Change `postPreselected` type to `boolean`. Expect listed / preselected: 1 `[MJ, MP]`/true, 2 `[MJ]`/false, 3 `[MJ, MP]`/false, 4 `[MJ, MP]`/false, 5 `[MJ]`/false, 6 `[MJ, MP]`/true, 7 `[MJ]`/true.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Both duplicate checks in ImportWizard (the debounced step-3 overlap check and the save-time check) build typed arrays from `contactEntries` (no `contactEntriesToBlob`) and call `matchImportRow`. PersonMatch `confidence`: `'high'` iff `verdict === 'same'`, else `'medium'` (so only «same» is pre-selected). `!res.ok` → treat as a failed check: log via the wizard's existing error path with the errorId and show what it shows today on failure (never a silent «no match»). Remove imports left unused.
- [ ] **Step 4:** Golden + ImportWizard tests (if any) + tsc + lint on the file.
- [ ] **Step 5: Commit** `feat(identity): social-post import matches typed contacts on the verdict`.

### Task 4: «Pendientes de revisar» pairs from the verdict

**Files:**
- Modify: `src/app/actions/_adopterFactory.ts` (`findAndPersistDuplicateCandidates`), its tests, golden test. Read `tests/contract-link.spec.ts` (and any e2e that relies on a «Pendientes»/«Es la misma persona» fixture) and make sure its fixture pair is still same/possible under the verdict; if not, report it (do not edit e2e fixtures silently — note it in the report).

**Interfaces:**
- Consumes: `findPersonMatches` (Task 1).
- Produces: same signature and return type (`DupCandidateSummary[]`); returns only same/possible matches (after `skipPair`/`keep`); persists a pending pair for **every** returned match (no `PERSIST_THRESHOLD`); `confidence` column = `'high'` for same, `'medium'` for possible; `score` = `relevancePercent`.

- [ ] **Step 0: Readers.** Grep every read of `duplicateCandidates` (`score`, `confidence`: `src/app/actions/duplicates.ts`, `dashboard.ts`, `enrichAdopters.ts`, `src/app/api/admin/duplicates/route.ts`, notifications). `confidence = 'low'` is filtered out in places — same/possible never write `'low'`. Report where `score` is shown as a percentage; keep `score = relevancePercent` (spec non-goal: percentages unchanged). `householdConversion.ts:581` and `householdPeople.ts:402` also call this: they get verdict pairs too (their `skipPair` still drops housemates) — confirm their tests.
- [ ] **Step 1: Tests** — (a) case 3 (same full name, other phone) creates pairs with MJ and MP; (b) case 2 (MJ phone, other name) creates the MJ pair with confidence `medium`; (c) case 7 (DNI) pair confidence `high`; (d) existing dismissed pair untouched; (e) a retrieval failure → `[]`, a warn with `adopterId`, no pair; (f) `skipPair` still drops pairs. Golden `pendientes` column calls `findAndPersistDuplicateCandidates` for a just-inserted profile (seed the incoming person first, pass its id as `adopterId`) and reads the pairs back: 1 `[MJ, MP]`, 2 `[MJ]`, 3 `[MJ, MP]`, 4 `[MJ, MP]`, 5 `[MJ]`, 6 `[MJ, MP]`, 7 `[MJ]`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Probe → `PersonInput` (`phones` from `probe.phone`, `documentIds` from `probe.documentId`, `emails` via `extractEmails(probe.email)`, `socials` = raw values — `findPersonMatches` passes them on; no `extractSocials` blob). `excludeAdopterId: adopterId`. Country: the new profile's owner via `actor` when the probe has an owner email available in callers' ctx; otherwise null (phones still match by the index's own normalization) — take whatever the current `findAdopters` call used (it passed no country) as the floor. `skipLikeFallback` option: keep accepting it; document that the verdict path ignores it if `judgeCandidates` has no equivalent switch.
- [ ] **Step 4:** Run `_adopterFactory` tests, householdConversion/householdPeople tests (they call it), golden, tsc.
- [ ] **Step 5: Commit** `feat(identity): «Pendientes de revisar» pairs for every same/possible match`.

### Task 5: API exact — socials as identifier, DNI alone, junk guard

**Files:**
- Modify: `src/domain/apiExactMatch.ts` (+ test), `src/lib/api/profiles.ts` (`findIdentifierHits*`), `src/lib/api/schemas.ts` (`checkSearchRules`, `matchedOn` enum, `NameMatchedAs` in response), `src/lib/api/search.ts`, `src/lib/api/records.ts` only if types demand it, `src/lib/api/openapi.ts` (+ `openapi.test.ts`), `src/lib/api/docScenarios.ts` if it lists matchedOn/nameMatchedAs, golden test.

**Interfaces:**
- Produces:
  - `NameMatchedAs = 'profile' | 'alias' | 'household_member' | 'document'`.
  - `MatchedOn` / response `matchedOn` enum gains `'social'`.
  - `IdentifierSet` gains `socials: string[]` (handles); lookups use the same token the index stores for a handle (`social_handle`, normalized with the tokenizer's own handle normalizer — find it where `tokenizeAdopter` writes `social_handle`). Visible names (normalizer returns null) produce no lookup.
  - **One rule set, not two.** `runExact` builds an `IdentityCandidate` (src/domain/identityVerdict.ts) per hit profile from what it already has: `shared` from the lookups that hit it (kind + value), `namesHolding` = distinct folded names among the hit profiles holding that identifier, name + aliases from the profile read. It calls `judgeIdentity(facts, candidate)` for each. Export a lib helper (e.g. `judgeHits(person, hits)` in `src/lib/api/profiles.ts`) used by `runExact` **and** the golden test.
  - `decideExactOutcome(inputName, candidates, verdicts?: Map<string, 'same' | 'possible' | 'no'>)` (pure): with `verdicts`, the «compatible» set is the candidates judged **same** (`as` = `matchNameAgainstProfile(...)` or `'document'` when the name doesn't fit — a DNI-only same); the rest of the table is unchanged (one → `found`; one candidate not same → `ambiguous/name_mismatch`; several → `ambiguous/multiple_profiles` with `compatible` = the same ones, so `pickBestMatch` attaches to the best; none same → new profile, and the factory (Task 4) makes the pairs). Without `verdicts`, today's behavior (other callers, e.g. household code, unchanged).
  - Junk comes from the verdict (placeholder DNI, identifier on more than 3 differently-named profiles) — no separate DNI rule here.
- `checkSearchRules`: exact accepts `fullName` + any of email, phone, documentId, **socials (non-empty, at least one handle that normalizes)**; update the error message to list socials.

- [ ] **Step 1: Tests.** Domain: DNI-only + incompatible name → `found`/`document`; DNI on 2 profiles both incompatible → `ambiguous`; compatible name still wins over a DNI-only holder. API (existing api tests on migratedDb, e.g. the search/records tests): name + Instagram handle exact call → `found` with `matchedOn: ['social']`; «Majo Pérez» + MJ DNI → `found`, `nameMatchedAs: 'document'`, **no contacts added**; `00000000` DNI → not found (new profile); visible-name social on a create is saved as text with its platform (today's behavior). OpenAPI test updated for the enum values. Golden `apiExact`: 5 → `{ ambiguous: 'name_mismatch' }` (social now accepted), 7 → `{ found: MJ }`, via the same `judgeHits` helper `runExact` uses. Also run `apiExact` on cases 8–10 (they become full rows for this column): 8 `00000000` → `{ ambiguous: 'name_mismatch' }` or new-profile outcome — whatever the table gives for «JG judged no» (assert it is **not** `found`); 9 «Luis Paz» + junk email → not `found`; 10 «Gómez» is not a full name → `{ rejected: 'full_name_required' }`. Add a domain test: «Beto Sosa» + an email held by 4 names → not `found`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `findIdentifierHitsFor` records per-profile `matchedOn` including `'social'` (`IdentifierSet.socials` optional, so the sheet's sibling lookup is unchanged) and what each lookup value was, so `judgeHits` can build `shared`. `runExact` passes the verdicts to `decideExactOutcome`. `bestMatchFor` / `saveApiActivity` keep working with `nameMatchedAs: 'document'` (contacts only on `'profile'`). An incompatible name with phone/email/social keeps today's path (new profile; the factory's `findAndPersistDuplicateCandidates` — Task 4 — makes the pair). Document the two new enum values in the OpenAPI descriptions (one sentence each).
- [ ] **Step 4:** `npx vitest run src/lib/api src/domain/apiExactMatch.test.ts src/lib/identityGolden.test.ts`, tsc.
- [ ] **Step 5: Commit** `feat(api): exact mode accepts socials and matches on a DNI alone (verdict rules 1–3)`.

### Task 6: Search box and API fuzzy — «same» on top

**Files:**
- Modify: `src/app/actions/findAdopters.ts` (discovery mode), `src/lib/api/search.ts` (`runFuzzy`), golden test, discovery tests.
- Create (pure): `src/domain/queryIdentifiers.ts` + test — `extractQueryIdentifiers(q: string): { emails: string[]; documentIds: string[]; handles: string[]; rest: string }`.

**Interfaces:**
- Discovery option: `identity?: PersonInput` (structured identifiers from a caller that has them — API fuzzy). Without it, the query is parsed with `extractQueryIdentifiers` (emails; DNI-like `\d{1,2}\.?\d{3}\.?\d{3}` and 7–9 plain digits not already read as a phone by the existing phone handling; `@handle`). Only when at least one identifier exists does discovery call `findPersonMatches` (name = `rest`); every «same» id **already in the main or low list** is moved to the top of the main list (pulled from the low list if it was there). A «same» profile discovery did not return is **never** added: discovery is geo-filtered and guest-masked, retrieval is not viewer-scoped, so adding it would widen visibility (spec «Visibility unchanged»). Plain-name queries: zero extra queries, ranking unchanged.
- `runFuzzy` keeps `raw: fuzzyQueryOf(person)` for ranking and passes `identity` from the structured fields (`fullName`, `email`, `phone`, `documentId.value`, social handles).
- Verdict failure → warn (no query values in the log) and today's ranking.

- [ ] **Step 1: Tests.** `extractQueryIdentifiers` unit cases (email, `30.123.456`, `@mariajose.p`, a phone `11 6585-1333` is **not** a DNI, plain name → nothing). Golden `search`: 6 → main `[MJ]`, 7 → main `[MJ]`; all others unchanged. A discovery test that a plain-name query makes no `findPersonMatches` call (spy).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** as above. PII masking/enrichment of a promoted result must be the same as any other result (it goes through the same pipeline).
- [ ] **Step 4:** discovery/search tests + golden + tsc.
- [ ] **Step 5: Commit** `feat(search): an email, DNI or handle that identifies someone puts them on top`.

### Final

- [ ] Controller runs `tests/contract-link.spec.ts` (and any e2e touching «Pendientes»/form duplicates) locally per the local e2e harness — CI e2e blocks the deploy.
- [ ] Full `npx vitest run`, `npm run lint` (≤ 125), `npm run build`, `node scripts/check-action-surface.mjs`.
- [ ] Update the golden test header comment: every surface is on the verdict.
