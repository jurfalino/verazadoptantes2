# Household members redesign: structured family/convivientes with per-person contacts

**Status:** Approved; decisions locked (2026-08-26). Phase 0 in progress. Flag: `ENABLE_HOUSEHOLD_MEMBERS` (admin-UI toggled).
**Author:** drafted 2026-08-26 (interactive design + functional prototype this session).
**Prototype:** the functional web prototype validated the UX (structured people, explicit save per person, per-contact add/edit/remove, network-first contact composer).
**Related:** [[project_family_alias_are_name_tokens]], [[project_collaborative_vetting_model]], [[project_pii_minor_version]], [[project_social_dedup_tokenization_spec]], `src/lib/piiAccess.ts`, `src/lib/contactEntries.ts`.

---

## 1. Context & problem

Today "Familiares / Convivientes" is a **single free-text field** (`adopters.family_members`, rendered in `AdopterForm.tsx:1312` as a textarea / autosave `InlineEditField`). It captures household members as prose. That has three costs:

1. **No structure per person** — you can't attach a phone/email/social to a specific household member; the whole household is one blob.
2. **All-or-nothing PII** — free text can't be masked selectively, so household contact info can't ride the per-entry visibility system the titular adopter's contacts use.
3. **Weak dedup** — the blob tokenizes as name words only; a household **phone/handle** shared across records (a strong duplicate signal, and a real abuse vector) isn't captured.

**Goal:** replace the free text with **structured household members** — each a person with a **name**, a **relationship** (which may be *unknown*), and their **own contact entries**, added/edited exactly like the titular adopter's contacts. Household contacts are **PII-protected the same way** as the titular's, and **feed duplicate detection** the same way.

---

## 2. Goals / non-goals

**Goals**
- One structured record per household member: name + relationship + `ContactEntry[]`.
- Per-person contacts use the **exact contact model + composer** as the titular (all types, network-first social, phone apps) — add / **edit** / remove, with explicit save (no free-floating always-editable fields).
- Household contacts inherit the titular record's **PII visibility verdict** and per-entry grant/verify/request flows.
- Household member **names + contacts feed the duplicate tokenizer** (name tokens + phone/email/social/id tokens), strengthening abuse detection (a relative's name or a shared household phone now links records).

**Non-goals**
- No recursion — a household member has contacts but not their own household.
- No per-member visibility toggle — the whole record shares one público/protegido verdict (existing model).
- Not merging with the separate `household` column (schema:560 — that's household *attributes*: children/pets/outdoor; unrelated).
- No change to how the titular adopter's own contacts work.

---

## 3. Design

### 3.1 Data model

**New JSON column** on `adopters` (mirrors how `contact_entries` is stored — denormalized JSON, no new table, no extra joins):

```ts
// schema.ts — adopters
householdMembers: text("household_members"), // JSON: HouseholdMember[]
```
(`family_members` free-text column is **retained** for legacy read + migration; deprecated for new writes.)

```ts
// src/domain/householdMembers.ts (NEW, pure — client+server safe)
export type Relationship =
  'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate' | 'unknown';

export interface HouseholdMember {
    id: string;                 // stable id (like ContactEntry.id)
    name: string;               // may be '' if only relationship + contacts are known
    relationship: Relationship | null;
    contactEntries: ContactEntry[]; // SAME shape as the titular's — full reuse
    addedBy?: string;           // contributor attribution (collaborative-vetting model)
}
```
- `deserializeHouseholdMembers(json)` / `serializeHouseholdMembers(members)` — bounded + sanitized (max members, reuse `deserializeContactEntries` for each member's entries so all the entry-level sanitization/id-assignment/social-platform logic is shared). Cap: e.g. `MAX_MEMBERS = 30`.
- A member is valid to persist when `name.trim()` **or** `relationship` is set (an unnamed "the son, phone X" is allowed — confirm §5).

### 3.2 UX (validated by the prototype)

`AdopterForm` "Familiares / Convivientes" becomes a structured section (new `HouseholdSection` component):
- **Empty state** + CTA **"Agregar familiar / conviviente"**.
- **Per-member card:** avatar (initial) + **Nombre** + **Parentesco** select (incl. *Desconocida*). New member opens in an **edit state** with explicit **Cancelar / Guardar** (Guardar enabled when name or relationship present; Cancelar on a brand-new member discards it). Saved member shows read-only "Name · relationship" with a **pencil** (→ edit) and **trash** (remove) — the `InlineEditField` explicit-save model, NOT autosave.
- **Per-member contacts:** appear once the member is saved; the **same composer** as the titular (type pills → editor, network-first social picker + per-network placeholders, WhatsApp/Telegram toggles). Each contact chip has hover **pencil (edit)** + **trash (remove)**; adding via the type-pill composer. This is `ContactEntriesSection` behavior, scoped to a member.

**Reuse:** `HouseholdSection` should render `ContactEntriesSection` per member (see §3.5 for the `memberId` plumbing) rather than reimplement the composer — the composer, network-first social, phone apps, per-entry edit, masking hooks all come for free.

### 3.3 PII masking — "protected the same way"

The access model is **per-record and value-hashed**, so household contacts drop into it with only additive changes (verified against `src/lib/piiAccess.ts`):

- **One verdict, applied to all contacts.** `resolveVisibility()` (piiAccess.ts:450) already yields a per-adopter tier (owner / admin / moderator / org-mate → `full`; else `partial`/`none` + grants). Run `maskContactEntries()` (:657) over **each member's `contactEntries`** with the **same `visibility`** used for the titular's entries. No new visibility, no per-member public/protected flag.
- **Per-entry grants unchanged** — `entryRef = hashEntryValue(type, value)` (:98) hashes the *value*, so a member's phone works identically:
  - *Verify a detail you already know* → unlocks that entry (`PiiVerifyPopover`).
  - *Search-match auto-grant* → extend `matchSearchEntries()` (:273) to also scan members' entries.
  - *Request access with a reason* → a record-scoped grant unlocks the whole record incl. household.
  - A value shared by titular + member unlocks once (same real contact) — desirable.
- **Gated types unchanged** — `MASKED_ENTRY_TYPES = ['phone','email','social','id','address']` (:34); `alias`/`other` don't mask; address keeps the street-gated / locality-visible split.
- **Member name display:** mirror the titular — `partialRevealName()` (:598) for masked viewers; full name stays server-side as a dedup token, never exposed. (Decision §5.)
- **Relationship label:** metadata (like record-type), shown even to masked viewers; name partial-revealed, contacts masked. (Decision §5.)
- **Badge / "who has access":** record-level, already covers the whole record — no per-member badge.

### 3.4 Duplicate detection

`extractTokens` already folds the free-text `family_members` into name tokens (tokenizer.ts:341,394,405,438). With structured members it should receive **member names** (→ `name_full` + `name_word`) **and member contacts** (→ `phone`/`email`/`social`+`social_handle`/`id` tokens — including the dual social tokens from [[project_social_dedup_tokenization_spec]] for free).

- Add an optional `household?: Array<{ name: string; contactEntries: ContactEntry[] }>` param to `extractTokens` (mirror the `aliases` / `socials` params). The two tokenize call sites (`duplicates.ts:tokenizeAdopter`, `api/admin/duplicates/route.ts`) deserialize `householdMembers` and pass names + contact values.
- **Pre-save/form dedup** (`findFormDuplicates` → `findAdopters`) should likewise include household names + contacts so the create-flow duplicate hint fires on a shared household phone (bidirectional — [[project_family_alias_are_name_tokens]]).
- **`TOKENIZER_VERSION` bump + re-scan** required (new tokens per record) — same "Scan Now" step as the social work; bundle if shipping near it.

### 3.5 Server actions — reuse the contact CRUD

**Do not duplicate the contact CRUD.** Extend the three existing actions with an optional `memberId`; when present they target `householdMembers[memberId].contactEntries` instead of `adopters.contactEntries`, reusing all validation, PII, re-tokenization, and attribution:
- `addContactEntry({ adopterId, memberId?, type, value, ... })`
- `updateContactEntry({ adopterId, memberId?, entryId, ... })`
- `removeContactEntry({ adopterId, memberId?, entryId })`

New member-level actions (thin, mirror `InlineEditField` save semantics + `canEditAdopterRecord` gate + audit):
- `addHouseholdMember({ adopterId, name, relationship })` → returns the new member id.
- `updateHouseholdMember({ adopterId, memberId, name?, relationship? })`.
- `removeHouseholdMember({ adopterId, memberId })` (also removes its contacts).

All member writes **re-tokenize the adopter** (like `addContactEntry` does) so dedup stays fresh. Edit gate = `canEditAdopterRecord` (owner / admin / org-mate); per-entry contributor edit applies to member contacts too (collaborative-vetting model).

### 3.6 Relationships + i18n

Keys → i18n labels (es/en/pt), stored as the enum key (not the label):
| key | es | en | pt |
|---|---|---|---|
| partner | Pareja | Partner | Parceiro/a |
| child | Hijo/a | Child | Filho/a |
| parent | Padre/Madre | Parent | Pai/Mãe |
| sibling | Hermano/a | Sibling | Irmão/ã |
| other_relative | Otro familiar | Other relative | Outro familiar |
| housemate | Conviviente | Housemate | Convivente |
| unknown | Desconocida | Unknown | Desconhecida |

Section chrome reuses existing `adopter.family_members` label; add `household.rel_*` + CTA/edit strings. **Update all three locales together** (CLAUDE.md i18n rule).

### 3.7 Feature flag — `ENABLE_HOUSEHOLD_MEMBERS`

Gated by a DB-backed flag added to `FEATURE_FLAGS` (`src/config/features.ts`),
**toggled through the Admin UI** (`appConfig`), env fallback — same mechanism as
`ENABLE_PII_ACCESS_GATING` et al. No redeploy needed to flip it.
- **OFF** → render today's free-text section (unchanged). **ON** → `HouseholdSection`.
- The backend (column, PII masking, dedup tokenization) handles `household_members`
  **regardless of the flag**, so the code deploys **dark** and is safe. The flag
  only gates whether the UI shows/writes structured members.
- **Public-flag plumbing required:** rescuers (non-admins) see this section, so the
  key must ALSO be added to the public flag list served by `/api/config`
  (see [[feedback_feature_flag_5_place]]) — otherwise the admin toggle is a silent
  no-op for non-admins.
- Rollout: deploy dark → **flip ON in Admin UI on staging** → verify masking
  end-to-end → flip ON on prod. **Instant rollback** via the same toggle. The
  legacy→structured "Convertir" backfill and the `TOKENIZER_VERSION` re-scan are
  triggered *around* the flip, not before.

---

## 4. Migration

1. **Add column** `household_members` (nullable JSON text) — migration `00NN_household_members.sql`.
2. **Best-effort backfill** of legacy `family_members` free text → structured members: split on newlines/`;`/`,`, each fragment → `{ id, name: fragment, relationship: null, contactEntries: [] }`. Keep it conservative; the review UI lets the rescuer refine. Run as a one-off backfill (server action or SQL-side is hard — do it in a guarded admin action or a script that reads+writes via the app). Legacy `family_members` retained read-only as provenance; new writes go to `household_members`.
3. **`TOKENIZER_VERSION` bump + re-scan** (household names + contacts now tokenized) — admin **"Scan Now"**.
4. UI: if `household_members` is empty but legacy `family_members` has text, show the legacy text (read-only) with a **"Convertir a personas"** affordance that runs the same parse into editable members.

---

## 5. Decisions & open questions

**Locked (from this session's design + prototype):**
- Structured JSON column `household_members` (not a table; not the taken `household` column).
- Explicit save per member + per-contact **add/edit/remove** (matches `ContactEntriesSection`/`InlineEditField`).
- Full contact parity (all types, network-first social, phone apps) via **reused** `ContactEntriesSection` + `memberId`-scoped contact CRUD.
- PII: household contacts inherit the record verdict; drop into `resolveVisibility` + `maskContactEntries` + value-hash grants.
- No recursion; no per-member visibility; relationship stored as enum key.

**Resolved (user sign-off 2026-08-26):**
1. **Nameless member allowed** — yes; save permitted with name **or** relationship (so "the son, phone X" works).
2. **Masked viewers** — yes; member name **partial-revealed** (initials, like the titular); **relationship stays visible**.
3. **Legacy migration** — manual **"Convertir a personas"**, NOT auto-parse (avoids mangling prose like "vive con su madre y 2 gatos").
4. **Release** — **minor** version (significant feature, like PII gating — [[project_pii_minor_version]]).
5. **Feature flag** — `ENABLE_HOUSEHOLD_MEMBERS`, admin-UI toggled (§3.7).

---

## 6. Implementation plan (phased, staging-first)

**Dependency rule:** the UI must NOT expose household contacts to non-owners until PII masking covers them (Phase 3) — Phases 1–3 ship together as the first release; dedup (Phase 4) follows with its re-scan.

### Phase 0 — Data model (domain, pure) + tests
- `src/domain/householdMembers.ts`: `HouseholdMember`, `Relationship`, `deserialize/serializeHouseholdMembers` (reusing `deserializeContactEntries` per member), `parseLegacyFamilyText(text)` → members, `MAX_MEMBERS`. Unit tests (vitest): round-trip, bounds, legacy parse, invalid JSON → [].
- `schema.ts`: add `household_members` column; migration `00NN_household_members.sql`.

### Phase 1 — Server actions
- Extend `addContactEntry` / `updateContactEntry` / `removeContactEntry` with optional `memberId` (target member's `contactEntries`; same validation/PII/re-tokenize/attribution).
- `addHouseholdMember` / `updateHouseholdMember` / `removeHouseholdMember` (gated by `canEditAdopterRecord`, audited, re-tokenize).
- Barrel exports.

### Phase 2 — PII (must land with the UI)
- `maskAdopterContact` also masks each `householdMembers[].contactEntries` with the record's `visibility`.
- `matchSearchEntries` + `matchSearchNameTokens` also scan household members' entries + names (so search/verify grants + name-token grants cover them).
- Member name display uses `partialRevealName` when not privileged; relationship shown.

### Phase 3 — UI
- `HouseholdSection` component: member cards (explicit save/edit/remove) rendering `ContactEntriesSection` per member (via `memberId`). Replace the `AdopterForm.tsx:1312` textarea/InlineEditField. i18n `household.rel_*` + chrome (es/en/pt). Legacy read-only + "Convertir" affordance.
- Gate the whole section behind `ENABLE_HOUSEHOLD_MEMBERS` (§3.7): OFF → legacy free-text; ON → `HouseholdSection`. Add the flag to `FEATURE_FLAGS` + the `/api/config` public keys.
- **Ship Phases 0–3 as one minor release** (deploy dark), then flip the flag ON via Admin UI on staging → prod.

### Phase 4 — Duplicate detection (+ re-scan)
- `extractTokens` new `household` param (names + contacts); wire the two tokenize call sites + `findFormDuplicates`. `TOKENIZER_VERSION` bump. Post-deploy **"Scan Now"**.

### Phase 5 — Migration polish
- Optional bulk "Convertir" for existing legacy household text; monitor.

---

## 7. Testing
- **Domain (vitest):** serialize/deserialize round-trip; legacy parse; bounds; a member with empty name + relationship; per-member `contactEntries` reuse.
- **PII (extract pure filters where possible):** a protected record masks household phone/email/social/id/address; alias/other unmasked; a value-hash grant unlocks the same value on titular + member; masked viewer sees partial name + relationship.
- **Dedup (system `sqlite3` per [[project_e2e_node26_bettersqlite]]):** a household phone shared across two records surfaces as a duplicate; a member name matches; verify/search grant fires on a member entry.
- **e2e (CI Playwright, locale-agnostic):** add a member, save, add a contact, edit it, remove; masked view hides member contacts.

## 8. Touch list
- **New:** `src/domain/householdMembers.ts` (+ test); `src/components/HouseholdSection.tsx`; migration `00NN_household_members.sql`; member CRUD actions (+ barrel).
- **Modify:** `src/db/schema.ts` (column); `addContactEntry`/`updateContactEntry`/`removeContactEntry` (+`memberId`); `src/lib/piiAccess.ts` (`maskAdopterContact`, `matchSearchEntries`, `matchSearchNameTokens`); `src/lib/tokenizer.ts` (`extractTokens` household param) + `duplicates.ts` + `api/admin/duplicates/route.ts` + `findFormDuplicates.ts`; `AdopterForm.tsx:1312` (swap the section); `ContactEntriesSection` (accept `memberId`, pass through the CRUD calls); `src/i18n/locales/{es,en,pt}.ts`.
- **Flag:** `src/config/features.ts` (`ENABLE_HOUSEHOLD_MEMBERS`) + the `/api/config` public-flag list (non-admin visible).
- **Ops:** flip `ENABLE_HOUSEHOLD_MEMBERS` in Admin UI (staging → prod); admin "Scan Now" after Phase 4 (TOKENIZER_VERSION bump).


---

## 9. v1 scope notes (during implementation)

- **Household editing is gated to owner ∨ admin ∨ org-mate** (the `saveAdopter`
  mutation model), NOT the open-contribution model `addContactEntry` uses for the
  titular. Simpler + closes the PII surface (only privileged editors, who see
  unmasked anyway, touch household — no contribution grants needed). Dedicated
  actions in `householdMembers.ts` rather than branching the titular contact CRUD
  (safer than destabilizing the battle-tested titular flow). Open collaborative
  household contribution = follow-up.
- **PII:** `maskHouseholdMembers` (security) is complete. Household in the
  **per-entry search-match / verify grant** flow is deferred — moot in v1 because
  a masked viewer cannot add a household contact (gated), so their only unlock
  path is the **record-scoped request flow**, which already reveals household
  (`maskHouseholdMembers` passes through on `nothingMasked`). Follow-up if
  per-entry household grants are wanted.
