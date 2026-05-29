# Address — two-field structure (street+number gated, rest free)

## Context

Today an address is a single free-text `ContactEntry` of type `address`. The
PII matcher recovers structure by comma-tokenizing and classifying parts as
"specific" (text + digit run = street + number) or "loose" (locality, postal
code, etc.) via heuristic. This works but it's a guess about the user's
intent every time — and the classification carries the load-bearing rule for
search-match anchoring.

The user clarified that only the street + number portion of an address is
sensitive enough to merit gating. Locality, city, province and postal code
don't need to be masked. So the structure we need is just **two fields**, not
the full break-out (street / locality / city / province / cp) I originally
proposed.

This plan captures that reshape.

## The new address shape

A `type='address'` `ContactEntry` becomes a small structured object instead
of a flat string:

```ts
{
    type: 'address',
    streetAndNumber: string,          // gated — masked for partial viewers
    locality: string,                 // not gated — fully visible
    raw?: string,                     // optional: original free-text input
                                      // when the user used the escape hatch
}
```

Display-only `masked: boolean` continues to apply to `streetAndNumber` only.
The combined view-mode rendering ("Peru 999, San Isidro 3680") joins the
fields with `, `.

`locality` is a single free-text field that bundles whatever non-sensitive
geographic context the rescuer wants — town, city, province, postal code,
notes like "frente a la plaza". It's not parsed; it's just shown.

`raw` is set when the rescuer uses the "paste as text" escape hatch — the
form keeps the original string verbatim so messy/rural addresses
("Kilómetro 47, Ruta 5", "Lote 5 Manzana 12") aren't forced through the
structured fields. When `raw` is set, the matcher falls back to the legacy
comma-tokenized rule (see Matcher section).

## Form UX

Replace the single address `<input>` row with:

```
┌──────────────────────────────────────────────┐
│ Calle y número                               │  ← gated, maskable
│ ┌──────────────────────────────────────────┐ │
│ │ Peru 999                                 │ │
│ └──────────────────────────────────────────┘ │
│ Localidad, ciudad, provincia (opcional)      │  ← always visible
│ ┌──────────────────────────────────────────┐ │
│ │ San Isidro 3680                          │ │
│ └──────────────────────────────────────────┘ │
│                          [pegar como texto]  │  ← escape hatch link
└──────────────────────────────────────────────┘
```

- **"Calle y número"** placeholder: `Peru 999` (no italics, just a hint).
- **"Localidad, …"** placeholder: `San Isidro, 3680` (showing it accepts
  a few comma-separated bits as one field).
- **"Pegar como texto"** collapses both fields into a single `<textarea>`
  pre-filled with the joined string; submitting populates `raw` and clears
  `streetAndNumber` + `locality`. Toggling back parses `raw` by the first
  comma into the two fields and clears `raw`.

Country is **not displayed** in the form. It's already inferred from the
creator's `user_profiles.country` (with a CF-IPCountry fallback once the
companion fix lands) and stored on `adopters.country`. Surfacing it would
add a field the user shouldn't have to think about.

View-mode (`ContactEntriesDisplay`) renders the two fields joined by `, `
when both are present; just one if only one is filled; the raw string when
`raw` is set.

## Matcher implications

The big simplification: `streetAndNumber` is gated *and* always-structurally-
specific, so anchoring on an address reduces to "exact substring of
`streetAndNumber` in the normalized query." The whole specific-vs-loose
heuristic disappears for new records.

Three matcher paths to support:

1. **New shape with `streetAndNumber` set** — anchor on exact substring
   match of `streetAndNumber` in the normalized query. `locality` is not
   gated and therefore not in the matcher's concern.
2. **New shape with only `locality` set** — the address has no sensitive
   half; nothing to anchor and nothing to unlock. Skip entirely.
3. **Legacy `value` (existing free-text rows) and new `raw` (escape hatch)**
   — fall through to the existing comma-tokenized rule
   (`addressMatchesAsAnchor` from `pii-anchor-confidence-rule`). Same code
   path keeps working.

The "fragment ride-along" Phase-2 logic for address still applies to all
three shapes: an already-anchored adopter can have its address (`streetAnd
Number` or legacy value) unlock when its value appears in the query.

## Migration / backward compatibility

- **Schema**: this is a payload change inside the JSON `contactEntries`
  column, not a SQL schema change. No new DB column or migration is
  strictly required. Old rows carry `{ type: 'address', value: '...' }`;
  new rows carry `{ type: 'address', streetAndNumber, locality, raw? }`.
- **Type guard**: `ContactEntry` discriminated union extended; a runtime
  helper `isLegacyAddress(entry)` distinguishes shapes.
- **Lazy migration**: on edit, if the user keeps the legacy shape, leave
  it alone. If they fill out the structured fields, save the new shape
  and drop the legacy `value`. No bulk backfill — addresses are stable
  enough that lazy is fine.
- **Display**: `ContactEntriesDisplay` handles both shapes (new shape
  joined; legacy `value` shown verbatim).
- **Mask helpers** in `piiAccess.ts`: `partialReveal` for the new shape
  masks `streetAndNumber` only (returns `••••••` for that part, keeps
  `locality`). For legacy, falls through to the existing
  `partialRevealAddressString`.
- **Duplicate-token tokenizer** (`src/lib/tokenizer.ts`): if it tokenizes
  on `addressInfo` today, point it at the joined string for the new shape.

## Files

**Modified:**
- `src/lib/contactEntries.ts` — extend `ContactEntry` union; add
  serialize/deserialize support for the new shape; add `isLegacyAddress`,
  `joinedAddress(entry)`.
- `src/lib/piiAccess.ts`:
  - `partialReveal` — handle new shape.
  - `matchSearchEntries` — new fast path for structured `streetAndNumber`
    anchor; existing rule kept for legacy/`raw`.
  - `maskContactEntries` — propagate `masked` flag onto
    `streetAndNumber` only.
- `src/lib/piiAccess.test.ts` — coverage for each of the three matcher
  paths and the masking shape.
- `src/components/ContactEntriesInput.tsx` — render the two-field address
  row + "pegar como texto" toggle.
- `src/components/ContactEntriesDisplay.tsx` — render the joined view.
- `src/i18n/locales/es.ts` + `en.ts` — three new keys:
  `ce_address_street_label`, `ce_address_locality_label`,
  `ce_address_paste_toggle`. Both locales (project rule).

**Possibly modified:**
- `src/lib/tokenizer.ts` — if address tokens are indexed for duplicate
  detection, point at the joined string.
- `src/app/api/adopters/route.ts` (ImportWizard duplicate-check) — confirm
  the masked shape for an address entry still serializes correctly when
  the new shape is masked.

## Verification

- `npx vitest run src/lib/piiAccess.test.ts` (and `contactEntries.test.ts`).
- `npx tsc --noEmit`; `npm run lint` (≤125 warnings).
- `npx playwright test tests/adopter.spec.ts` — exercises edit flow.
- Manual:
  - New adopter, fill structured fields, save → reopen, edit, save again
    → verify both fields persist and view-mode joins correctly.
  - New adopter, click "pegar como texto", paste a messy address, save →
    `raw` set, structured fields empty, display shows raw.
  - Legacy adopter (existing free-text address) → edit form pre-fills
    the legacy `value` into the textarea (or splits by first comma into
    the two fields — decide during build).
  - With PII gating on: partial viewer sees `••••••, San Isidro 3680`
    for the new shape; legacy row still uses
    `partialRevealAddressString`.

## Versioning

Minor version bump — this is a real feature change with a contract shift
in the address shape. Suggest `2.16.0` (since 2.15.x is the PII line).

## Out of scope

- Bulk backfill of legacy addresses into the new shape — lazy on edit
  is sufficient.
- A separate province dropdown / postal-code field — we explicitly
  decided not to split further since only street+number needs gating.
- Country selector — country is inferred from the creator's profile (or
  the request's CF-IPCountry header as fallback once the companion
  country-inference fix lands).
- Migration to a relational address column (postgres-style structured
  type) — the JSON payload change inside `contactEntries` is sufficient
  for the matcher and display needs.
