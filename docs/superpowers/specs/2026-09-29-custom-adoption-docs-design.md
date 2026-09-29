# Custom adoption form and contract: design

**Status:** approved in conversation with Jon, 2026-09-28/29. Research: `docs/research/2026-09-28-adoption-forms-contracts.md`.

## Goal

Every rescuer and every group can:
1. **Form:** turn the predefined questions of the PetShield form on or off.
2. **Contract:** rewrite sections 2, 3 and 4 of the adoption contract with a small rich-text editor (bold, italics, underline, bullets).

In `/settings`, each rescuer chooses whose form and contract they use when sharing: **their own** or **one of their groups'**. One choice covers both documents.

**Overriding constraint:** nothing that works today may break. With no customization saved, or with the flag off, the form and contract are identical to today.

## Decisions (and who made them)

| # | Decision | By |
|---|---|---|
| D1 | **Any member** of a group can edit the group's form and contract. This matches today's model, where the group is the trust boundary. Editor shows "Última edición: <name>, <date>" | Jon |
| D2 | **Edited sections are shown exactly as the rescuer wrote them**, whatever the page language. Everything else (titles, section 1, section 5, signatures, chrome) follows the page locale | Jon |
| D3 | **One rich-text box per section** (2, 3, 4). Formats: bold, italic, underline, bullet list. The section number and title stay fixed and are not editable | Jon |
| D4 | **Approach A.** Settings plus contract versions. **A version becomes permanent only once signed.** A replaced version that was never signed is hidden at once and physically deleted after 30 days, so an adopter mid-signature never loses the text they read | Jon + Claude |
| D5 | **No "edited by rescuer" marker** for the adopter. A small version code goes in the PDF footer | Jon |
| D6 | **Feature flag `ENABLE_CUSTOM_ADOPTION_DOCS`**, default off. Off means: no UI, and public pages serve the standard documents even when customizations exist | Jon |
| D7 | **Which settings apply:** the form follows the **link's rescuer** (`?u=`); the contract follows the **animal's owner** (`addedBy`). If a user's chosen group is one they no longer belong to, they fall back to their own | Claude |
| D8 | **Locked form steps:** `legal`, `identity-name`, `identity-email`, `identity-phone`, `identity-address`. **Locked contract parts:** header/intro, parties, section 1, section 5, signatures | Claude |
| D9 | **Rich text is stored as a restricted JSON document, never HTML,** validated by zod on the server. The public app renders it with React elements and jsPDF text calls, so no HTML is ever injected | Claude |
| D10 | **The "unasked is not no" fix and the version recording ship regardless of the flag.** Both are invisible or only remove false text | Claude, told to Jon |

## Out of scope (later phases)

- New questions (landlord permission, photos of nets, vet reference, social handle)
- Fill-in-the-blank clauses
- Country-specific contract packs
- Group members seeing each other's applicants
- Signing an animal again overwrites the R2 file at `contracts/{animalId}/signed-contract.*`. We record every signing row, but the file itself is still overwritten

---

## 1. Data model

These are hand-written migrations. The next numbers are `0072` and `0073`.

### 1.1 `adoption_doc_settings` (one row per owner)

```sql
CREATE TABLE IF NOT EXISTS adoption_doc_settings (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,          -- 'user' | 'org'
  owner_id TEXT NOT NULL,            -- user email (lower-cased) | organizations.id
  hidden_steps TEXT,                 -- JSON string[] of step ids; NULL = none hidden
  contract_version_id TEXT,          -- current contract_versions.id; NULL = standard contract
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL           -- actor email
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adoption_doc_settings_owner ON adoption_doc_settings(owner_type, owner_id);
```

Emails are used as the user key because `animals.addedBy`, `org_members.userEmail` and `form_submissions.user_id` are already email-keyed.

### 1.2 `contract_versions` (append-only while signed)

```sql
CREATE TABLE IF NOT EXISTS contract_versions (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sections_json TEXT NOT NULL,       -- {"2"?: RichDoc, "3"?: RichDoc, "4"?: RichDoc}; absent key = standard text
  content_hash TEXT NOT NULL,        -- sha256 hex of canonical sections_json
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  first_signed_at INTEGER,           -- NULL until first signature; once set, row is immutable & never deleted
  replaced_at INTEGER                -- set when a newer version becomes current
);
CREATE INDEX IF NOT EXISTS idx_contract_versions_owner ON contract_versions(owner_type, owner_id);
```

**Saving contract sections:**
- **If the current version is unsigned:** mark it `replaced_at = now` and insert a new row. We do not update it in place, because an adopter may have it open.
- **If the current version is signed:** likewise insert a new row and set `replaced_at` on the old one.
- **If the new content equals the standard** (all three sections absent): set `contract_version_id = NULL`; no new row.
- **If the new content hash equals the current version's hash:** do nothing.
- **Lazy cleanup** runs on every save for that owner: `DELETE FROM contract_versions WHERE owner_type=? AND owner_id=? AND first_signed_at IS NULL AND replaced_at IS NOT NULL AND replaced_at < now-30d`.

### 1.3 `user_profiles.adoption_docs_source`

```sql
ALTER TABLE user_profiles ADD COLUMN adoption_docs_source TEXT;  -- NULL|'self' = own; 'org:<orgId>'
```

### 1.4 `signed_contracts` (one row per signature)

```sql
CREATE TABLE IF NOT EXISTS signed_contracts (
  id TEXT PRIMARY KEY,
  animal_id TEXT NOT NULL,
  adopter_id TEXT,                   -- adopter the signature was attached to
  contract_version_id TEXT,          -- NULL = standard contract
  standard_version TEXT,             -- STANDARD_CONTRACT_VERSION the page reported (NULL if an old SPA sent nothing)
  locale TEXT,
  content_hash TEXT,                 -- contract_versions.content_hash when custom; NULL for standard
  file_key TEXT,                     -- R2 key of the uploaded PDF/image
  via TEXT NOT NULL,                 -- 'token' | 'open'
  signed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signed_contracts_animal ON signed_contracts(animal_id);
```

### 1.5 `form_submissions.shown_steps`

```sql
ALTER TABLE form_submissions ADD COLUMN shown_steps TEXT;   -- JSON string[]; NULL for legacy rows / old SPA
```

`special_needs` is already nullable (default 0). From now on the submit route writes **NULL when the step was not shown**.

---

## 2. Domain (pure, unit-tested)

### 2.1 `src/domain/adoptionDocs.ts` (Next app)

- `FORM_STEP_IDS`: the 23 ids in form order. Mirrored in contract-app; a test asserts the two lists are equal.
- `LOCKED_FORM_STEPS`: from D8.
- `FORM_STEP_GROUPS`: groups for the editor UI.
  - `what`: species, lifeStage, specialNeeds, intent
  - `home`: children, existingPets, housingType, hasOutdoor, isSafe, hoursAlone, petExperience
  - `commitments`: willingToSterilize, vetCommitment, movingPlans, vacationPlan
  - `person`: identity-*, ageRange, geo, selfie
  - `legal` is shown separately as locked.
- `sanitizeHiddenSteps(input: unknown): string[]`: keeps known, non-locked ids only, deduplicated and in form order.
- `parseDocsSource(raw: string | null): { type: 'self' } | { type: 'org'; orgId: string }`
- `resolveDocsOwner(userEmail, source, memberOrgIds): { ownerType: 'user'|'org'; ownerId }`: an org the user is not a member of falls back to the user.
- `RichDoc` types plus a zod schema `richDocSchema`:
  ```ts
  type Mark = 'bold' | 'italic' | 'underline'
  type Inline = { text: string; marks?: Mark[] }
  type Block = { type: 'paragraph'; content: Inline[] } | { type: 'bulletList'; items: Inline[][] }
  type RichDoc = { type: 'doc'; content: Block[] }
  ```
  - Limits: at most 8,000 characters of text per section and at most 200 blocks.
  - Empty inline text is dropped.
  - A doc with no text is treated as "section absent".
- `contractSectionsSchema`: an object with optional keys `'2' | '3' | '4'`, each a `RichDoc`.
- `canonicalSectionsJson(sections)`: stable key order, used for the hash.
- `isStandardSections(sections)`: true when no keys remain after normalization.

### 2.2 contract-app `src/lib/adoptionDocs.ts` (public app)

The contract-app cannot import from `src/`, so it has its own copy:
- `FORM_STEP_IDS` (mirrored), `RichDoc` types.
- `applyHiddenSteps(schema, hiddenSteps)`: filters steps and never removes locked ids, even if the server says so.
- `STANDARD_CONTRACT_VERSION`: a short hash of the `CONTRACT_CONTENT` es/en/pt sections. A unit test pins its value, so the constant must be bumped deliberately whenever the standard text changes.
- `richDocToPlainRuns(doc)`: flattens a RichDoc into the lines and runs used by the PDF renderer.

### 2.3 Shared mirror guard

`src/domain/adoptionDocs.mirror.test.ts` reads `contract-app/src/lib/adoptionDocs.ts` as text and asserts it contains the same `FORM_STEP_IDS` literal. This catches drift without adding a cross-package import.

---

## 3. Server

### 3.1 Server actions: `src/app/actions/adoptionDocs.ts`

All actions:
- Return `{ success, data?, error?, errorId? }`.
- Log with context and emit `logAudit`.
- Check `getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS')` on writes. They refuse with `error: 'disabled'` when the flag is off.

| Action | What it does |
|---|---|
| `getAdoptionDocsOverview()` | For settings: current source, the user's orgs (id, name), and for self and each org whether it is customized plus "last edited by/at" |
| `setAdoptionDocsSource(source)` | `'self'` or `'org:<id>'`. Membership is verified. Upserts `user_profiles.adoption_docs_source` |
| `getAdoptionDocs(owner)` | `owner = { type: 'self' } \| { type: 'org', orgId }`. The caller must be that user or a member of the org. Returns `hiddenSteps`, contract `sections` (or null), `updatedBy` (display name), `updatedAt` |
| `saveFormSteps(owner, hiddenSteps)` | Sanitizes, upserts settings, audit `adoption_docs_form_saved` |
| `saveContractSections(owner, sections)` | Validates with zod and applies the version rules in §1.2. Audit `adoption_docs_contract_saved` |

**Authorization:** self is the session email. For an org, the caller must have an `org_members` row with that orgId and email. Any member may edit (D1).

**Activity feed:** add `adoption_docs_form_saved` and `adoption_docs_contract_saved` to `ACTIVITY_ACTIONS`, under a new category or the existing "team"-style one. `details.orgId` is set for org edits. The feed shows them only when the viewer is a member of `details.orgId`. Self edits are not shown.

### 3.2 Resolution helper: `src/lib/adoptionDocsResolve.ts`

`resolveDocsForRescuer(db, rescuerEmail)`:
- Returns `null` in any of these cases, which the public pages read as "standard":
  - the flag is off;
  - the rescuer has no user_profile;
  - there is no settings row.
- Otherwise returns `{ hiddenSteps: string[], contract: { versionId, sections } | null }`.
- Any DB error is logged at `warn` and returns null. **Standard is the safe fallback, and the public page is never broken.**

### 3.3 Public API changes. All additive, so old clients ignore the new fields.

**`GET /api/form/[userId]`**
- Adds `formConfig: { hiddenSteps: string[] } | null`.

**`POST /api/form/[userId]/submit`**
- Accepts an optional `shownSteps: string[]`, sanitized to known ids and stored as `shown_steps`.
- `specialNeeds` is:
  - `NULL` if `shownSteps` is present and does not include `specialNeeds`;
  - otherwise `NULL` if `shownSteps` is absent and `animalId` is present. This covers an old SPA opened for an animal, where the step was hidden;
  - otherwise today's `body.specialNeeds ? 1 : 0`.
- `species`, `lifeStage` and `intent` are already null when absent.

**`GET /api/contract/[id]` and `GET /api/contract/by-token/[token]`**
- Add `customContract: { versionId, sections } | null`, resolved for the animal's owner (`addedBy`).

**`POST /api/contract/[id]/submit`**
- Accepts an optional `contractVersionId`, `standardVersion` and `locale`.
- If `contractVersionId` is given:
  - load the row. If it is missing, log `warn` and record the signature as custom-with-unknown-version: `contract_version_id` = the given id, `content_hash` NULL. **Never reject the adopter.**
  - if the row is found, set `first_signed_at` when null.
- Always insert a `signed_contracts` row after a successful upload and adoption record.
- A failure to insert the audit row is logged at `error`, but does not fail the signature. The adopter already signed, and the PDF is stored.

### 3.4 Feature flag registration (all required places)

- `src/config/features.ts`, both places.
- `src/lib/publicConfig.ts`: `PUBLIC_FLAG_KEYS` and `PUBLIC_FLAG_DEFAULTS` (false).
- Admin config page: interface, toggle list, useState initializer, hydration.
- `src/app/api/admin/config/route.ts` GET echo.
- i18n `admin.flag_label_*` / `flag_desc_*` in es, en and pt.
- `tests/seed.sql`, if seeded flags are listed there.

---

## 4. Public app (contract-app)

### 4.1 Form: `PetShieldForm.tsx`

1. **Loading the config.**
   - On mount, `GET /api/form/{userId}` with a 3-second timeout.
   - While waiting, show the existing first step (`legal`), which is locked and always first, so nothing flashes.
   - The hidden-step list applies once it arrives. On failure or timeout: standard.
2. **Building the schema.** `applyHiddenSteps(baseSchema, hiddenSteps)`, applied after the existing `ANIMAL_QUESTION_STEPS` filter.
3. **No auto-submit.** Icon-card and segmented steps still advance on tap, **except on the last step**. There, tapping selects the answer, and an explicit "Enviar" button submits.
4. **Drafts.**
   - Storage key: `petshield_draft:{userId}:{animalId||'-'}`.
   - Contents: `{ answers, stepId }`.
   - Restore by `stepId`. If that id is not in the current schema, go to the first unanswered step at or after its old position.
   - The legacy global key `petshield_draft` is read once for migration only when it has no `stepId`: answers are restored and the index is ignored. It is then removed.
5. **Submit.**
   - Sends `shownSteps: schema.map(s => s.id)`.
   - Answers of hidden steps are stripped before sending, in case a stale draft carried them.

### 4.2 Contract: `ContractPage.tsx` and `contractPdf.ts`

- The load response's `customContract` is stored in state.
- **Rendering.**
  - For sections 2 to 4 (`sections[0..2]` in `CONTRACT_CONTENT`): if a custom doc exists for that section, render the **locale's standard section title** followed by `<RichDocView doc>`.
  - Otherwise, render the standard section exactly as today.
  - Section 5 (`sections[3]`) is always standard.
- **`RichDocView`.** Paragraphs become `<p>`. Bullet lists become `<ul class="list-disc pl-5">`. Marks become `<strong>`, `<em>` and `<u>`. Plain React children only; no `dangerouslySetInnerHTML`.
- **PDF.**
  - Custom sections are drawn run by run with jsPDF `setFont(…, 'bold'|'italic'|'bolditalic'|'normal')`. Underline is drawn with `line()`. Bullets use a "•" prefix and a hanging indent.
  - Accents are folded with the existing `stripAccents`.
  - The footer shows `v:<first 8 of versionId>` or `v:std-<STANDARD_CONTRACT_VERSION>`.
- **Submit** adds `contractVersionId`, `standardVersion` and `locale`.

### 4.3 CI and tests for contract-app

- Add `vitest` as a devDependency, plus `"test": "vitest run"`.
- `.github/workflows/contract-app.yml` runs `npm test` before the build.

---

## 5. Next app UI

### 5.1 `/settings`: `AdoptionDocsSettingsSection.tsx`

- Shown only when the flag is on (read from `/api/config`, like `FollowupSettingsSection`). Anchor: `id="adoption-docs"`.
- Card title: "Formulario y contrato de adopción".
- **"Al compartir, usar:"** is a radio list: "Los míos" plus one option per group ("Los de {group}"). Saved on change, with a toast.
- Links: "Editar los míos" goes to `/settings/adoption-docs`. "Editar" per group goes to `/settings/adoption-docs?org=<id>`.

### 5.2 `/settings/adoption-docs`: editor page

- Protected route. `/settings` is already under middleware protection; verify that subpaths are covered too.
- **Header:** "Editando: Los míos" or "Editando: {group}", plus "Última edición: {name}, {date}".
- **Tabs:** Formulario | Contrato.
- **Formulario tab:**
  - Grouped list with a switch per question. Labels come from main-app `petshield.fields.*` i18n.
  - Locked rows show a lock SVG and "Siempre se pregunta".
  - Counter: "El adoptante responde X de 23 preguntas".
  - Save button. "Restaurar por defecto" turns everything back on.
- **Contrato tab:**
  - Sections 1 and 5 are read-only previews, muted.
  - Sections 2, 3 and 4 each have:
    - a title (fixed);
    - a TipTap editor (StarterKit restricted to paragraph, bulletList, listItem, bold, italic, plus Underline);
    - a toolbar with B / I / U / bullet list;
    - a "Restaurar texto original" link.
  - Each editor is pre-filled with the standard Spanish section converted to a RichDoc: the intro as a paragraph, then each clause as a paragraph starting with a **bold "TITLE:"** run.
  - Save and disclaimer: "Sos responsable del texto de tu contrato. Te recomendamos que lo revise un abogado."
  - On save, a section whose RichDoc equals the standard conversion is sent as absent, so it stays standard and follows the adopter's locale.
- **Standard text in the Next app.** `src/domain/standardContractText.ts` holds the es section 2 to 5 text, copied from `contract-app/src/i18n/contractContent.ts`. A mirror test compares the two files' es strings for sections 2 to 5 so they cannot drift.
- **Editor conversion.** TipTap JSON is converted to a RichDoc in `src/lib/tiptapRichDoc.ts`, with a unit test. Unknown nodes are flattened to text.

### 5.3 `/organizations`

Each group card gets a secondary compact button, "Formulario y contrato", that goes to `/settings/adoption-docs?org=<id>`. It is flag-gated.

### 5.4 i18n

All new strings go in es, en and pt (Next app) and in the contract-app catalogs, for the "Enviar" button if it is not already there.

---

## 6. Error handling

- **Public pages.** Every new fetch or field falls back to "standard", and failures are logged. No new path can block an adopter from submitting or signing.
- **Server actions.** Errors return `errorId` via `logger.error`, and toasts use `userFacingMessage` / `resolveErrorId`.
- **D1.** No `inArray`; per-org lookups use `Promise.all`.

---

## 7. Testing

1. **Characterization, written before behavior changes:**
   - The contract-app standard schema's step ids equal `FORM_STEP_IDS`.
   - `applyHiddenSteps(schema, [])` returns an identical schema.
   - The pinned `STANDARD_CONTRACT_VERSION` equals the hash of today's content.
   - Contract rendering with `customContract = null` equals today's section list.
2. **Unit tests:**
   - `sanitizeHiddenSteps`, `resolveDocsOwner`, `parseDocsSource`
   - `richDocSchema` limits and normalization, `canonicalSectionsJson`, `isStandardSections`
   - the version-save decision (a pure function `planContractSave(current, next)` returning `noop | setStandard | insert`)
   - TipTap → RichDoc
   - specialNeeds null logic (a pure `deriveSpecialNeeds(body)`)
   - draft restore by step id (a pure `restoreStepIndex(schema, draft)`)
   - PDF run flattening
3. **E2E (Playwright, API level):**
   - The form submit with `shownSteps` excluding specialNeeds stores `special_needs` NULL, and `/form-results` shows no specialNeeds row.
   - Contract submit writes a `signed_contracts` row.
   - With the flag on and a saved group contract, `GET /api/contract/[id]` returns `customContract`.
   - The existing `forms.spec.ts` and `contract-link.spec.ts` stay unchanged and pass.
4. **Before enabling in staging:**
   - A manual walkthrough on staging: standard form, customized form, standard contract, edited contract, and the PDF.
   - An independent review.

## 8. Release order

1. **Next app** (migrations, API, actions, UI behind the flag) goes to staging.
2. **contract-app** deploy. It reads new fields only when present.
3. **Flag ON in staging**, walkthrough, review.
4. **Production** follows the usual staging to master flow, with the flag still OFF.
5. **Flag ON in production.**
