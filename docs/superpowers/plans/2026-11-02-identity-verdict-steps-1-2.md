# Identity verdict — steps 1–2 (verdict + sheet import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure same/possible/no verdict, fed by a retrieval that never drops a same-name candidate, and the sheet import's existing-profile check switched to it.

**Architecture:** `src/domain/identityVerdict.ts` (pure: types, `judgeIdentity`, ranking, junk rules) ← `src/lib/identityCandidates.ts` (retrieval: the duplicate engine with its name-only suppression off, plus each candidate's names/aliases and per-identifier name counts) ← `src/app/actions/importIdentityMatches.ts` (server action, one row per call) ← `SpreadsheetImportWizard` (maps verdict → «Actualizar» / «Revisar» / create). A golden test pins every surface on the same examples.

**Tech Stack:** Next.js 15 server actions, Drizzle on D1/better-sqlite3, vitest with `src/test-utils/migratedDb`.

**Spec:** `docs/superpowers/specs/2026-11-02-identity-verdict-design.md` (§3 verdict rules, §4 surface table, decisions 1–7, «Calls made in the design»).

## Global Constraints

- Layers (CLAUDE.md): `src/domain/` pure — no DB, no server imports; server actions thin.
- D1: never `inArray()` / `IN (array)`; fan out with `Promise.all`; every `.catch` logs (`logger.warn('op: D1 fallback hit', {…ctx, error})`), never silent.
- Never log names, contacts or raw tokens; ids and counts only.
- Node 20: `PATH=/opt/homebrew/opt/node@20/bin:$PATH`.
- Git: stage explicit paths only (never `-A`/`-u`/`commit -a`); never commit `local.db`, `.wrangler`, `.env.local`, `playwright.local.config.ts`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No push, no version bump, no CHANGELOG, no dev server, no Playwright.
- Verification per task: `npx tsc --noEmit` clean; `npx vitest run <files>`; at the end `npx vitest run` (all), `npm run lint` warnings ≤ 125, `npm run build` OK, `node scripts/check-action-surface.mjs` OK.
- Junk threshold: an identifier held by **more than 3** distinct (folded) names among live profiles does not count. DNI placeholders: one digit repeated 6+ times, or one of `12345678`, `123456789`, `1234567`, `87654321`.
- Rule 4 has no rarity threshold (Jon): same full name always → possible.
- Surface table (Jon-confirmed) for the sheet: top verdict `same` → `'upsert'` («Actualizar»); any `possible` → `'review'` («Revisar»); none → `'create'`.

## Review Focus

1. A placeholder DNI (`00000000`) or an email shared by 4+ differently-named profiles must never yield `same` — Task 1 + Task 2 tests.
2. A candidate found only by the contact-text LIKE fallback (`like_fallback_contact`) shares no identifier: it may only be `possible` by rule 4 — Task 1 test.
3. A one-word incoming name («Ana») with no contacts must be `no`, never `possible` — Task 1 test.
4. A row that is `same` as two profiles: the one sharing more identifier kinds comes first, the other stays listed — Task 1 ranking test + Task 4 golden case.
5. If loading a candidate's aliases or a junk count fails, the candidate must degrade to `possible` (so «Revisar»), logged — never `same`, never dropped — Task 2 test.

---

### Task 1: The verdict (pure)

**Files:**
- Create: `src/domain/identityVerdict.ts`
- Test: `src/domain/identityVerdict.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type IdentifierKind = 'document' | 'phone' | 'email' | 'social';
  export interface PersonFacts { name: string; aliases: string[]; phones: string[]; emails: string[]; socials: string[]; documentIds: string[]; country?: string | null }
  export interface SharedIdentifier { kind: IdentifierKind; value: string; /** distinct folded names among live profiles holding it; null = count unavailable */ namesHolding: number | null }
  export interface IdentityCandidate { adopterId: string; name: string; aliases: string[]; shared: SharedIdentifier[]; relevancePercent: number; matchTypes: string[]; matchValues: Array<{ type: string; value: string }>; /** details failed to load */ degraded?: boolean }
  export type Verdict = 'same' | 'possible' | 'no';
  export type VerdictReason = 'shared_document' | 'shared_contact_name_compatible' | 'shared_contact_name_differs' | 'same_full_name' | 'details_unavailable';
  export interface Judged { candidate: IdentityCandidate; verdict: Verdict; reason: VerdictReason | null }
  export const MAX_NAMES_PER_IDENTIFIER = 3;
  export function isPlaceholderDocument(normalized: string): boolean;
  export function countsAsShared(id: SharedIdentifier): boolean;  // not placeholder (documents), namesHolding !== null && <= MAX_NAMES_PER_IDENTIFIER
  export function judgeIdentity(incoming: PersonFacts, candidate: IdentityCandidate): Judged;
  export function rankJudged(list: Judged[]): Judged[];  // drops 'no'
  ```

- [ ] **Step 1: Write the failing tests** — `describe('judgeIdentity')`, one `it` per rule, using a `cand({...})` helper:
  - DNI shared, name «Majo Pérez» vs «María José Pérez» → `{ verdict: 'same', reason: 'shared_document' }`.
  - phone shared, «María Pérez» vs «María José Pérez» → `same`, `shared_contact_name_compatible`; same with the name matching an alias only → `same`.
  - phone shared, «Juan Carlos Ruiz» vs «María José Pérez» → `possible`, `shared_contact_name_differs`.
  - social shared, «Majo Pérez» vs «María José Pérez» → `possible` (decision 3: a social never alone).
  - nothing shared, «María José Pérez» vs «María José Pérez» → `possible`, `same_full_name`; «María Pérez» vs «María José Pérez» → `possible`.
  - nothing shared, «Ana» vs «Ana Gómez» → `no`; «Juan Gómez» vs «María José Pérez» → `no`.
  - only `matchTypes: ['like_fallback_contact']`, `shared: []`, names incompatible → `no` (Review Focus 2).
  - DNI `00000000` shared → treated as not shared (`isPlaceholderDocument('00000000') === true`, also `11111111`, `12345678`; `30123456` false).
  - email shared with `namesHolding: 4` → not shared → with incompatible name `no`; `namesHolding: 3` → counts.
  - `namesHolding: null` on the only shared identifier → `possible`, `details_unavailable`; `degraded: true` candidate with a shared DNI → `possible`, `details_unavailable` (Review Focus 5: degraded never `same`).
  - `describe('rankJudged')`: `same` before `possible`; two `same` → more distinct shared kinds first, then candidate whose own name (not alias) is compatible, then higher `relevancePercent`; `possible` by `relevancePercent` desc; `no` removed.
- [ ] **Step 2:** `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/domain/identityVerdict.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** in `src/domain/identityVerdict.ts`. Names via `namesCompatible` / `matchNameAgainstProfile` / `nameWords` from `./apiExactMatch` (one name rule). Rule order = spec §3 table; rule 4 requires `nameWords(...)` length ≥ 2 on **both** names. Document normalization: lowercase, strip non-alphanumerics (same as `normalizeIdValue`).
- [ ] **Step 4:** rerun → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `src/domain/identityVerdict.ts src/domain/identityVerdict.test.ts` — `feat(identity): one same/possible/no verdict (pure)`.

### Task 2: Candidate retrieval

**Files:**
- Modify: `src/app/actions/types.ts` (`FindAdoptersOptions`), `src/app/actions/findAdopters.ts` (`runDuplicateMode`, the v2.19.24 suppression block)
- Create: `src/lib/identityCandidates.ts`
- Test: `src/lib/identityCandidates.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  // FindAdoptersOptions
  /** Duplicate mode: keep name-only candidates even when the input carried an identifier none of them share (identity verdict, rule 4). */
  keepNameOnly?: boolean;
  // src/lib/identityCandidates.ts
  export async function findIdentityCandidates(db: Db, facts: PersonFacts, ctx: Record<string, unknown>, opts?: { limit?: number }): Promise<IdentityCandidate[]>;
  export async function judgeCandidates(db: Db, facts: PersonFacts, ctx: Record<string, unknown>, opts?: { limit?: number }): Promise<Judged[]>; // retrieval → judgeIdentity → rankJudged
  ```

- [ ] **Step 1: Failing tests** (real SQL: copy the mock header of `src/lib/householdSearch.test.ts` lines 15–61; seed with `INSERT INTO adopters (… contact_entries, contact_info)` + `tokenizeAdopter`). Seed: María José Pérez (+54 9 11 6585 1333, maria.perez@gmail.com, id 30123456, social instagram `mariajose.p`), María Pérez (+54 9 11 4444 5555), Juan Gómez (+54 9 11 7777 8888).
  - «María José Pérez» + phone `11 2222-3333` → candidates include María José Pérez with `shared: []` (proves suppression is off).
  - «María Pérez» + `11 6585-1333` → María José Pérez has `shared` `[{kind:'phone', namesHolding: 1}]`.
  - «Majo Pérez» + document `30.123.456` → `shared` contains `{kind:'document', value:'30123456'}`.
  - an alias entry (`type:'alias'`) on a seeded profile is returned in `aliases`.
  - email shared by 4 profiles with 4 different names → that identifier's `namesHolding === 4`.
  - soft-deleted profile sharing the phone → absent.
  - forced failure of the per-candidate detail read (`vi.spyOn` on the db select, or a closed db for that query) → candidate still returned with `degraded: true`, `logger.warn` called with `adopterId` (Review Focus 5).
  - `judgeCandidates` on «Juan Carlos Ruiz» + `11 6585-1333` → `[{ verdict: 'possible', candidate: María José }]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
  - `keepNameOnly`: when true, skip only the `if (hasStrongInputSignal) { … continue }` suppression; default unchanged (every other caller keeps today's behavior).
  - `findIdentityCandidates`: call `findAdopters({ name, aliases, phones, emails, socials, ids: documentIds, country }, { mode: 'duplicate', keepNameOnly: true, minRelevance: 5, limit: opts.limit ?? 5 })`. From each result's `matchValues` derive `shared`: `phone`/`phone_suffix` → phone, `email` → email, `social`/`social_handle` → social (one per handle), `id_number` → document; `like_fallback_*` and name types never. Per candidate, one read of `adopters.name, contact_entries` (aliases = entries of type `alias`). Per distinct shared `(tokenType, tokenValue)`, one query: names of live adopters holding that token (`duplicate_tokens` join `adopters`, `deleted_at IS NULL`, `LIMIT 10`), folded (NFD, lowercase, trimmed) and counted distinct → `namesHolding`. Each read `.catch` → warn + `degraded`/`null`. Bound: ≤ `limit` detail reads + ≤ 12 count queries per call.
- [ ] **Step 4:** rerun → PASS; `npx vitest run src/app/actions` (duplicate-mode callers unchanged); tsc clean.
- [ ] **Step 5: Commit** the four files — `feat(identity): candidate retrieval that keeps same-name candidates`.

### Task 3: Server action for one sheet row

**Files:**
- Create: `src/app/actions/importIdentityMatches.ts`; Test: `src/app/actions/importIdentityMatches.test.ts`
- Modify: `src/app/actions/index.ts` (export next to `findIdenticalRowsOtherMatches`), `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS` 172 → 173 with a dated sign-off comment: "matchImportRow — sheet import identity verdict, spec 2026-11-02")

**Interfaces:**
- Consumes: `judgeCandidates`.
- Produces:
  ```ts
  export interface ImportRowIdentity { name: string; phones: string[]; emails: string[]; socials: string[]; documentIds: string[] }
  export interface JudgedMatch extends DuplicateMatch { verdict: 'same' | 'possible'; reason: VerdictReason | null }
  export async function matchImportRow(row: ImportRowIdentity): Promise<{ ok: true; matches: JudgedMatch[] } | { ok: false; errorId: string }>;
  ```

- [ ] **Step 1: Failing tests** (actionMocks + migratedDb, same seed): signed-out → `{ ok: false }` with no DB read (gate as `findIdenticalRowsOtherMatches`: `getUser` + `isRealActorEmail`); inputs trimmed and capped (≤ 5 values per list, ≤ 200 chars each, name ≤ 200); «María Pérez» + `11 6585-1333` → first match María José `verdict: 'same'`, then María Pérez `possible`; at most 3 matches returned; a thrown retrieval → `{ ok: false, errorId }` via `logger.error` with `{ actor }` context.
- [ ] **Step 2:** FAIL. **Step 3:** implement (country from `ownerCountry`-style lookup is not needed: pass `null`, the phone reader defaults as the import does today). **Step 4:** PASS; `npm run build` then `node scripts/check-action-surface.mjs` → OK at 173.
- [ ] **Step 5: Commit** the four files — `feat(import): matchImportRow — identity verdict per sheet row`.

### Task 4: Sheet import uses the verdict

**Files:**
- Modify: `src/domain/importMerge.ts` (+ `importMerge.test.ts`), `src/components/SpreadsheetImportWizard.tsx` (`runDetection` worker ~l.725–770, bulk apply ~l.1114, row display ~l.1934), `src/domain/importGrouping.ts` (+ `importGrouping.test.ts`)

**Interfaces:**
- Consumes: `matchImportRow`, `JudgedMatch`.
- Produces: `export function defaultImportAction(matches: Array<{ verdict: 'same' | 'possible' }>): 'upsert' | 'review' | 'create'` in `importMerge.ts`.

- [ ] **Step 1: Failing tests:** `defaultImportAction([])` → `'create'`; `[same]` → `'upsert'`; `[same, possible]` → `'upsert'`; `[possible]` → `'review'`. `importGrouping`: «Ana Pérez» ~ «Pérez Ana» now grouped (order-free, `namesCompatible`); «María Pérez» ≁ «Juan Pérez» still; «Ana» ~ «Ana Gómez» still grouped (one-word side).
- [ ] **Step 2:** FAIL. 
- [ ] **Step 3: Implement.**
  - Worker: replace the `findAdopters(… mode 'duplicate' …)` call with `matchImportRow({ name, phones, emails, socials, documentIds: g.ids })` (keep the 3 attempts with backoff and fail-closed path; `{ ok: false }` counts as a failed attempt). `found[index] = matches[0] ?? null`, `others[index] = matches.slice(1)`, `actions[index] = defaultImportAction(matches)`. Remove the «DNI via labeled contactInfo» workaround (ids now go typed).
  - Bulk «apply to all exact» (l.1114) and the row's exact flag (l.1934): `identical || m.verdict === 'same'` instead of `isExactIdentifierMatch`. The identical-copy path (Phase 1) keeps `matchTypes: ['identical']` and counts as same. Widen the `matches`/`otherMatches` state to `DuplicateMatch & { verdict?: 'same' | 'possible' }`.
  - `importGrouping.namesAgree` delegates to `namesCompatible`; keep its export and particle stripping only if tests need it — otherwise remove `NAME_PARTICLES` dead code.
  - Remove `isExactIdentifierMatch` if no caller remains (grep `src/`); else leave.
- [ ] **Step 4:** `npx vitest run src/domain src/components` PASS; tsc clean; `grep -rn "isExactIdentifierMatch" src` reported in the task report.
- [ ] **Step 5: Commit** the changed files — `feat(import): «Actualizar» only for the same person, «Revisar» for possible`.

### Task 5: Golden test — every surface, same examples

**Files:**
- Create: `src/lib/identityGolden.test.ts`

**Interfaces:**
- Consumes: `matchImportRow`, `findAdopters`, `findAdoptersAsViewer`, `findWeakNameMatches`, `searchFormDuplicates`, `findIdentifierHits` + `decideExactOutcome`, `dupHintSearchInput`, `fuzzyQueryOf`, `confidenceBand`.

- [ ] **Step 1: Write the test.** Seed as Task 2. Cases (incoming → surface expectations). Sheet = `matchImportRow` → `defaultImportAction` + first match; every other surface is called exactly as its screen calls it today (form: `searchFormDuplicates({name, phones, emails, socials}, {minRelevance: 15})`; post import: `findAdopters({ name, contactInfo: contactEntriesToBlob(entries) }, { mode: 'duplicate' })`, pre-selected iff top ≥ 75%; warning: `findAdopters(dupHintSearchInput(type, value), { mode: 'duplicate', limit: 3, minRelevance: 5 })` on the row's first contact; «Pendientes»: duplicate mode `{ minRelevance: 0, limit: 5 }` with `ids`, pairs ≥ 30; API exact: rules + `findIdentifierHits` + `decideExactOutcome`; search: `findAdoptersAsViewer({ raw: fuzzyQueryOf(person) })` main vs low list).

  | # | Incoming | Sheet (new) | Form · post · warning · Pendientes · API exact · search (today) |
  |---|---|---|---|
  | 1 | María Pérez + 11 6585-1333 | upsert → María José; María Pérez listed | MJ shown · MJ listed, not pre-selected · MJ · MJ pair · found MJ · MJ main |
  | 2 | Juan Carlos Ruiz + 11 6585-1333 | review → María José | MJ · MJ listed · MJ · MJ pair · new profile (name_mismatch) · MJ main |
  | 3 | María José Pérez + 11 2222-3333 | review → María José (and María Pérez) | none · none · none · none · not_found · MJ low |
  | 4 | María José Pérez | review → María José, María Pérez | MJ, MP · MJ, MP · n/a · MJ pair · rejected (needs identifier) · MJ main |
  | 5 | Majo Pérez + Instagram mariajose.p | review → María José | MJ · none · MJ · MJ pair · rejected · MJ low |
  | 6 | Maria Peres + maria.perez@gmail.com | upsert → María José | MJ · MJ listed · MJ · MJ pair · found MJ · MJ low |
  | 7 | Majo Pérez + DNI 30.123.456 | upsert → María José | none · MJ listed · MJ · MJ pair · new profile (name_mismatch) · MJ low |
  | 8 | Ana Ruiz + DNI 00000000 (seed: Juan Gómez also holds DNI 00000000) | create | — |
  | 9 | Luis Paz + luis@x.com (seed: 4 profiles, 4 different names, all luis@x.com; none named Luis Paz) | create | — |

  Assert profile ids and actions only (no percentages). Name the file's top comment: "Today's behavior is pinned for surfaces not yet on the verdict; each rollout step flips its own column (spec §Rollout)."
- [ ] **Step 2:** `npx vitest run src/lib/identityGolden.test.ts` → PASS (Tasks 1–4 done; today-columns match the 2026-11-02 run).
- [ ] **Step 3:** Full verification (Global Constraints list): `npx vitest run`, `npm run lint` (≤ 125), `npm run build`, `node scripts/check-action-surface.mjs`.
- [ ] **Step 4: Commit** `src/lib/identityGolden.test.ts` — `test(identity): golden table across every surface`.
