# Households as Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person in a household is an adopter profile, and a household is a group of profiles. This replaces the inline `adopters.household_members` JSON and the `household_links` mirror.

**Architecture:** Two new tables (`households`, `household_memberships`) plus `household_corrections` are the only record of who lives with whom. Pure rules live in `src/domain/households.ts`; reads and writes go through `src/lib/households.ts`; thin server actions live in `src/app/actions/households.ts`. Unattended paths (forms, API, importer, interview) resolve people with the API's exact matcher. A one-off admin conversion moves today's data across, and nothing writes the old JSON afterwards.

**Tech Stack:** Next.js 15 (edge pages), Drizzle + D1, Vitest + `migratedDb`, Playwright (`user` + `authed` projects).

**Spec:** `docs/superpowers/specs/2026-10-26-households-as-profiles-design.md`. Read it with the one-shared-reality principle and D44–D55 in `docs/superpowers/specs/2026-10-25-pendientes-d-design.md`.

## Global Constraints

- One shared reality: a fact is stored once and shown the same to everyone. Only privacy masking differs per viewer.
- A member profile is a normal adopter row: searchable, mergeable, rateable. The profile rule applies (`hasMinimumIdentifier`: a name or a contact detail).
- **Owner of a profile created from a household add = the host profile's owner.** The typist is credited (`added_by` on the membership and `addedBy` on each contact) and gets entry grants for what they typed (D54 contribution model, `src/lib/contributionSideEffects.ts`). From an adoption form, the owner is the form's owner.
- **Unattended matching = exactly the API's** `findIdentifierHits` + `decideExactOutcome` (phone, email, ID number; name must fit; exactly one consistent profile). Otherwise create a new profile and let the duplicate scan decide. Never pick on a fuzzy match.
- **Search returns only the profiles that match.** Every card (search, «¿Es este perfil?») shows its households' line with each housemate's live rating and alerts. Housemates never become duplicate candidates of each other.
- A profile can be in several households. Relationship is stored relative to `relative_to_adopter_id`; labels per spec §Households (no reverse labels except the symmetric `partner`, `sibling`).
- Gift recipient: NOT a profile by default. The giver's profile shows «Destinatario del regalo (según el formulario)» from the form answers. «Crear perfil de {nombre}» creates the profile and puts it in a gift household (`gift_recipient = 1`), never shown under «Convive con».
- **Visual source of truth:** prototype branch `prototype/households-as-profiles` (commit 4afff8f7, worktree ../verazadoptantes2-hhproto, `src/components/prototype/*`) and its screenshots in `/Users/jurfalino/Developer/Personal/verazadoptantes2/proto-shots/households/` (states P1–P5, M1, Q1, D1, D2, E1, E2, K1, A1–A5, N2, N3, H1, S1, S2). Jon approved these screens. The real UI must match them.
- **Names and ages of any profile** can be changed by anyone signed in. The old name is kept as a rename alias (shown only as «Conocido/a como» under the name, not in the contact list), the owner's team is told in-app and by email with «Deshacer», and the change goes into the history.
- **Minors** (current age < 18, or `is_minor`) are searchable profiles tagged «Menor de edad». They get no rating, no alerts and no adoption records (server-enforced), and their profile hides «¿Qué pasó con …?» and «Actividad».
- Corrections are stored per (household, person); a re-add or a merge back is a dispute that notifies admins (D48).
- Privacy: each person's contacts follow their own profile. The conversion copies the host's `is_public` and every live grant (`all_contact` and `entry`) that covered the moved contacts.
- History kinds: 'edit' only for actors privileged on that profile (`src/lib/profilePrivilege.ts`); else 'contribution'.
- D1: no `IN(array)`; fan out with `Promise.all`. Every catch logs context; user errors carry an errorId; `userFacingMessage` / `handledAsStale` in catch blocks; es/en/pt for every string; theme-safe classes; ≥44px targets; 390px with no horizontal scroll.
- Hand-written migration `drizzle/0096_households.sql`, no journal. A new server action raises `EXPECTED_ACTIONS` in `scripts/check-action-surface.mjs` in the same commit.
- Never `git add -A`/`-u`. Tracked seed DBs are never committed.

## Review Focus

1. **Nobody sees more, or less, contact data after the conversion.** A viewer who saw a member's phone on the host still sees it on the member's profile. A viewer who didn't still doesn't. Test in Task 7.
2. **An old tab writing the old JSON after the conversion** (deploy skew forwards it to an old build) loses nothing. The conversion is idempotent and re-runnable, and a re-run picks up members written since. Test in Task 7.
3. **Re-sending the same adoption form, or re-importing the same person,** never creates the household person twice. Test in Task 4.
4. **Merging two housemates,** or a member into their host, leaves no self-membership and no duplicate membership. Undo restores exactly. Test in Task 6.
5. **A dangerous relative stays visible:** searching the son's name or phone shows the son's card with «Convive con Pedro ★1». Test in Task 5 (unit) and Task 8 (e2e).

---

### Task 1: Tables, rules and the read/write core

**Files:**
- Create: `drizzle/0096_households.sql`; `src/domain/households.ts` (+ `.test.ts`); `src/lib/households.ts` (+ `.test.ts`).
- Modify: `src/db/schema.ts`.

**Interfaces (produced):**
- Tables:
  - `households(id TEXT PK, created_by TEXT, created_at INTEGER)`.
  - `household_memberships(id TEXT PK, household_id TEXT NOT NULL, adopter_id TEXT NOT NULL, relationship TEXT NOT NULL DEFAULT 'unknown', relative_to_adopter_id TEXT, gift_recipient INTEGER NOT NULL DEFAULT 0, added_by TEXT, added_at INTEGER NOT NULL, source_key TEXT)`, `UNIQUE(household_id, adopter_id)`, indexes on `adopter_id`, `household_id` and `source_key`. `source_key` identifies where a membership came from: `inline:{hostId}:{memberId}`, `link:{linkId}`, `form-{submissionId}-{i}`, `interview:{id}:{i}`, `import:{batch}:{row}`.
  - `household_corrections(id TEXT PK, household_id TEXT NOT NULL, adopter_id TEXT NOT NULL, corrected_by TEXT NOT NULL, corrected_at INTEGER NOT NULL, snapshot TEXT)`.
  - `adopters` gains `age INTEGER`, `age_as_of TEXT`, `is_minor INTEGER NOT NULL DEFAULT 0`. Memberships carry no age. Add the pure `isMinor({ age, ageAsOf, isMinor }, today): boolean` in `src/domain/households.ts`, reusing today's `currentAge` logic.
- Domain:
  - `membershipLabel(viewedProfileId: string, m: { adopterId; relationship; relativeToAdopterId }, names: Record<string,string>): { key: string; params: Record<string,string> } | null`. Returns an i18n key + params, e.g. `{ key:'adopter.hh_rel_partner' }` or `{ key:'adopter.hh_rel_of', params:{ rel, name } }`.
  - `canRemoveMembership(viewer: { email; privilegedOn: (adopterId) => boolean; isAdmin }, m, householdAdopterIds: string[]): boolean`. True for: the adder, privileged on any profile in the household, admin/moderator.
- Lib (all take `db`):
  - `getHouseholdsFor(viewer: string|null, adopterId: string): Promise<HouseholdView[]>`. `HouseholdView = { id, isGift: boolean, members: Array<LinkedSummary & { membershipId; label; addedByName; canRemove; canReportNotLiving }> }`. It excludes the viewed profile and reuses the masking/summary code behind today's `getLinkedSummaries` (`src/lib/householdLinks.ts:634`).
  - `ensureHousehold(db, anchorId, actor): Promise<string>`, `addMembership(db, input): Promise<{ membershipId; created: boolean }>` (idempotent on the unique pair), `removeMembership(db, membershipId, actor, { correction: boolean })`, `householdIdsOf(db, adopterId)`, `sameHousehold(db, a, b): Promise<boolean>`.

- [ ] Write failing tests:
  - `membershipLabel`: on Pedro's profile Marta = «pareja»; on Lucas's profile Marta = «pareja de Pedro» and Pedro = no label; on Marta's profile Pedro = «pareja» (symmetric).
  - `canRemoveMembership`: the adder ✓, a housemate's team ✓, a stranger ✗.
  - `getHouseholdsFor`: two households → two views; a gift household is flagged; a masked viewer gets masked contacts; a deleted profile is skipped.
  - `addMembership`: twice → one row.
- [ ] Implement; run `npx vitest run src/domain/households.test.ts src/lib/households.test.ts`. Expected: PASS.
- [ ] Commit.

### Task 2: Server actions — add, update, remove, «No convive»

**Files:**
- Create: `src/app/actions/households.ts` (+ `households.test.ts`).
- Modify: `src/app/actions/index.ts`, `scripts/check-action-surface.mjs`.
- Retire from use: `src/app/actions/householdMembers.ts` and `src/app/actions/householdLinks.ts`. Their old exports stay as thin wrappers that call the new ones until Task 7 removes their last callers.

**Interfaces:**
- Consumes Task 1.
- `addHouseholdPerson(input: { anchorAdopterId: string; householdId?: string; existingProfileId?: string; name?: string; relationship?: Relationship; age?: number|null; contactEntries?: ContactDraft[]; giftRecipient?: boolean }): Promise<{ ok:true; profileId; membershipId; createdProfile: boolean; autoRequestFiled: boolean } | { ok:false; error; errorId? }>`
  - With `existingProfileId`: link that profile; contacts go through `addContactEntry` semantics on it.
  - Without it: create a profile with owner = the anchor's owner, contacts credited to the actor with contribution grants. Refuse when `hasMinimumIdentifier` fails.
  - If a correction exists for (household, person): add anyway and notify admins (dispute).
- `updateHouseholdMembership({ membershipId, relationship })`: open to anyone signed in. Credited, with history, and the household's teams are notified. Name and age go through Task 3's actions.
- `removeHouseholdMembership({ membershipId, reason: 'mistake' | 'not_living' })`: `canRemoveMembership`. `'mistake'` removes the membership with no record. `'not_living'` writes a correction («No vive acá»). History on the person's profile and every remaining housemate's (kind via `historyKindFor`). Notices to the other teams.
- `getHouseholdMatchCandidates({ name, contactEntries })`: the «¿Es este perfil?» data for the add form. It reuses the duplicate check used by «Nuevo adoptante» (find it in `src/components/AdopterForm.tsx`) and adds each candidate's household line.

- [ ] Write failing tests:
  - A stranger adds a new person to Pedro's household → the profile is owned by Pedro's owner, the phone is credited to the stranger with an entry grant, history kind 'contribution', Pedro's team is notified, and the stranger is not an approver.
  - Adding with `existingProfileId` links it and puts the typed phone on it once.
  - Re-adding after «No convive» → admins are notified.
  - Removal by a stranger who didn't add it ✗; by the adder ✓; by a housemate's team ✓.
  - `notLivingTogether` writes a correction and history on both profiles.
  - A relationship-only add (no name, no contact) ✗.
- [ ] Implement; ratchet the action count (log the new count); run vitest + `npx tsc --noEmit`.
- [ ] Commit.

### Task 3: Any profile — open rename, age, minors

**Files:**
- Create: `src/app/actions/profileIdentity.ts` (+ test).
- Modify:
  - the name/age display in `src/components/AdopterProfileV2.tsx` (header: «Conocido/a como: …» line, «16 años», «Menor de edad» tag)
  - `src/app/actions/adoptions.ts` (refuse records on a minor)
  - `src/app/actions/flags.ts` (refuse alerts on a minor)
  - the rating paths
  - `src/domain/notificationTemplates.ts` + `src/domain/emailCategories.ts` (new `profile_renamed`, category «Cambios en tus perfiles», es/en/pt, `metadata.undo`)
  - `src/lib/notificationEmail.ts` (second «Deshacer» button when `metadata.undo` is present)
  - the notification bell item and the history list (a «Deshacer» action)

**Interfaces:**
- `changeProfileName({ adopterId, name, expectedName }): Promise<{ ok:true } | { ok:false; error:'conflict'|...; errorId? }>`. Open to any signed-in user.
  - Compare-and-set on `expectedName`, else `conflict` (existing collab message).
  - The old name is appended as a contact entry `{ type:'alias', value: old, addedBy: actor, fromRename: true }`. It's a name token, hidden from the contact list, shown as «Conocido/a como».
  - History `name_changed` (kind via `historyKindFor`).
  - Notify the owner's team (`profile_renamed`, url to the profile, `metadata.undo = { historyId }`); the actor is not notified.
- `undoProfileRename(historyId)`: owner team or admin. Restores the name, keeps the reverted name as a rename alias, writes history, notifies the renamer.
- `changeProfileAge({ adopterId, age: number|null, isMinor: boolean })`: open; credited, with history and notice. `age < 18` forces `isMinor`.

- [ ] Write failing tests:
  - A stranger renames → name changed, alias kept, a search for the old name still finds the profile, the owner is notified with undo, the stranger is not an approver.
  - A stale `expectedName` → `conflict`.
  - Undo by the owner ✓, by a stranger ✗.
  - Age 12 → minor.
  - On a minor: `saveAdoption` refused, `flagAdopter` refused, rating refused.
  - At 18 (age + time) → not a minor.
  - The email for `profile_renamed` has the «Deshacer» link.
- [ ] Implement; ratchet the action count; run vitest + tsc.
- [ ] Commit.

### Task 4: Unattended paths — forms, API, importer, interview, gift recipient

**Files:**
- Create: `src/lib/householdPeople.ts` (+ test).
- Modify:
  - `src/app/api/form/[userId]/submit/route.ts:248-265`
  - `src/app/actions/_adopterFactory.ts`
  - `src/app/api/adopters/route.ts:332-336,472`
  - `src/app/actions/interviewComplete.ts:89-130`
  - `src/components/ImportWizard.tsx:1112,1374`
  - `src/lib/api/profiles.ts` (`householdNames` read from memberships)

**Interfaces:**
- `resolveHouseholdPerson(db, person: { name; phone?; email?; documentId? }, ownerCountry: string|null, requestId: string): Promise<{ profileId: string } | null>`. Returns a profile only when `decideExactOutcome` is `found`.
- `attachHouseholdPeople(db, { anchorAdopterId, people: Array<{ name; relationship; age?; isMinor?; contactEntries }>, actor, ownerEmail, sourceKey: string }): Promise<void>`. For each person: resolve, else create; then `addMembership`.
  - `sourceKey` (e.g. `form-${submissionId}-${i}`) is stored on the membership (`source_key`) and checked first, so a resend reuses that membership and its person.
  - It never writes `household_members`.

- [ ] Write failing tests:
  - A form with 2 named people → 2 profiles + 1 household with the applicant.
  - The same form re-submitted → no new profiles.
  - A person whose phone + name match exactly one profile → that profile is reused.
  - Phone matches but the name doesn't fit → a new profile.
  - Gift intent → NO profile and no household; the giver's profile reads the recipient from the form answers.
  - `createGiftRecipientProfile({ giverAdopterId, submissionId })` (open to the giver's team or admins) creates the profile from the answers (owner = the giver's owner) plus a gift household.
  - Interview additions → memberships, no duplicates by name within that household.
  - `POST /api/adopters` with `householdMembers` JSON → memberships, no JSON stored.
- [ ] Implement; run the touched tests + tsc.
- [ ] Commit.

### Task 5: Search, duplicate detection, API exact mode

**Files:**
- Modify:
  - `src/lib/tokenizer.ts` (drop structured household from host tokens; `TOKENIZER_VERSION` → `'v8'`; keep legacy `familyMembers` text)
  - `src/lib/adopterTokenize.ts`
  - `src/app/api/admin/duplicates/route.ts`
  - `src/app/actions/findAdopters.ts:1162-1174` (structured-member scoring removed; legacy text kept)
  - the duplicate-candidate scan and the Pendientes feed (`src/app/actions/duplicates.ts`): skip pairs where `sameHousehold`
  - `src/domain/apiExactMatch.ts` (`household_member` no longer produced)
  - the search result card and «¿Es este perfil?» card components (find via `findAdopters` discovery render)

**Interfaces:**
- Consumes `getHouseholdsFor` / a batched `householdLinesFor(db, viewer, adopterIds: string[]): Promise<Record<string, HouseholdLine[]>>` (add it to `src/lib/households.ts`; `Promise.all` per id).
- `HouseholdLine = { name; profileId; rating; openAlerts; isGift }`.

- [ ] Write failing tests:
  - Pedro's tokens no longer contain his member's phone. The member's own profile does.
  - Searching the member's name + phone returns only the member, and their result carries `households: [{ name:'Pedro…', rating:1 }]`.
  - The scan never pairs two housemates.
  - API exact mode on the member's phone → `found` on the member's profile.
- [ ] Implement; run vitest + tsc. Add a ledger note: after deploy, Admin → Duplicates → Scan Now (v8 re-tokenize).
- [ ] Commit.

### Task 6: Merge and undo

**Files:**
- Modify: `src/lib/adopterMerge.ts` (memberships re-point to the survivor; collapse a duplicate pair in the same household; drop a self-membership; corrections re-point; all recorded in the undo payload; `unmergeAdopters` restores).
- Remove the merge's use of `household_members` / `household_links` once Task 6 has converted the data. Keep reading the old undo payload shape for audits written before.

- [ ] Write failing tests:
  - Merge Marta into Marta-duplicate when both are in Pedro's household → one membership.
  - Merge a member into its host → no self-membership.
  - Undo of each restores the exact rows.
  - Undo of a pre-conversion audit (old payload) still works.
  - A merge bringing a corrected person back → admins notified.
- [ ] Implement; run vitest + tsc.
- [ ] Commit.

### Task 7: Conversion of existing data

**Files:**
- Create: `src/lib/householdConversion.ts` (+ test); an admin-only API route `src/app/api/admin/households/convert/route.ts` (`POST ?dryRun=1`) that returns a per-member report.

**Interfaces:**
- `convertInlineHouseholds(db, { dryRun: boolean, actor: string }): Promise<{ hosts: number; members: number; createdProfiles: number; reusedProfiles: number; grantsCopied: number; skipped: Array<{ hostId; memberId; reason }> }>`. Idempotent.
  - Each inline member and each `household_links` row is converted once, keyed by `source_key` (`inline:{hostId}:{memberId}` / `link:{linkId}`).
- `ensureHostConverted(db, hostId, actor): Promise<void>`: the same conversion for one host. `getHouseholdsFor` calls it inline (logged, never throwing to the page) whenever the host's JSON holds a member with no converted `source_key`. So the profile is right from the first view after deploy, and a member an old tab writes later is picked up on the next view. The admin route is the bulk run (with dry-run report) Jon approves for production.
  - Linked members reuse their `profileId`. `household_link_corrections` → `household_corrections`.
  - Grants: every live grant on the host whose `entry_ref` matches a moved contact, and every `all_contact` grant on the host, is copied to the member profile. `is_public` is copied.
  - Then the JSON column is left as is, and nothing writes it again.

- [ ] Write failing tests using fixtures that mirror production shapes (24 unknown, 4 partner, 1 child; 3 members with contacts; one host public; one host with an `all_contact` grant; one with an `entry` grant):
  - The counts are right.
  - Visibility per viewer is identical before and after (Review Focus 1).
  - A second run changes nothing.
  - A member added to the JSON after the first run is converted by the second (Review Focus 2).
  - A dry run writes nothing.
- [ ] Implement; run vitest + tsc.
- [ ] Commit.

### Task 8: Profile UI, add-person flow, cleanup, e2e

**Files:**
- Modify:
  - `src/components/AdopterForm.tsx`, `src/components/HouseholdSection.tsx` (rewritten on `HouseholdView[]`, matching the prototype states):
    - one block per household; «Hogar con …» titles only when a person is in 2+ homes;
    - member card: the name is the profile link, a «⋯» menu with «Editar» / «Quitar del hogar» / «Eliminar perfil de X» or «Pedir eliminación» (today's delete rules: `deleteOwnAdopter` / `requestAdopterDeletion` / admin);
    - Q1 dialog with the 'mistake' / 'not_living' reasons;
    - the «Editar» form (E1);
    - minors tag;
    - gift block (P4/P5).
  - `src/components/LinkedProfileSummary.tsx`
  - `src/app/adopter/[id]/page.tsx`
  - the add form (name, relationship, age, contacts, then «¿Es este perfil?» from `getHouseholdMatchCandidates`)
  - remove/«No convive» on each card
  - preview-as-stranger
  - i18n es/en/pt
- Remove: the old household JSON actions and their wrappers; `household_members` writes everywhere (grep must return only the conversion and read-old-audit code).
- Tests:
  - update `tests/household-contrib.user.spec.ts`, `tests/one-reality.authed.spec.ts`, `tests/record-edit-collab.authed.spec.ts`, `tests/household-legacy.authed.spec.ts`, `tests/form-results-link*.spec.ts`
  - new `tests/households.user.spec.ts`

- [ ] E2E (locale-agnostic testids, own fixtures):
  - A non-owner adds «Marta Paez» with a phone to Pedro's household → Marta's profile exists, is searchable, and shows «Convive con Pedro».
  - Adding a person whose phone matches an existing profile offers «¿Es este perfil?»; choosing it links that profile.
  - Searching the member's phone shows only the member's card, with Pedro's rating line.
  - «No convive» removes the person from the household on every profile.
  - At 390px there's no horizontal scroll.
- [ ] Run vitest, tsc, lint (≤125), build, action surface, and the e2e specs above locally (Node 20; restore seed DBs after).
- [ ] Commit.
