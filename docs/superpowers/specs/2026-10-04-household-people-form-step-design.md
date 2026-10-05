# Adoption form: "¿Quiénes viven en la casa?" — design

Date: 2026-10-04 · Status: approved in conversation, awaiting spec review
Decided by: Jon (product) · Written by: Claude

## Goal

Rescuers vetting an applicant want to know **who lives in the home**: a toddler,
teenagers, a partner, roommates, an elderly parent. Today the form asks only
"¿Hay niños?" (No / 1 / 2 / 3+). This adds an alternative step that lists the
people, with their relationship and age, which the rescuer can choose instead.

Success:
- A rescuer who picks the new step sees, on the form screen, each person with
  relationship and age and a semáforo dot.
- People given a full name land on the applicant's profile as household
  members, and feed duplicate detection like relatives already do.
- Every profile links to every form submitted for it, from its history.
- Nothing changes for any rescuer who does not opt in.

## Decisions (Jon, 2026-10-03/04)

| Topic | Decision |
|---|---|
| Per person | Relationship + **exact typed age** (required) + Nombre and Apellido (optional) |
| Relationship to the old question | **Alternative**, picked per form in Ajustes → Formulario y contrato. **Default stays "¿Hay niños?"** |
| Wording | **"¿Quiénes viven en la casa?" / "…en el departamento?"** from the housing-type answer. Asked **after** housing type (and after "who is the animal for") |
| Profile | Only people with **first and last name** become profile household members. Everyone else stays on the form |
| Semáforo | Under 5 → **red** · 5–17 → **amber** · only adults or "Vivo solo/a" → **green** |
| Profile → forms | Every submission records an adoption request on its profile at submit time, linked from the history. **It counts toward "demasiados pedidos"** |

## 1. The form step (contract-app)

New step id **`household`**, type **`household-people`**, placed right after
`housingType`. That position is already after `intent`; today's order is
intent → children → existingPets → housingType.

- **Title** follows the `housingType` answer:
  - `house` → "¿Quiénes viven en la casa?"
  - `apartment` → "¿Quiénes viven en el departamento?"
  - unanswered or hidden → "¿Quiénes viven en tu hogar?"
- **Subtitle:** "Sin contarte a vos".
- **Two ways through:**
  - **"Vivo solo/a"**: a full-width secondary button. Records an empty list and advances.
  - **"Agregar persona"**: opens an inline card with:
    - **Relación**, single tap, required: Pareja · Hijo/a · Padre/Madre · Hermano/a ·
      Otro familiar · Amigo/a o compañero/a. These map to the existing `Relationship`
      enum: partner · child · parent · sibling · other_relative · housemate. The
      `unknown` value is never offered here.
    - **Edad**: numeric keypad, integer 0–120, required.
    - **Nombre** and **Apellido**: optional, two fields.
- **Added people** show as compact cards ("Hijo/a · 7 años · Tomás López"), each
  with edit and remove. Max **15** people.
- **Continue** is enabled once "Vivo solo/a" was chosen or at least one complete
  person exists. Incomplete cards block Continue, with inline errors.
- **Answer shape** in `answers` / `answersJson`:
  ```ts
  householdPeople: Array<{ relationship: Relationship; age: number; firstName?: string; lastName?: string }>
  livesAlone: boolean   // true only via "Vivo solo/a"
  children: 'none' | '1' | '2' | '3+'   // DERIVED: count of age < 18, written for compatibility
  ```
  `children` keeps every existing reader working unchanged: semáforo fallback,
  notifications, /my-adopters, contract templates (none read it today) and old
  dashboards.
- **Draft autosave** already persists `answers`, so people survive a reload.
- **i18n:** es / en / pt for every new string. The contract-app has its own catalog.
- **Design:** the form's existing card and segmented styles (style guide §2),
  inline SVG icons, 44 px tap targets, 16 px inputs (no iOS zoom).

## 2. Choosing the step (Ajustes → Formulario y contrato)

The stored config today is only `hiddenSteps`. The new step must be **opt-in**:
older configs never mention it, so "hideable" alone would switch it on everywhere.

- **Stored in the existing `hidden_steps` list, no migration.** The list already
  carries per-question state, with compare-and-swap saves, teammate conflict
  messages, audit and "who changed it". The token `'household'` present in the
  list means **"use the people list"**. Absent, which every existing config is,
  means "¿Hay niños?". This replaces the separate `household_question` column
  first sketched here: same behaviour, and none of the concurrency work
  (v2.56.144) has to be redone for a second column.
- **Resolution, shared by app and contract-app** (the mirror test keeps them equal),
  `formStepsToAsk(schema, stored)`:
  - `'household'` absent → ask `children`, never `household`.
  - `'household'` present → ask `household`, never `children`.
  - The row has **one** show/hide switch, stored as before: `'children'` in the
    list means "don't ask about the household", whichever question is chosen.
    A legacy config that hid `children` therefore asks neither question.
  - Answer stripping before submit treats `'household'` as a choice, not a
    hide. It must never delete `householdPeople`.
- **Settings UI:** in the "Hogar" group, the children row becomes a choice:
  "¿Hay niños? (simple)" / "Personas del hogar (detallado)", next to the
  existing show/hide toggle.
- **Reachability:** the settings page sits behind `ENABLE_CUSTOM_ADOPTION_DOCS`,
  which is **off in production** with a walkthrough and review still owed.
  Until it is on, production applicants keep seeing "¿Hay niños?". That is
  intended ("for the time being").

## 3. Submit → profile (app)

`/api/form/[userId]/submit`:
- **Sanitise** `householdPeople` with a pure domain parser,
  `parseHouseholdPeople(raw)` in `src/domain/householdPeople.ts`, with unit tests:
  - drop unknown relationships and out-of-range ages;
  - trim names and cap their length;
  - cap at 15 people;
  - recompute `children` from the ages (never trust the client's count).
- **Profile members:** people with **both** names become `household_members` on the
  auto-created profile. Each gets:
  - `name`: "Nombre Apellido";
  - `relationship`;
  - `age` and `ageAsOf`: the submission date, as an ISO day;
  - `addedBy`: `'form-submission'`.

  Then re-tokenise, so the names reach duplicate detection (tokenizer v5 already
  covers household names).
- **Request record at submit:** call the existing idempotent
  `addFormRequestRecord(submissionId, autoAdopterId)`. Every profile then shows
  "Ver formulario completado" in its history for each form, whether it has one
  or several. Linking later ("Es la misma persona") merges the auto profile, and
  the request moves with it. The dedup on `form:<id>` stops the link path from
  adding a second one.

### Member model change

`HouseholdMember` gains optional `age?: number` and `ageAsOf?: string` (ISO date).
- `deserializeHouseholdMembers` validates both, ignoring bad values.
- The shown age is the current age: `age + whole years since ageAsOf`
  (`currentAge()`, pure, tested).
- **HouseholdSection** shows "Hijo/a · 7 años" and lets the rescuer edit the age,
  which resets `ageAsOf` to today. It is masked like the rest of the member for
  viewers without access. The age is not PII-sensitive alone, but it travels
  with the member.

### Merges must carry household members

`mergeAdopters` currently **drops** the absorbed profile's `household_members`.
"Es la misma persona" would lose the people the applicant listed. The fix:
- append the absorbed profile's members to the survivor's, skipping exact
  duplicates (same normalised name + relationship);
- snapshot the survivor's `householdMembers` in `undo.primarySnapshot` (optional
  field, so older payloads stay valid), so undo restores it.

## 4. Form screen and applicant panel

- **"Hogar" block** for `household` answers, in "Respuestas completas" and in
  `ApplicantDetailPanel`, through the shared `FormAnswersPanel`:
  - one row per person: dot · "Hijo/a · 3 años" · name when given;
  - or a single "Vive solo/a" row with a green dot.
- **Semáforo rule** in `src/domain/answerSignals.ts`, extended with
  `personSignal(age)`: `< 5` → risk · `5–17` → caution · `≥ 18` → ok.
- **The `children` row is not shown** when `householdPeople` exists. It is a
  derived duplicate.
- **Older submissions** (no `householdPeople`) render exactly as today.

## 5. Things that do not change

- **The default form:** "¿Hay niños?" stays, and nothing changes until a rescuer opts in.
- **Contracts and the PDF:** they don't read household answers.
- **/my-adopters "Por formulario":** it counts linked forms, and every form is
  still linked.

## Testing

- **Unit tests:**
  - `parseHouseholdPeople`: bounds, enum, the derived `children`, the 15-person cap;
  - `currentAge`;
  - `personSignal`;
  - the household-question resolution (both copies, plus the mirror test);
  - the member (de)serialise round-trip with `age` and `ageAsOf`;
  - merge of household members, and its undo.
- **E2E:**
  - a form configured to `'people'`:
    - submit two people (one fully named, one not) plus a minor;
    - the form screen shows the people and dots;
    - the profile has only the fully named member, with age;
    - the history shows "Ver formulario completado";
  - an unconfigured form still asks "¿Hay niños?";
  - "Vivo solo/a" → green.
- **Contract-app:** the step's validation (incomplete card blocks Continue), and
  the title following the housing answer.
- **Visual pass:** both themes, 1280 and 390, measured overflow.

## Out of scope

- Making the people list the default, or removing "¿Hay niños?".
- Collecting contacts for household members on the form.
- Backfilling older submissions.

---

# Part 2 — Gift flow: "¿Para quién es?" (2026-10-04, approved direction)

## Problem

When the applicant answers "Es un regalo", every home question still talks
to *them*: "¿Dónde vivís?", "¿Tenés patio?", "¿Tenés mascotas?", "Sin contarte
a vos"… The answers describe the wrong home, and the rescuer never learns who
will actually live with the animal, which is the person to vet.

## Decisions (Jon)

| Topic | Decision |
|---|---|
| Flow | Ask for whom, then word the home questions about that person (with "No sé" where the giver may not know) |
| Recipient on the app | **Only on the giver's profile** (a household member marked as the gift's recipient), plus the form screen. No profile of their own; no "link the recipient" action for now |
| Linking | "Es la misma persona" keeps meaning "the applicant (giver) is that person". It is not a way to attach the form to the recipient |

## 7. The "¿Para quién es?" step (contract-app)

- **When asked:** new step id `giftRecipient`, type `gift-recipient`, right after
  `intent`. It is asked **only when `intent === 'gift'`**. When intent is hidden
  or answered "Para mí", the step and its answer never exist: the answer is
  stripped before submit, like any hidden step.
- **Fields:**
  - **Relación**, single tap, required: the same chips as the household step
    (Pareja · Hijo/a · Padre/Madre · Hermano/a · Otro familiar · Amigo/a o compañero/a).
  - **Nombre**: required. The following questions use it ("¿Dónde vive Laura?").
  - **Apellido**: optional.
  - **Teléfono**: optional, validated like the applicant's phone.
- **Answer:** `giftRecipient: { relationship, firstName, lastName?, phone? }`.
- **Server:** re-parsed by `parseGiftRecipient` in `src/domain/giftRecipient.ts`,
  pure and unit-tested. It enforces the same relationship enum and name caps,
  and normalises the phone. Not trusted from the client.

## 8. Questions reworded for a gift

Only when `intent === 'gift'`. `{n}` is the recipient's first name. The giver's
own identity steps (name, email, phone, address, age, selfie) are unchanged.

| Step | Self (unchanged) | Gift | "No sé" |
|---|---|---|---|
| children | ¿Hay niños en el hogar? | ¿Hay niños en la casa de {n}? | yes |
| existingPets | ¿Tenés mascotas actualmente? | ¿{n} tiene mascotas actualmente? | — (counter, optional) |
| housingType | ¿Dónde vivís? | ¿Dónde vive {n}? | — |
| household | ¿Quiénes viven en la casa? / Sin contarte a vos / Vivo solo/a | ¿Quiénes viven con {n}? / Sin contar a {n} / Vive solo/a | — |
| hasOutdoor | ¿Tenés patio o jardín? | ¿{n} tiene patio o jardín? | yes |
| isSafe | ¿El espacio está protegido? | (unchanged) | yes |
| hoursAlone | (neutral, unchanged) | (unchanged) | — |
| petExperience | ¿Tuviste mascotas antes? | ¿{n} tuvo mascotas antes? | yes |
| willingToSterilize | ¿Estás dispuesto/a a castrar o esterilizar? | ¿{n} está dispuesto/a a castrar o esterilizar? | yes |
| movingPlans | ¿Tenés pensado mudarte pronto? | ¿{n} tiene pensado mudarse pronto? | yes |
| vacationPlan | ¿Qué harías con el animal en vacaciones? | ¿Qué haría {n} con el animal en vacaciones? | yes |

- **"No sé"** is an extra option, value `'unknown'`, shown only in the gift
  flow. It is stored as `'unknown'` and displayed as "No sabe".
- **Semáforo:** `'unknown'` never gets a dot. Every other rule is unchanged,
  including gift → red on Intención.
- **People list:** in a gift, the list describes the **recipient's** home. Those
  people therefore **never go onto the giver's profile**, even when fully named:
  they are not the giver's household. They stay on the form with their dots.

## 9. Recipient → giver's profile

At submit, with `intent === 'gift'` and a valid `giftRecipient`:
- **Only when** the recipient has **first and last name**, the giver's
  auto-created profile gets a household member with:
  - `name`: "First Last";
  - `relationship`;
  - `giftRecipient: true`, a new optional `HouseholdMember` flag;
  - the phone as a contact entry when given;
  - `addedBy`: `'form-submission'`.
- **No profile of their own.** The name and phone feed search and duplicate
  detection like any relative's.
- **Known effect:** if the recipient already has a profile, duplicate detection
  may list the giver and the recipient as a possible duplicate. The rescuer
  chooses "Mantener separados". The same happens today with any relative's name.
- **Profile display:** "Hija · Laura Pérez", with a small "Destinataria del
  regalo" pill (masked like the rest of the member).

## 10. Form screen

- **"Para quién"** sits at the top of "Respuestas completas" for a gift:
  "Hija · Laura Pérez · Tel …".
- The reworded questions keep their gift wording as labels ("Patio o jardín de
  Laura").
- Older forms and "Para mí" forms are unchanged.

## Testing (Part 2)

- **Unit:**
  - `parseGiftRecipient`: enum, required first name, caps, phone;
  - the gift-wording resolver (which title key for which step and intent);
  - `answerSignal` with `'unknown'` → no dot;
  - stripping `giftRecipient` when intent ≠ gift.
- **E2E:**
  - a gift submission with a fully named recipient and two housemates:
    - only the recipient reaches the giver's profile, flagged and with the phone;
    - the housemates stay on the form;
    - the form screen shows "Para quién";
  - a "Para mí" submission is unchanged.
- **Contract-app:** walk the gift flow at 390 and 1280 and check the reworded
  titles and the "No sé" options.

## Out of scope (Part 2)

- A profile of the recipient's own, and a "vincular destinatario" action.
- Asking the recipient to fill in the form themselves.
