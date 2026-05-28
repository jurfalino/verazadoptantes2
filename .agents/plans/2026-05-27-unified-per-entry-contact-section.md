# Plan: Unified per-entry contact section

> 2026-05-27 · supersedes the half-finished CTA-only unification in
> v2.15.0-19+post; replaces both `AddContactEntryModal` and the bulk-edit
> contact path inside `AdopterForm`'s Editar mode.

## Context

After v2.15.0-19, contact-detail editing splits across two inconsistent
surfaces:

- **Owners / admins** click `Editar` on the profile → enter `AdopterForm` edit
  mode → use `ContactEntriesInput` (chip rows + paste/categorize + manual-add)
  → save the whole record via `saveAdopter` (full replace of `contactEntries`).
- **Contributors** click `+ Agregar dato de contacto` → modal opens
  (`AddContactEntryModal`) → submit via `addContactEntry` (append-only).

The current bandaid lifted the modal-CTA's visibility to all authenticated
viewers, so the *affordance* looks consistent — but the *surface that opens*
diverges by role. Same job (add a contact detail), two completely different
flows, plus a separate full-form edit mode that exists only because contact
entries today are batched as one save.

This plan unifies both flows around the **chip-based composer pattern owners
already know** and changes the edit model from *replace the whole list* to
*mutate one entry at a time*.

## Design

### One component: `ContactEntriesSection`

Always rendered on every profile (including new adopters in their initial
data-entry flow). Replaces:

- The contact-entries portion of `AdopterForm` edit mode.
- The "+ Agregar dato de contacto" CTA + `AddContactEntryModal` pair on the
  profile.

Composition:

```
┌─ Datos de contacto ────────────────────────────┐
│  📞 +54 11 1234-5678        ✎  🗑                │  ← per-entry affordances
│  ✉ vet@example.com          ✎  🗑                │     (owner/admin only)
│  📷 @ana_perez (lock icon)                       │  ← contributor view: no affordances
│  📍 ••••••  🔒                                   │  ← masked entry → tap to verify popover
│                                                  │
│  + Agregar dato                                  │  ← always-visible composer trigger
│  ┌──────────────────────────────────────────┐    │
│  │ [📞] [✉] [📷] [#] [📍] [...]            │    │  ← type chips
│  │ ┌──────────────────────────────────┐     │    │
│  │ │ valor                            │     │    │  ← single input (or 2 for address)
│  │ └──────────────────────────────────┘     │    │
│  │             [Cancelar]  [Agregar]        │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### Per-role affordances on existing entries

| Viewer            | Visible entry          | Masked entry                | Alias entry |
| ----------------- | ---------------------- | --------------------------- | ----------- |
| Owner / admin     | display + ✎ + 🗑       | (owner sees everything, n/a) | display + ✎ + 🗑 |
| Contributor       | display, no affordance | masked + lock → verify popover | display, no affordance |
| Anonymous         | (page redirects to login — out of scope) | | |

(Editor as a distinct tier disappears once `saveAdopter` is owner+admin
gated — `adopter_history.changedBy` with `kind='edit'` only comes from
owner+admin from that point forward, so the editor set ≡ owner ∪ admins.)

Contributor's own contribution that's now visible via `entry`-scope grant:
display only, no edit. Contributors don't edit; if they mis-typed, they add
the correction and the owner cleans up. Keeps "edit = owner/admin" absolute.

### Add — inline composer (everyone)

- Type chips (phone/email/social/id/address/alias/other).
- Single value input. For `address`: two stacked inputs (street + locality)
  matching the current modal. For `alias`: a name-shaped input with
  placeholder *"Otro nombre por el que se conoce a esta persona"*.
- `Cancelar` / `Agregar` row. Enter submits.
- Server: existing `addContactEntry` (auth-gated only, not role-gated).
- On success: entry appears in list (router.refresh), composer resets +
  collapses to the "+ Agregar dato" trigger, focus returns there.

### Edit — inline transform (owner / admin)

- Tap ✎ on a chip → chip transforms into a small input with same fields as
  add (single input, or 2 for address). Save / cancel.
- Save calls new `updateContactEntry(adopterId, entryId, value, ...)`.
- Cancel restores the chip with no change.
- Esc cancels; Enter saves.
- One chip in edit mode at a time (cancels any other open edit).

### Delete — optimistic + undo toast (owner / admin)

- Tap 🗑 → entry disappears immediately from the list (optimistic).
- Toast appears: *"Entrada eliminada — Deshacer"* with a 5-second timer
  visualized as a shrinking bar.
- If user clicks Deshacer: entry restored, no server call.
- If timer expires: `removeContactEntry(adopterId, entryId)` fires.
- Failure: rollback + error toast with errorId.

Rationale for no confirm dialog: contact entries are cheap to recreate; a
confirm modal is wrong friction. The undo toast covers fat-finger deletes.

### Paste / categorize — creation flow always; existing adopters behind a flag

- **New-adopter creation:** `ContactEntriesInput`'s paste box stays as the
  fast path to first-data. Always available.
- **Existing adopters:** the inline composer is the default add path
  (one at a time). The bulk paste box is conditionally rendered as a
  "Pegar varios" link in `ContactEntriesSection` when feature flag
  `ENABLE_BULK_PASTE_ON_EXISTING` is on (default off). Flag follows the
  standard DB-backed pattern (`src/config/features.ts` + appConfig). Lets us
  flip it on for users who hit the bulk-cleanup case without baking the
  surface into the default UI. Owner/admin only when on.

## Server actions

### New: `updateContactEntry(adopterId, entryId, type, value, streetAndNumber?, locality?)`

- Auth: **owner OR admin only.** Mutations are gated — see "Authority model"
  below for the full rationale. Editor-as-a-distinct-tier disappears under the
  collaborative-vetting model (kind='edit' history rows only come from
  owner+admin, so editor set ≡ owner ∪ admins anyway).
- Find entry in `contactEntries` by `id`. 404 if not found.
- Update in place, preserving type (type is not editable — change-of-type is
  delete + add).
- Persist via the same merge path used by `addContactEntry` (so deduping +
  serialization stay one code path).
- History: insert `adopter_history` row with `kind='edit'` and
  `changes={ updated_entry: { type, id, previousValueHash, newValueHash } }`
  — hashes only, no raw values, mirroring contribution-history privacy.
- Re-tokenize via `tokenizeAdopter`.
- Audit: `logAudit({ action: 'contact_entry_updated', target: adopterId,
  details: { entryId, type } })`.
- If a `pii_access_grant` exists with `entryRef = hash(oldValue)`: leave it
  alone (it'll go inert on its own — the grant proves the grantee knew the
  *old* value; that's a feature, see v2.15.0 design notes).

### New: `removeContactEntry(adopterId, entryId)`

- Auth: same as update.
- Remove entry from `contactEntries` array.
- History: `kind='edit'`, `changes={ removed_entry: { type, id } }`.
- Re-tokenize.
- Audit.
- Revoke any `pii_access_grant` rows for that exact `entryRef` (mark
  `revokedAt`, `revokedByEmail`). Explicit revoke for audit clarity even
  though the grant would be inert without it.

### Existing: `addContactEntry` — extend type enum to accept `'alias'` (see
"Alias contact-entry type" below); no other behavior change.

### Existing: `saveAdopter` — two changes:

1. **Strip `contactEntries` from its update payload.** Contact entries are now
   mutated exclusively through the three single-entry actions (add / update /
   remove).
2. **Make the existing owner+admin gate unconditional.** Today `saveAdopter`
   already calls `canEditAdopterRecord` at `adopters.ts:215`, but that helper
   returns `true` for everyone when `ENABLE_PII_ACCESS_GATING` is off. Result:
   **staging** (flag on) is gated; **production** (flag off, verified
   2026-05-28) is open — any authenticated user can rewrite any adopter's
   name/family/notes. Fix: pass the gate unconditionally on write paths, or
   change `canEditAdopterRecord` to always enforce. **Caller audit done
   (2026-05-28):** the only caller is `src/components/AdopterForm.tsx:360`
   — a user-driven path that already passes a real actor. No service or
   import callsites; closing the gap is safe.

It still handles name, family members, notes, address (if address isn't a
contact entry — confirm in implementation).

## Authority model

Underpins both `saveAdopter`'s ACL tightening and the new actions' gates.
From the `project_collaborative_vetting_model` memory and the 2026-05-28
discussion:

**Adds are open. Mutations are gated.**

- **Adds** (open to any authenticated user): activity records, contact
  entries (incl. `'alias'`), flags. Append-only paths that preserve other
  contributors' data.
- **Mutations** (owner + admin only): renaming the profile, editing or
  removing existing contact entries, editing family members / notes /
  address-as-non-entry. Anything destructive to data another user added.

Scenario this resolves: User B is contacted by someone using a different
name with the same phone as an existing User A profile. B's options:
1. Log an activity describing the interaction (open).
2. Add an `'alias'` contact entry for the alternate name (open). Becomes
   searchable; future searchers find the profile by either name and see the
   discrepancy as vetting signal.
3. Cannot rename the profile or edit A's existing entries. If B believes A's
   data is fraudulent, B flags the record for admin review.

The owner gets a notification on every contribution (existing
`addContactEntry` notification path covers entries; activities already
notify). Owner reviews and decides whether to act (rename, remove, accept).

## Alias contact-entry type

Extend `ContactEntry.type` enum: `phone | email | social | id | address |
other | alias`.

- **Purpose:** record alternate names a person is known by, surfaced
  collaboratively when one contributor encounters a different identity.
- **Tokenization:** treat as a name token (NFD normalize, lowercase,
  word-split — same path as `adopters.name`), so an alias matches name
  searches. NOT a contact token (don't trigger the 6-digit phone-rule path).
- **Display:** chip with a person-icon (not phone/email iconography). Label
  like *"Conocido/a como"* in profile view.
- **PII gating:** **not** masked. Aliases are name-like, and the PII model
  only masks contact identifiers + address (per `piiAccess.ts`). Aliases
  follow names: visible to all viewers. As a consequence, `addContactEntry`
  skips the `pii_access_grant` insert when `type === 'alias'` (nothing to
  gate, grant would be inert).
- **Validation:** non-empty string, max 200 chars. Same merge/dedup behavior
  as other entries (`(type, normalizedValue)` collision).
- **Editing:** under the owner+admin gate, same as any other entry. A
  contributor who added an alias can't later edit it; if they typed it
  wrong, they add another or ask the owner to fix.

## Stable entry IDs

`ContactEntry` today is `{ type, value, streetAndNumber?, locality? }` — no
identity. Per-entry edit / delete needs stable IDs that survive reorder.

Approach:

- Extend type: `{ id: string, type, value, streetAndNumber?, locality? }`.
- In `deserializeContactEntries`: if an entry lacks `id`, assign one
  (`crypto.randomUUID()`). This is the only ID assignment point.
- On next write (any of the three actions), IDs are persisted naturally.
- Forward-compatible: no migration, no backfill, no schema change. Legacy
  entries gain IDs on first edit cycle.
- `mergeContactEntries` dedup logic uses `(type, normalizedValue)` today —
  unchanged; IDs are identity, not dedup keys. If a dedup collapses two
  entries, keep the older id.

## Files

### New
- `src/components/ContactEntriesSection.tsx` — the unified component (chips,
  composer, inline edit, optimistic delete with undo toast).
- `src/components/contactEntries/ChipRow.tsx` — single-entry display + edit
  affordances (extracted for testability).
- `src/components/contactEntries/InlineComposer.tsx` — type chips + value
  input(s) + actions row. Used both for "Agregar" and "Edit" modes (same
  shape, different submit target).
- `src/app/actions/updateContactEntry.ts`
- `src/app/actions/removeContactEntry.ts`

### Modified
- `src/components/AdopterProfileV2.tsx` — render `ContactEntriesSection`
  inline; remove the "+ Agregar" CTA block (lines 213–230 in current file);
  remove the `AddContactEntryModal` mount.
- `src/components/AdopterForm.tsx` — remove `ContactEntriesInput` from edit
  mode (contact entries are no longer a bulk-editable field). Edit mode keeps
  name / family / notes / etc.
- `src/components/ContactEntriesInput.tsx` — remains for **new-adopter
  creation** and for the bulk-paste-on-existing path when
  `ENABLE_BULK_PASTE_ON_EXISTING` is on. Trim ergonomics where reasonable but
  the component itself survives.
- `src/lib/contactEntries.ts` — add `id` to `ContactEntry`; assign in
  `deserializeContactEntries`; extend `type` enum with `'alias'`; keep
  `mergeContactEntries` dedup behavior.
- `src/lib/tokenizer.ts` — extend `tokenizeAdopter` so `'alias'` entries
  contribute name-tokens (NFD/lowercase/word-split), not contact-tokens.
- `src/lib/piiAccess.ts` (or wherever masking runs) — exempt `'alias'`
  entries from masking. Aliases are name-like, not PII.
- `src/app/actions/validation.ts` — extend `addContactEntrySchema` type enum
  with `'alias'`; add `updateContactEntrySchema`, `removeContactEntrySchema`.
- `src/app/actions/addContactEntry.ts` — skip `pii_access_grant` insert when
  `type === 'alias'` (alias is not PII; grant would be inert).
- `src/app/actions/index.ts` — export the two new actions.
- `src/app/actions/saveAdopter.ts` (or wherever `saveAdopter` lives) — drop
  `contactEntries` from the update payload **and** add the owner+admin gate
  (`addedBy === actor || isAdmin`). Caller audit: contract-app intake,
  import wizard, any non-user-driven path must pass a satisfying actor or
  use a documented service-bypass.
- `src/config/features.ts` — add `ENABLE_BULK_PASTE_ON_EXISTING` flag
  (default false), DB-backed.
- `src/i18n/locales/{es,en}.ts` — strings for: edit affordance label,
  delete affordance label, undo toast title + button, edit composer save /
  cancel, errors, alias type label. Sketch (es + en, per the i18n rule):
  - `ce_edit_label` "Editar" / "Edit"
  - `ce_delete_label` "Eliminar" / "Delete"
  - `ce_delete_toast` "Dato eliminado" / "Entry deleted"
  - `ce_undo` "Deshacer" / "Undo"
  - `ce_edit_save` "Guardar" / "Save"
  - `ce_edit_cancel` "Cancelar" / "Cancel"
  - `ce_edit_error` "No se pudo guardar" / "Couldn't save"
  - `ce_delete_error` "No se pudo eliminar" / "Couldn't delete"
  - `ce_type_alias` "Conocido/a como" / "Also known as"
  - `ce_alias_ph` "Otro nombre por el que se conoce a esta persona" /
    "Another name this person goes by"
  - `ce_bulk_paste_link` "Pegar varios" / "Paste multiple"
  - existing `contrib_cta` "Agregar dato de contacto" stays, repurposed as
    the inline composer's collapsed trigger.
  - all the `contrib_modal_*` keys → DELETE (modal goes away).

### Deleted
- `src/components/AddContactEntryModal.tsx`

## Tests

### Unit (vitest)
- `updateContactEntry.test.ts` — auth gate (contributor rejected, owner OK,
  admin OK); 404 on missing entryId; history kind='edit'; re-tokenize fires.
- `removeContactEntry.test.ts` — same auth tests; grant revocation; history.
- `contactEntries.test.ts` — extend: `deserializeContactEntries` assigns IDs
  to legacy entries; merge preserves older ID on collision; `'alias'` type
  validation roundtrip.
- `saveAdopter.test.ts` — add ACL tests: contributor rejected, owner OK,
  admin OK; service-bypass path documented and tested.
- `tokenizer.test.ts` — extend: `'alias'` entry contributes name-tokens (a
  search for the alias text matches an adopter whose only matching field is
  the alias); does NOT contribute to phone/email token paths.
- `piiAccess.test.ts` — extend: `'alias'` entries pass through masking
  untouched for all viewer tiers.

### E2E (Playwright)
- New spec `tests/contact-section.spec.ts`:
  - **Owner edits one entry** — tap pencil on phone chip → input appears →
    change value → save → only that entry's value changes, others untouched,
    history shows kind='edit' single-field change.
  - **Owner deletes with undo** — tap trash → entry disappears + toast
    appears → click Deshacer → entry restored, no DB change.
  - **Owner deletes confirmed** — tap trash → wait for toast timeout →
    entry stays removed, history shows removal.
  - **Contributor adds** — sign in as non-owner → inline composer →
    submit phone → entry appears with the contributor's grant visible,
    owner gets a notification (existing addContactEntry path).
  - **Contributor sees no edit/delete affordances** — explicit
    `expect(page.locator('[data-testid="chip-edit"]').first()).toHaveCount(0)`.
  - **Contributor cannot rename** — call `saveAdopter` via the form path,
    expect not-authorized response, no DB change.
  - **Contributor adds alias** — submit type=alias value="Juan Garcia" →
    chip appears with person icon → search for "Juan Garcia" returns this
    adopter.
  - **Masked viewer flow unchanged** — gated profile: masked chips render
    with lock, tap → verify popover (existing test, adapted to new DOM);
    aliases on a masked profile remain visible (not gated).
- Fixture: dedicated `test-unified-contact-*` adopters per the e2e isolation
  rule (no seeded-row pollution).

### Manual walkthrough
1. New adopter creation → paste flow still works (bulk add).
2. Existing adopter as owner → add one phone, edit it, delete it (undo,
   then confirm).
3. Existing adopter as contributor → add a phone, no edit/delete
   affordances visible.
4. Gated profile as masked viewer → tap masked chip → verify popover.
5. Mobile viewport: chip affordances have adequate hit targets (44px).

## Out of scope (Phase 2+)

- Per-field editing of OTHER profile fields (name, family members, notes).
  This refactor is scoped to contact entries; generalizing per-field for the
  rest of the profile is its own design exercise.
- Contributors editing their own contributions (add a "you typed this, you
  can fix it within 5 min" affordance). Adds complexity; current rule of
  owner-only edit stays clean.
- Reordering entries (drag-to-reorder).
- Bulk delete UI ("clear all phones"). Power-user case, low value.
- Email notifications for edits / deletes (system-wide phase-2 item).
- Audit log UI showing per-entry edit history on the profile (history exists
  in `adopter_history`, just not surfaced per-entry in the UI).

## Resolved decisions (2026-05-28)

1. **Edit UX = inline transform.** Tap ✎ → chip becomes input in place.
2. **Bulk paste = kept on existing adopters behind feature flag
   `ENABLE_BULK_PASTE_ON_EXISTING`** (default off, owner/admin only when on).
   Always available on new-adopter creation.
3. **Delete UX = optimistic + 5-second undo toast.** No confirm dialog.
4. **`saveAdopter` ACL = tightened to owner+admin in this PR.** Caller audit
   (contract-app intake, import wizard, any non-user-driven path) is part of
   build step 2. Authority model: **adds are open, mutations are gated** —
   any authenticated user can add activities and contact entries (incl.
   `'alias'`); only owner+admin can rename, edit or remove existing data.
5. **Bulk-cleanup cost = accepted.** No "Editar todo" fallback in v1.
   Per-entry edit/delete is the only path on existing adopters (unless the
   bulk-paste flag is on, which restores a bulk add path but not bulk
   edit/delete).
6. **New: alias contact-entry type.** Adds `'alias'` to the `ContactEntry`
   type enum to resolve the same-phone-different-name scenario without
   destructive edits. See "Alias contact-entry type" section above.

## Versioning

Significant UX change — releasable as `2.15.0` follow-up or its own minor
(`2.16.0`). Recommendation: `2.16.0` because this materially changes the
edit model, not just adds a feature.

## Suggested build order

### Phase A — server-side, forward-compatible (one staging ship)

1. **`ContactEntry.id` + `'alias'` type + `deserializeContactEntries`
   assignment** + merge helper tests + tokenizer extension for alias-as-name
   + piiAccess alias exemption.
2. **`saveAdopter`: make the existing `canEditAdopterRecord` gate
   unconditional** + strip `contactEntries` from its payload + unit tests.
   Caller audit already done — single caller, safe to tighten.
3. **`updateContactEntry` + `removeContactEntry` actions** + unit tests +
   grant revocation logic in `removeContactEntry`.
4. **Verify, version bump, push to staging.** Forward-compatible — current
   UI keeps using the existing `addContactEntry` modal + bulk Editar flow;
   no user-visible change. The new actions sit idle until Phase B wires
   them.

### Phase B — UI flip (one staging ship after Phase A lands)

5. **`ENABLE_BULK_PASTE_ON_EXISTING` feature flag** in `src/config/features.ts`.
6. **`ContactEntriesSection` component** with display + inline-composer add
   (incl. alias type-chip); wire into `AdopterProfileV2`; remove the
   "+ Agregar dato" CTA + modal mount.
7. **Inline edit + optimistic delete + undo toast** in the same component.
8. **Remove `ContactEntriesInput` from `AdopterForm` edit mode**; keep it
   alive for new-adopter creation and the flagged bulk-paste-on-existing
   path; wire the "Pegar varios" link in `ContactEntriesSection`.
9. **Delete `AddContactEntryModal`** + drop `contrib_modal_*` i18n keys.
10. **E2E + manual walkthrough + version bump (`2.16.0`) + push to staging.**
