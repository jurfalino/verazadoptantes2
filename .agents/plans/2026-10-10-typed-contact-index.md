# Typed contact index + phone recognition — plan (2026-10-10)

## Goal
A rescuer who types an adopter's phone, DNI, social profile or street — in any
format — finds that person as a top result, and never the wrong person.
Privacy rules unchanged: no phone/email search logged out, minimum digits, a
typed value reveals only that value.

## Why
- "+54 9 11 6585 1333" does not find a record stored as "1165851333" (prod logs:
  2 rescuers, 0 results, 2026-10-09/10). The phone lookup checks "stored
  contains typed", impossible when the query carries a country code; the
  word-by-word LIKE fallback is capped at 20 rows and "11" matches 345 records.
- The search index (`duplicate_tokens`) is built by scanning the joined contact
  blob, so data is indexed as the wrong type. Audit (2026-10-10, read-only):
  | # | Misread | Prod impact |
  |---|---|---|
  | 1 | FB post/share links → social handle (`photo.php`, `share`) | 11 adopters; all 22 pending social-only duplicate candidates come from this |
  | 2 | URL digits (FB ids, post links, TikTok ids) → phone | 32 tokens / 24 adopters |
  | 3 | Household phone + DNI merged into one "phone" | all 5 household entries unindexed; 2 DNIs as phone_suffix |
  | 4 | Address entries never indexed as address words; street+postal code → phone | 0 address_word tokens vs 907 address entries; 3 junk phones |
  | 5 | Discovery never queries `id_number` | 43/75 DNIs missed digits-only |
  | 6 | Form/contract duplicate check sends the DNI as a phone | every submission |
  | 7 | `categorizeContactText`: URL line → phone entry; keyword-less address → `other` (never masked) | 1 + 1 today; latent |
  | 8 | WhatsApp fallback regex offers DNI/FB id/address as a number | 39 would qualify, 0 live |
  | 9 | Email ending in `_ - .` → domain as social handle | 1 |
  | 10–14 | dates/prices/chips as phones; short ID labels; label words in names; DNI tested as phone on contracts; match label names wrong field | low |
  Clean: email tokens, masking keyed on stored type, alias/family name tokens (intentional), source_url, AI post import.

## Principle
Index and query from **typed contact entries only** — each entry (household
members' too) through its own type's rules. Never scan the joined blob.

## Phase 1 — Clean index (typed entries only)
1. Phones only from `phone` entries; never from URLs, addresses, emails, ids.
2. Social: stoplist of non-profile paths (`photo.php`, `share`, `people`,
   `groups`, `story.php`, `permalink.php`, `watch`, `reel`, `p`, `video`);
   handle from `/people/<name>/<id>`; fix `@handle` lookbehind (`[._%+-]`).
3. Household: tokenize each member entry by type; ids → `id_number`.
4. Address entries → address words (street, locality).
5. `categorizeContactText`: no digits from URL lines; an `other` with a street
   + number becomes `address` (and `other` holding digits is masked).
6. WhatsApp action uses typed phone entries only.
7. Bump `TOKENIZER_VERSION` → existing rescan rebuilds the index. No schema change.

## Phase 2 — Phone recognition + search
1. libphonenumber (server-side, no network), parsed with the record's country
   (search: the rescuer's country). AR: drop the international mobile "9",
   trunk "0", "15".
   - Complete number → full form + local number (as defined per area code, not
     a fixed 8 digits).
   - Incomplete ("6585 1333", "15-6585-1333") → local digits, marked incomplete.
2. Search rules:
   | Typed | Matches | Shown |
   |---|---|---|
   | Complete number | exact full form; records without area code whose local number matches | main list |
   | Partial ≥ 8 digits | numbers ENDING in those digits | main list |
   | Partial 6–7 digits | numbers ending in those digits | "Otras posibles coincidencias" |
   | < 6 digits | nothing ("sumá más dígitos") | — |
   Country/area code alone never matches. Phone-shaped queries skip the
   word-by-word text search.
3. DNI: exact `id_number` lookup on normalized digits in discovery; `ids` field
   in duplicate-mode input; form/contract/AdopterForm/ImportWizard send typed
   entries (DNI no longer pushed into phones).
4. Same rules in reveal-on-typed-number (`matchSearchEntries`) and form /
   contract matching (`submissionUnlockHashes`).

## Phase 3 — Data cleanup (each write approved at the time)
- Dismiss the 22 social-only pending duplicate candidates caused by #1.
- Fix the 1 phone entry holding a FB id and the 1 `other` address.

## Phase 4 — separate release
Phone field formats while typing (rescuer's country default), non-blocking
"Falta el código de área" hint.

## Tests (each confirmed to FAIL on today's code first)
- Unit: every AR format (+54, +54 9, 0, 15, 2/3/4-digit area codes), other
  countries, partial thresholds, Lorena's record (FB id is not a phone, her 3
  real numbers are), household entries, address words, DNI dotted/undotted,
  social stoplist, `@handle` edge.
- E2E (local harness, `test-*-fixture-*` rows, AR): full and partial phone
  searches land in the main list / approximate tier as specified; logged-out
  phone search still asks to sign in; DNI search finds the record.
- Staging: re-run the real failing searches from the logs.

## Rollout
Staging (version bump, CHANGELOG) → verify → production on Jon's go. Rescan
runs on deploy via the tokenizer version. Rollback: revert the release; the
index is rebuilt again from the same entries.

## Decisions pending (Jon)
1. Thresholds: ≥8 main list, 6–7 approximate, <6 nothing.
2. Phase 4: save the number as typed, or formatted.

## Follow-ups (not in this plan)
- The 20-row cap on word-by-word name search.
- 370 phone entries of 7–8 digits: local numbers or unlabeled DNIs — unknown.
- `scripts/backfill-tokens.ts` is stale; delete or fix.
