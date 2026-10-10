# Interview guide (phone interview helper) — design spec

**Status:** design approved by Jon 2026-10-04 · not built · flag `ENABLE_INTERVIEW_GUIDE` (off)
**Phase 1** = standalone tool + start from a profile. **Phase 2** = start from a form applicant + tie to an animal (outlined at the end; gets its own plan).

## 1. Purpose

Rescuers vet adopters by phone. Today they improvise: they forget to ask for identifiers that would reveal an existing profile, they ask yes/no questions that invite the "right" answer, and what they learn ends up in WhatsApp notes instead of the profile.

The interview guide walks the rescuer through a structured call:

1. **Prepare.** Enter what you already know. See who it might be.
2. **Learn the technique.** Three stages, modelled on how border officers interview: build rapport → open questions that let the person tell their story → detail questions that check the story for inconsistencies.
3. **Interview.** A question list that adapts as you go. It helps **dedup** (collect identifiers, tell candidate profiles apart) and **learn** (home, household, past animals, routine).
4. **Save.** Write it to the confirmed profile (or a new one), with an optional rating.

**Success:**
- A rescuer can run a 15-minute call without leaving the page.
- Every answer is saved, and survives a dropped call or a device switch.
- New identifiers trigger a match check during the call.
- Nothing is ever written to a profile the rescuer did not explicitly confirm.

## 2. Decisions (all made with Jon, 2026-10-04)

| # | Decision |
|---|---|
| D1 | **Answers are saved to the profile.** The interview record holds the answers. New contact details and household members are added to the profile (rescuer can untick each). If there was no match, a new profile is created. |
| D2 | **Confirmation happens at save, not before.** During the call, uncertain matches stay *candidates*, and the engine adds questions that tell them apart. The review screen requires an explicit choice: a candidate profile or "persona nueva". No write ever targets an unconfirmed profile. |
| D3 | **Entry points:** standalone (`/interview`), from a profile, from a form applicant, tied to an animal. Phases 1 and 2 as above. |
| D4 | **Questions are rule-based, not AI.** A pure engine picks the next questions from a static bank. No Gemini, no per-answer cost, no personal data leaves the system. An optional "suggest a follow-up" AI button may come later, only if the rules feel rigid. |
| D5 | **Content:** Claude drafts the Spanish bank (~40 questions) and the coaching text, then generates EN/PT. Jon edits the Spanish before flag-on. Content lives in code (not Keystatic). |
| D6 | **Layout:** side rail + focus panel. On desktop, the left rail lists every question grouped by stage and the right panel shows the current question. On mobile, the rail becomes a "Preguntas 5/18" drawer. |
| D7 | **Answer visibility:** the interviewer, the profile's owner, the owner's org-mates and admins. Everyone else sees only that an interview happened (who and when). Never shown on public profiles or the showcase. |
| D8 | **Rating:** optional 1–5 plus a short summary on the review screen. It is stored as a normal **observation**, so it feeds `avgRating` and the semáforo unchanged. The observation (rating + summary) has observation visibility (all rescuers). The answers keep D7 visibility. |
| D9 | **Address in Phase 1** is a *verification* question only, never a match input. Duplicate mode has no address token, and discovery `raw` is the known LIKE-scan scaling problem. |

## 3. The rescuer's experience

### 3.1 Start
- **Standalone:** user menu → "Entrevista" → `/interview`.
- **From a profile:** an "Entrevistar" button on `AdopterProfileV2` opens `/interview?adopterId=…`. This skips Preparation: the profile is the only candidate and starts **confirmed**, because the rescuer chose it while looking at it.
- **Resuming a draft:** `/interview` lists the rescuer's open drafts at the top ("Continuar entrevista con Juan · hace 2 h").

### 3.2 Preparation
- Fields: name (required, at least 2 characters), phones, socials, email, address. Repeatable rows use the existing `ContactEntriesSection` patterns.
- Candidates appear while typing (debounced) via `findFormDuplicates`. This is the same engine and masking as the add-adopter form, rendered with the existing `DuplicatePeek` card style.
- For each candidate the rescuer can choose "probablemente es esta persona" (this makes it the lead candidate) or leave it alone. Nothing is confirmed here.
- "Comenzar" is enabled once a name is entered.

### 3.3 Technique screen
- Three stage cards, each with a one-line goal and 3–4 tips:
  - **Confianza** (rapport): introduce yourself and the animal; ask easy, warm questions; explain why you ask.
  - **Historia** (open narrative): "contame…", "¿cómo es un día normal?"; let them talk; don't interrupt; don't reveal what you already know.
  - **Detalles** (probing): go back to specifics they mentioned; ask *what happened*, not *would you*; note hesitations and contradictions without accusing.
- The rescuer can tick "No volver a mostrar" (per-viewer `localStorage` convenience, wrapped in try/catch). During the interview, a "Técnica" button in the header reopens it as a sheet.

### 3.4 Interview
**Header**
- Interviewee name.
- Candidate status: "2 posibles perfiles" or "✓ Perfil: Juan Pérez".
- Stage progress: Confianza ─ Historia ─ Detalles.
- Buttons: "Técnica" and "Terminar".

**Rail** (desktop: left column; mobile: drawer under the `h-16` nav). Questions are grouped by stage, each with a state:
- ✓ answered (with a short answer preview)
- ▶ current
- ○ upcoming
- ➕ added mid-call (with a one-line reason, e.g. "por: mencionó un perro anterior")
- ⤼ skipped
- ∅ didn't answer

Tapping any item makes it current, so past answers can be edited.

**Focus panel**
- Stage label, the question in large type, and an optional technique hint (💡, one line).
- An answer input whose kind depends on the question:
  - `text`: textarea
  - `contact`: typed rows for phone / email / social, reusing contact-entry input components
  - `household`: name + relationship rows, reusing `HouseholdMember` shape
  - `choice`: chips (e.g. housing type)
  - `number`
- A **verification hint**, when the question checks a known fact (§4.4).
- Actions: "Saltar", "No respondió", "Siguiente →". "+ Agregar pregunta" (free text, own answer) lives at the bottom of the rail.

**Adaptive behaviour**
- After each answer, the engine recomputes the queue (§4). Answered questions never move. Only upcoming questions are re-ordered, added or dropped.
- When a `contact` or `household` answer adds an identifier, the match check re-runs with everything known so far. A new candidate appears in the header with a subtle "nuevo posible perfil" pulse, and the engine adds discriminating questions.

**Autosave**
- Every answer change saves the draft (debounced ~800 ms, plus on blur and on "Siguiente").
- A small status reads "Guardado" / "Guardando…" / "Sin conexión — reintentando".
- Leaving and returning, or opening on another device, resumes exactly where the rescuer left off.

### 3.5 Review & save ("Terminar")
1. **Who was it?** A radio list of candidates (masked cards) plus "Persona nueva". Required: no default selection unless the interview started from a profile.
2. **What to add to the profile.** A checklist of new identifiers and household members collected during the call, all ticked by default:
   - Values already on the profile are shown as "ya está" and are not re-added.
   - If the rescuer is not allowed to edit that profile's core record (`canEditAdopterRecord` false), the checklist explains "quedará en la entrevista; el responsable del perfil puede agregarlo" and nothing is added to the profile.
3. **Rating + summary.** Optional 1–5 (the existing rating control) and a summary textarea, labelled "Visible para todos los rescatistas".
4. **"Guardar entrevista"** shows the optimistic spinner, then navigates to the profile. Errors use `userFacingMessage` / `resolveErrorId` toasts.

The interview appears on the profile timeline as the observation row, with a badge "Entrevista" and a link "Ver respuestas" for D7 viewers. Others see "Entrevista · Ana · 3 oct" plus rating and summary, with no link.

## 4. Question engine (`src/domain/interview/`)

Pure functions with no DB or server imports, covered by vitest.

### 4.1 Model
```ts
type Stage = 'rapport' | 'story' | 'details';
type AnswerKind = 'text' | 'contact' | 'household' | 'choice' | 'number';
type Topic = 'identity' | 'contact' | 'home' | 'household' | 'pets_past' | 'pets_current' | 'routine' | 'motivation' | 'work';

interface QuestionDef {
  id: string;                    // stable, e.g. 'story.typical_day'
  stage: Stage;
  topic: Topic;
  kind: AnswerKind;
  textKey: string;               // i18n: interview.q.<id>
  hintKey?: string;              // i18n technique hint
  choices?: string[];            // i18n keys for kind='choice'
  fills?: FactKey[];             // facts this question can establish
  when?: (ctx: InterviewContext) => boolean;  // applicability
  priority: number;              // base ordering inside a stage
  dedup?: boolean;               // helps identify the person
}

interface InterviewContext {
  known: KnownFacts;             // from preparation + typed answers
  answers: Record<string, Answer>;
  candidates: CandidateSummary[];  // masked; see 4.4
  confirmedAdopterId?: string;
  source: { kind: 'standalone' | 'profile' };  // Phase 2 adds 'form' | 'animal'
}

interface QueueItem {
  questionId: string;            // bank id, or 'followup:<id>:<n>', or 'custom:<n>'
  state: 'answered' | 'current' | 'upcoming' | 'skipped' | 'no_answer';
  addedReason?: string;          // i18n key + params for ➕ items
  verify?: VerifySpec;           // see 4.4
}

function buildQueue(ctx: InterviewContext, prev: QueueItem[]): QueueItem[];
```

### 4.2 Selection rules
- **Stage order** is rapport → story → details. Within a stage, order by `priority`, then dedup-first.
- **Gap-filling:** a question whose `fills` facts are already known (from preparation, the confirmed profile's *visible* data, or earlier answers) is dropped from upcoming. Example: phone known → skip "¿cuál es tu teléfono?", but keep "¿usaste otros números?".
- **Dedup boost:** while there are ≥1 unconfirmed candidates, `dedup` questions move to the front of the current stage.
- **Discriminators:** with ≥2 candidates, add questions about facts where candidates differ in *non-masked, non-sensitive* attributes (e.g. city/locality, household size, has/had a returned animal). These are phrased as open questions, never "¿sos Juan Pérez de Quilmes?".
- **Follow-ups (Detalles stage):** some answers trigger follow-up questions. Matching is a deterministic keyword scan over the answer text in es/en/pt, kept in the bank next to each question:
  - mentions a previous pet → "¿qué pasó con él/ella?", "¿cuándo y dónde?"
  - mentions moving house → "¿dónde vivías antes y cuánto tiempo?"
  - mentions a partner/roommate → household follow-up
  - "rented" housing choice → "¿el contrato permite animales?"
- **Consistency probes:** for pairs of related facts (e.g. "years at current address" vs. "where they lived when they had their previous dog"), add a details-stage question that asks about the second fact *without* quoting the first. The rescuer compares the answers; the engine never declares a contradiction.
- **Cap:** at most 25 upcoming items at a time, to avoid choice overload. Lower-priority items are dropped first.

### 4.3 Bank
- `bank.ts` holds ~40 `QuestionDef`s across the 3 stages.
- Copy lives in `interview.*` keys in **es, en and pt** (all three; missing one is a TS error).
- Jon reviews the Spanish before flag-on (D5).

### 4.4 Verification hints (privacy-critical)
A question that asks the interviewee to state a fact a candidate profile already has carries `verify: { candidateId, factKey }`. The hint the rescuer sees depends on visibility:
- **Fact visible to this rescuer** (their own profile, an org-mate's, a granted entry, or a profile with gating off): show the stored value beside the input. Example: "🔒 En el perfil: 11-5555-…". Show it as the masked/visible form search already returns.
- **Fact protected from this rescuer:** show nothing up front. After the answer is entered, show only "✓ coincide con el perfil" / "✗ no coincide". The comparison runs **server-side** (a normalized compare, the same normalization as `tokenizer.ts`), and only the boolean is returned. This preserves the rule "you can confirm a detail you already have, never learn one".
- Candidate data reaching the client comes only from `findFormDuplicates` → `hydrateDuplicateMatches`, which applies `isPiiGatingEnabled` → `resolveAdoptersVisibility` → `maskAdopterContact`. Never select raw `adopters.contactInfo` / `addressInfo` into a client payload. See the match-card leak note.

## 5. Data

### 5.1 New table `interviews` (hand-written migration, as drizzle-kit generate hangs)
| column | type | notes |
|---|---|---|
| `id` | text pk | |
| `conducted_by` | text not null | session email |
| `status` | text not null | `'draft' \| 'completed' \| 'discarded'` |
| `source_kind` | text not null | `'standalone' \| 'profile'` (Phase 2: `'form' \| 'animal'`) |
| `source_id` | text | adopterId for `profile`; Phase 2: form submission / animal id |
| `prep_json` | text | preparation facts |
| `queue_json` | text | the `QueueItem[]` snapshot |
| `answers_json` | text | `Record<queueItemId, Answer>` |
| `candidate_ids_json` | text | adopter ids seen as candidates |
| `adopter_id` | text | set only at completion (the confirmed or new profile) |
| `event_id` | text | the observation row created at completion |
| `created_at`, `updated_at`, `completed_at` | integer timestamps | |

Indexes: `(conducted_by, status)` for drafts, `(adopter_id)` for the profile link, `(event_id)`.

### 5.2 On completion (one server action, one sequence)
1. Re-check authorization and the flag. The confirmed adopter must be one of `candidate_ids_json`, the interview's `source_id`, or a new profile.
2. **New person:** create the adopter through the existing create path, with `source = 'manual'`. This creates dup tokens and history the normal way.
3. **Ticked additions:** add them through the existing adopter save path, so the history and audit trail record them and dup tokens refresh. Only when `canEditAdopterRecord` allows it.
4. **Observation:** always (it anchors the interview on the timeline), insert an `adopter_events` row with `event_type = 'observation'`, `rating` (NULL when skipped; confirm `computeAvgRating` ignores NULL), `details = summary`, `recorded_by = conductedBy`, `date = now`.
5. Set `interviews.status = 'completed'`, `adopter_id`, `event_id`, `completed_at`.

D1 has no multi-statement transactions across these helpers. Order the steps so that a failure leaves the interview a recoverable **draft**: the status flips last. Retrying is idempotent: if `event_id` is already set, skip step 4.

### 5.3 Reading
- **Profile timeline:** for observation rows, look up `interviews` by `event_id` (fan out per id; no `inArray`, which D1 breaks). Add `{ isInterview, canViewAnswers }` to the row.
- **"Ver respuestas"** opens `/interview/<id>` read-only, with D7 access checked server-side.

## 6. Server surface

New server actions (each: session required, `getFeatureFlag('ENABLE_INTERVIEW_GUIDE')` true, otherwise refuse; ownership checks as listed):

| action | who | does |
|---|---|---|
| `saveInterviewDraft(id?, patch)` | conductor only | upsert draft; recompute queue server-side via `buildQueue`; returns queue |
| `getInterview(id)` | conductor (draft); D7 viewers (completed) | returns interview; candidate data re-hydrated masked |
| `listMyInterviewDrafts()` | session | resume list |
| `findInterviewCandidates(known)` | session | wraps `findFormDuplicates` with all known identifiers (no address) |
| `verifyInterviewFact(id, candidateId, factKey, value)` | conductor | returns `{ match: boolean }` only; candidate must be in the interview's candidate list |
| `completeInterview(id, { adopterId \| 'new', additions, rating?, summary? })` | conductor | §5.2 |
| `discardInterviewDraft(id)` | conductor | status → discarded |

- `scripts/check-action-surface.mjs` → raise `EXPECTED_ACTIONS` in the same commit, with a per-action sign-off note.
- Run `npm run build` before pushing: a sync export in a `'use server'` file passes tsc but fails the build.
- **Logging:** log ids, counts and outcome only (`{ interviewId, adopterId, candidateCount, answeredCount }`). **Never** log answers, prep facts or identifiers. Every catch re-emits that context.
- **Route gating:** `/interview` and `/interview/[id]` are added to `PROTECTED_ROUTES` in `src/middleware.ts`. The pages call `notFound()` when the flag is off.

## 7. Feature flag `ENABLE_INTERVIEW_GUIDE` (default off)

Register in every place:
- `src/config/features.ts`: `FEATURE_FLAGS` **and** the `getAllFeatureFlags` literal
- `src/lib/publicConfig.ts`: `PUBLIC_FLAG_KEYS` + defaults map (the client needs it for the menu item and profile button)
- `src/app/admin/(admin-only)/config/page.tsx`: type, flag list entry, defaults, parse
- `src/app/api/admin/config/route.ts`: default
- i18n `flag_label_interview_guide` / `flag_desc_interview_guide` in es/en/pt
- `tests/seed.sql` for parity

Client surfaces (menu item in `UserMenu`, "Entrevistar" on `AdopterProfileV2`) read `/api/config`.

## 8. UI build notes

- Follow `docs/design-style-guide.md` (8px grid, themed tokens only, Typeform-style inputs, inputs ≥16px) and `docs/ux-ui-guidelines.md` (labels above inputs, wizard chunking, toasts with errorId).
- Icons are inline SVG with `currentColor`. The ✓ ▶ ○ ➕ glyphs in this doc are placeholders.
- **The rail is one DOM tree**, restyled by breakpoint (column ≥ md, bottom-sheet/drawer < md), never two copies. Duplicate copies break `.first()` / `toBeVisible`. The drawer sits below the sticky `h-16` nav.
- **Components:** `InterviewPrep`, `InterviewTechnique` (screen + sheet), `InterviewRail`, `InterviewFocusPanel`, `InterviewAnswerInput` (switch on kind), `InterviewReview`, `InterviewReadOnly`. Page shells are `src/app/interview/page.tsx` and `src/app/interview/[id]/page.tsx`.
- Keyboard: Enter = Siguiente in single-line inputs, ⌘/Ctrl+Enter in the textarea.

## 9. Testing

- **Unit (vitest)** over `src/domain/interview/`:
  - gap-filling drops filled questions
  - dedup boost with candidates
  - discriminators only for non-masked differing facts
  - follow-up triggers in es/en/pt
  - answered items never move
  - cap at 25
  - queue is deterministic for the same input
- **Unit:** the server-side verification compare returns only a boolean, and normalizes phones the same way the tokenizer does.
- **Unit:** the completion orchestration order (status flips last; retry is idempotent).
- **E2E (Playwright, locale-agnostic bilingual selectors, dedicated `test-interview-fixture-*` rows):**
  - flag off → `/interview` 404 and no menu item
  - standalone: prep → candidate appears → interview → new phone triggers a second candidate → complete with "persona nueva" → profile shows the Entrevista row
  - from profile: starts confirmed, skips prep
  - draft resumes after reload
  - another rescuer sees the row without "Ver respuestas"
  - layout measured at 1280 and 390 (no horizontal scroll; drawer works)
- **Staging walkthrough** with `ENABLE_PII_ACCESS_GATING=true` before flag-on (local browser verification is not valid).
- **Independent review** of the server actions (auth/PII-adjacent) before production.

## 10. Out of scope (Phase 1)

- AI-written questions (D4); address matching (D9); Keystatic-editable bank (D5)
- Audio recording or transcription of the call
- Sharing the interview outside the app; exporting
- Editing a completed interview (re-open would be a later addition)

## 11. Phase 2 outline (own plan later)

- **From a form applicant:** start from a form submission. Its answers seed `known` facts and its identifiers seed the candidates. The engine adds consistency probes against the written answers (asked openly, never quoting them). On save, link to the submission's `linkedAdopterId`/`autoAdopterId` per the form-link model.
- **Tied to an animal:** pick one of your animals. Species/age-specific questions (energy, time alone, space, experience with puppies/seniors). The interview stores `source_id = animalId`, and the observation shows the animal name.
- Both need only new `source.kind` values, bank rules and entry buttons. The table and engine are designed for them now.
