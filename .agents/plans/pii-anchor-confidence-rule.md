# PII anchor rule — confidence-based, not type-based

## Context

Today's search-match grant logic (`matchSearchEntries` in `src/lib/piiAccess.ts:139`)
is **type-biased**: phone / email / social are the only types that can anchor
a search; address and ID can ride along only when one of those identifiers
already matched. This was conservative on launch — the worry was that a bare
fragment ("Corrientes", "30") would fan-grant addresses or IDs across many
unrelated adopters.

The framing was wrong. What's generic isn't the *type*, it's the *amount* of
the value present in the query:

- A full DNI ("30123456") is more uniquely identifying than 6 digits of a phone.
- A complete address ("Av. Corrientes 3444, 5B, CABA") is at least as specific
  as an email handle.
- What stays generic is a *fragment* — "Corrientes" alone, "Palermo" alone,
  "30" alone.

Real consequence of the current rule: a rescuer who knows only the adopter's
full address can't unlock anything by searching it. They have to request
access, or stumble onto the profile through some other channel and use the
on-profile verify input. That's avoidable friction with no security gain — a
full-address match is strong evidence of knowing the person.

## The reshape

> Any attribute that matches the stored value with **high confidence (95–100%)**
> can anchor. The shape-check for "high confidence" is per-type, because what
> "specific" means differs between a phone number and a street address. No type
> is excluded on principle.

Phase 2 (anchored secondary unlock) stays for the **fragment-rides-along** case
— `"1123456789 Corrientes"` keeps working as today, phone anchors and the
address fragment unlocks alongside.

## Per-type shape rules

| Type    | Today's anchor rule                              | New anchor rule                                                                  | Net change           |
|---------|--------------------------------------------------|----------------------------------------------------------------------------------|----------------------|
| Phone   | Digit run ≥6 is substring of entry's digits      | unchanged                                                                        | none                 |
| Email   | Query has `@`, ≥6 chars, substring of entry      | unchanged                                                                        | none                 |
| Social  | Query starts with `@` or URL, ≥4 chars, substring | unchanged                                                                        | none                 |
| **ID**      | not an anchor (Phase-2 only)                 | Full stored value present in query (digits-only normalized), or Lev-1 from it    | full DNI anchors     |
| **Address** | not an anchor (Phase-2 only)                 | See address-part rule below                                                       | full address anchors |

"95%" = Levenshtein distance ≤ 1 against the normalized stored value. Cheap to
compute, absorbs single-character typos ("Corientes" vs "Corrientes"), no
external dep — a 20-line function in `src/lib/piiAccess.ts`.

Per-type minimum length to prevent degenerate matches:
- ID: ≥6 chars after digits-only normalization.
- Address (whole stored value path): ≥8 chars after normalization.

## Address-part rule

A stored address is a structured value (street, locality, city, postal code,
apartment), conventionally comma-separated. Treat it that way:

1. Tokenize the stored value by comma. Trim and lower-case each part.
2. Classify each part:
   - **Specific** — has a text-plus-digit-run shape (regex roughly
     `/[a-zà-ÿ].*\d|\d.*[a-zà-ÿ]/`). Captures "Peru 999", "Av. Corrientes 3444",
     "Mendoza 1234, dpto 5B" (the dpto sub-part too). One match suffices.
   - **Loose** — anything else (locality, neighborhood, city, postal code,
     bare apartment number). One match alone is not enough.
3. Anchor if **any one of**:
   - A specific part appears in the query at 95–100%, OR
   - ≥2 loose parts appear in the query at 95–100% each.

Match a part against the query by checking the part is a substring of the
normalized query (with Lev-1 tolerance applied per-part — Lev-1 over the full
query is too forgiving, so do it part-by-part).

### Examples — stored: `"Peru 999, San Isidro, 3680"`

| Query                                | Anchors? | Why                                  |
|--------------------------------------|----------|--------------------------------------|
| `"Peru 999"`                         | ✅       | Specific part matches                |
| `"San Isidro"`                       | ⛔       | One loose part                       |
| `"3680"`                             | ⛔       | One loose part                       |
| `"San Isidro 3680"`                  | ✅       | Two loose parts match together       |
| `"Peru 999, Palermo"`                | ✅       | Specific part matches                |
| `"Corientes 3444"` (typo, stored: `"Corrientes 3444"`) | ✅ | Specific part, Lev-1   |
| `"CABA"`                             | ⛔       | One loose part                       |

## Behavior changes — quick summary

- ✅ Typing a full DNI alone unlocks the DNI.
- ✅ Typing a full address (or comma-tokenized parts adding up to specificity)
  unlocks the address.
- ✅ Typo'd full address ("Corientes 3444, CABA") still anchors via Lev-1.
- ⛔ Typing a bare neighborhood / city / postal code → still no unlock (the
  fan-grant case we deliberately keep blocked).
- ⛔ Typing two digits ("30") → still no unlock (min length).
- ✅ Existing behavior preserved: phone/email/social anchor as today;
  identifier + fragment still unlock both via Phase-2 ride-along.

## What stays the same — anti-fishing properties

- Phone min-digit (6) and bare-handle rule for socials (`@` prefix or URL)
  are unchanged — those rules already encode "shape-check for specificity"
  and we're not loosening them.
- Per-entry grant model unchanged: the grant points at a value hash, edits
  invalidate it, revocation is server-side.
- Audit trail on every grant write is unchanged.
- The verify-known-info path on a profile already runs with
  `anchorRequiredForSecondary: false` — these changes don't affect that path
  beyond the new anchor types being available there too, which is consistent.

## Files

- **`src/lib/piiAccess.ts`** — extend `matchSearchEntries`:
  - Add a small Lev-1 helper (no external dep).
  - Phase 1: add address (via the address-part rule) and ID (full-value /
    Lev-1) to the anchor set.
  - Phase 2: keep as-is (fragment ride-along when something else anchored).
- **`src/lib/piiAccess.test.ts`** — extend tests:
  - Full DNI alone anchors.
  - Full address alone anchors.
  - Tokenized address: specific part alone anchors; one loose part doesn't;
    two loose parts together do.
  - Typo cases (Lev-1) anchor.
  - Negative cases: bare locality / city / postal code / 2-digit ID don't.
- **No schema change.** No migration. No new feature flag (this is a
  behavior refinement inside `ENABLE_PII_ACCESS_GATING`, which already
  gates everything).
- **No UI change.** The verify input and search box both feed the same
  matcher; the reshape is purely server-side.

## Verification

- `npx vitest run src/lib/piiAccess.test.ts` — all existing tests stay
  green; new tests cover each row in the examples tables above.
- `npx tsc --noEmit`; `npm run lint` (≤125 warnings).
- Manual on staging with the flag on:
  - Search by full DNI of a fixture adopter → DNI unlocks on the result card.
  - Search by full address → address unlocks; bare locality alone still
    masked.
  - Search by typo'd full address → still anchors.
  - Confirm phone/email/social paths unchanged.

## Versioning

Build-suffix bump under the 2.15.0 series (the PII feature line). Small,
isolated behavior refinement — no migration, no schema, no UI churn.

## Out of scope

- Search rate-limiting (recommended follow-up from the original plan; not
  this PR).
- Per-field rate-limit on bare-string queries against social handles (the
  separate "anchored social" idea floated earlier — punted until there's
  evidence it's needed; the @-prefix rule does the job today).
- Anything that loosens the < 95% threshold. Fuzzy matching by definition
  admits "I almost knew it" — the opposite of the system's evidence standard.
