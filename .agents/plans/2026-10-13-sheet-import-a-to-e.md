# /import/sheet: five fixes found by the catpuccino dry analysis (2026-10-13)

Status: BUILT 2026-10-14 (branch feature/sheet-import-a-to-e). Jon approved the plan as proposed
(grouping = shared email/phone + a name word; draft copy; "Animal age" label).
Measured on catpuccino with the shipped rules: 1,501 profiles (250 grouped: 128 email, 17 phone,
105 identical), 237 placeholders dropped, 1,846 unknown-type rows announced, 0 numeric animal names.

Source: analysis of `catpuccino-adopciones-2022-2024.xlsx` (1,856 requests, 131 columns) against
origin/staging v2.56.176. One patch release, all in the client wizard + pure domain functions; no
schema change, no new server action (action-surface ratchet untouched).

Work in a worktree off origin/staging (parallel sessions share the main checkout).

## (a) "Aplicar a todos: Tipo…" + an honest warning for unknown types

Problem: a column guessed as record type with values the import doesn't know (catpuccino `tipo` =
A/AP) silently becomes "adoption" on every row; only per-row editing can fix it.

- `SpreadsheetImportWizard.tsx`: `setRecordTypeAll(type)` next to `setRatingAll`/`setVisibilityAll`
  (same override mechanism, every parsed row); a third select in the bulk bar (both steps, it is the
  shared table component) with `RECORD_TYPES` + `RECORD_TYPE_LABELS`, plus "Restablecer" (clear override).
- `importRow.ts`: `recognizedRecordType(raw)` → canonical | null; `rowWarnings` adds
  "Tipo «X» no reconocido: se importa como Adopción" when a mapped value is present but unknown
  (same pattern as the unparseable rating/date warnings).
- Revisar: one summary line when ≥1 row has that warning, with the distinct unknown values and the
  count ("1.846 filas tienen tipo «A», «AP» — se importarán como Adopción. Cambialo con Aplicar a
  todos → Tipo"). Copy is Jon's to approve.

## (b) Never auto-guess question columns; smarter single-value guesses

Problem: the header guesser maps any column whose text contains a keyword, so form questions become
record type, animal, social and on-behalf-of; `animal_id` beats `animal_nombre`.

`guessColumnMap` (importFields.ts), pure + unit-tested:
1. Question headers → `ignore`: starts with a number ("12.", "16.5.", "3)"), or contains ¿ / ?, or
   has more than 8 words.
2. Identifier/code headers → `ignore`: a whole word `id`, `estado`, `status`, `codigo` (so
   `animal_id`, `animal_estado`, `entry_id`).
3. Species before record type, and `tipo` next to `animal`/`mascota`/`especie` → species
   (`animal_tipo`, "tipo de animal").
4. `onBehalfOf`: `a nombre de` as words (today "mencioná nombre" matches after accent stripping).
5. Single-value fields (everything but phone/email/social/address/dni): only the first column the
   rules pick gets the field; later ones → `ignore`, so the mapping screen shows exactly what is used.
6. Address rule gains `partido|municipio|comuna` (feeds (d)).

Not changed: the AI mapping path (it already reasons about the content). Edad stays unmapped — it
is the applicant's age; the import's age is the animal's. Consider labelling that field
"Edad del animal" in the mapping select (copy → Jon).

## (c) Drop placeholder contact values

Problem: "no", "si", "-" in contact columns become contacts. 2-letter values don't make handle
tokens, but `social` is an EXACT identifier in `importMerge.ts`, so a row with social "si" defaults
to "actualizar" into any existing profile that also has "si". Prod has none today (read-only check
of duplicate_tokens, 2026-10-13), so nothing to clean.

- New pure `isPlaceholderContact(value)` (domain): lowercase, strip accents/punctuation, collapse
  repeated letters ("sii", "noo", "Sí."), then match a fixed list: si, no, -, x, na, n/a, ninguno/a,
  nada, sin, no tengo, no tiene, no uso, no posee, 0. Reuses `isPlaceholderPhone` for phones.
- Applied in BOTH paths: `applyColumnMap` (multi-contact branch) and `parseAiRows`.
- Revisar: one line "Se descartaron N valores vacíos («no», «si», «-»…)" so nothing disappears silently.
- Follow-up, not in this release: the same guard at tokenization (protects manual edits and the API).

## (d) Address columns of one row become ONE address

Problem: Direccion and Localidad become two addresses; Partido is dropped.

- `applyColumnMap`: collect the row's address-column values in column order; when each column holds
  a single value, join them with ", " into one address, skipping a part already contained in an
  earlier one (accent/case-insensitive). A cell that itself splits (";" / newline) keeps today's
  behaviour (several addresses).
- AI prompt: "one address per place — street, locality and partido together".
- Reminder (memory): PII address deserialize tests are pending — add a joined-address round-trip test.
- Out of scope: normalising "Capital Federal" ↔ CABA.

## (e) One profile per person in the file, not per identical row

Problem: the in-file fold needs an identical name + every contact, so 118 of 332 repeat rows fold;
~210 duplicate profiles come from the file itself.

Measured on catpuccino (rows with a name):

| Rule | Profiles | Groups w/o a shared name word |
|---|---|---|
| today (identical content) | ~1,732 | — |
| same email | 1,518 | 7 |
| same email OR phone | 1,490 | 10 |
| (same email OR phone) AND a shared name word | ~1,493 | 0 by construction |

Decision (technical, mine; consult Jon on the visible behaviour): group when rows share an email or a
phone (last 8 digits) AND their names share a word of ≥3 letters. Shared identifier + no common name
word (households, couples sharing an email) stays separate.

- New pure `groupSamePerson(rows)` (domain, union-find, transitive) — the ONE grouping used by both
  the Revisar grouped view and the import fold (today both call the fingerprint separately).
- Group profile = union of all rows' contacts (nothing lost); name = the first row's (editable in
  Revisar). Each row keeps its own activity (animal, date, details) via `extraAdoptions`.
- Only 'create' rows group (unchanged); upsert/skip rows untouched.
- Revisar: grouped card says why ("mismo email" / "mismo teléfono") and has "Separar" (per group →
  back to one profile per row). Because grouping is no longer "identical", the person must see it
  before it is written (memory: never write an unconfirmed subject).
- Fold summary copy changes from "filas idénticas" to "filas de la misma persona".

## Tests

- Unit: guessColumnMap on the 131 catpuccino headers (headers only, no data) → expected map;
  isPlaceholderContact; address join; groupSamePerson (email, phone+name, household not grouped,
  transitive); recognizedRecordType + warning.
- E2E (authed, synthetic CSV fixture `test-*-fixture-*` names): bulk Tipo → Solicitud; "si"/"no"
  dropped with the notice; two rows sharing an email shown as one person, "Separar" splits them.
- grep tests/ for "idénticas" / fold copy before changing it.

## Release

Patch version above origin/staging, CHANGELOG, staging first. Then: re-run the catpuccino dry
analysis against staging (mapping screen only, no import) and compare with the table above.
