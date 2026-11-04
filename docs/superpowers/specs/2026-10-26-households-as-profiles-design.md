# Households as links between profiles — design

Date: 2026-10-26 · Product: Jon · Builds on D44–D55 (`2026-10-25-pendientes-d-design.md`) and the **one shared reality** principle.

## Why

Today a household member exists in two shapes: an entry inside the host's `household_members` JSON (name, relationship, age, its own contacts, `addedBy`), and, for "linked" members, that same entry plus a `profileId` and a mirror row in `household_links`. Every feature has to handle both shapes. Most of the 2.57.x bugs came from that: link and JSON drifting apart, contacts stored in two places, special cases in merge, undo, privacy, credit and permissions. Jon asked whether a senior EM would agree with the model. The answer was no, and Jon decided:

- **A person added only as someone's household member shows up in search like any profile** (Jon, stated twice).
- Every person is a profile; a household is links between profiles.

Production on 2026-10-26: 19 profiles with a household, 29 members (3 with contacts, 0 linked; 24 relationship «unknown», 4 partner, 1 child; no nameless members, none with age). There are also 18 profiles with legacy free-text family notes. Converting now is cheap.

## Goals

1. **One shape for a person.** Anyone named in a household is an adopter profile: searchable, mergeable, rateable, flaggable, with contacts stored once on that profile.
2. **One record of the fact.** "X lives with Y" is stored once, credited («según …»), shown the same to everyone (masking aside).
3. **Households stay visible where a person appears.** A person's card, in search and in «¿Es este perfil?», shows who they live with and how those people are rated.
4. **Nothing lost.** Every existing member, contact, credit and history line survives the conversion, and undoing a merge still restores households.

## Non-goals

- Legacy free-text family notes (`family_members`): they stay as notes and are not converted. Converting them was tried on real data and rejected on 2026-09-19.
- Address-based households (grouping by shared address): out of scope.
- New UI beyond what the model change needs. The household card keeps today's look: member cards with the live summary (D46), contacts, «Agregar dato de contacto», «Ver perfil completo», «No convive».

## Anti-goals (a failure even if it "works")

- Two versions of a fact for two users (forking reality).
- A rescuer seeing more contact data than before. Converting someone's inline member into a profile must not unmask anything.
- Duplicate detection flagging every household member as a duplicate of the person they live with.

## The model

### Households are groups (decided by Claude, flagged for Jon)
A **household** is a group of profiles who live together. Membership is many-to-many: **a profile can be in more than one household (Jon: no restriction)**, for example a child of separated parents. Each household shows as its own block on the profile, with its own «Agregar familiar / conviviente». Picking an existing profile who already lives elsewhere adds them to this household too; nothing is merged or moved, and the other household's teams are told (Claude's call).

- `households(id, created_by, created_at)`
- `household_memberships(id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at)` (age lives on the profile: `adopters.age`, `age_as_of`, `is_minor`). Unique `(household_id, adopter_id)`.

The relationship is relative to the person they were added next to, e.g. «pareja de Pedro», «hijo de Pedro». On Pedro's profile Marta shows as «Marta · pareja». On Lucas's profile she shows as «Marta · pareja de Pedro», and Pedro (the person relationships point at) shows with no label. No reverse labels (gender isn't recorded). `unknown` is allowed, and is most of today's data. (Claude's call.)

With a group, adding Marta and Lucas from Pedro's profile shows all three on each other's profiles. Pairwise links (today's `household_links`) would show Marta only Pedro.

### Gift recipient (Jon, 2026-10-27)
The form can't tell whose name and phone it gave (the recipient's or the requester's), so **no profile is created automatically**. The giver's profile shows «Destinatario del regalo (según el formulario)» with the name and phone exactly as the form gave them, kept with the giver's record: searching that phone finds the giver, as today. A rescuer who confirms who the recipient is can press «Crear perfil de {nombre}», which creates the profile (owner = the giver's owner, data credited to the form) and puts it in a gift household with the giver, never under «Convive con».

### Who owns the profile a household add creates (decided by Claude, after the builder check)
**The host's owner** (the owner of the profile the person was added from), with the person who typed it credited on the membership and on every contact (`addedBy`), and given entry grants as contributors get today (D54). This keeps today's reality: the host's team sees and answers for what is written about the household, an outside contributor sees only what they typed. From an adoption form, the form's owner (today's behaviour).

### Privacy carried over (decided by Claude)
Going forward each person's contacts follow their own profile (owner, team, grants). At the migration nobody loses or gains sight: each new member profile copies the host's `is_public`, and every grant that unlocked the host's contacts (`all_contact` and `entry`) is copied to the member profiles it covered.

### Adding someone to a household
Anyone signed in can do it (D54). Fields: name, relationship, age, contacts. **The profile rule applies (Jon): a name or at least one contact detail** (`hasMinimumIdentifier`); a relationship alone isn't enough. Before saving, the existing duplicate check runs (as on «Nuevo adoptante»):
- **A likely match** → «¿Es este perfil?» Choosing it links the existing profile, and the contacts typed are added to it through `addContactEntry` (credited, grants, no double copies).
- **No match, or "no, es otra persona"** → a new profile owned by the host's owner (see «Who owns…»), with the contacts on it credited to the adder. Then the membership.

Credit, history and notices are the same as today's contribution model (D54). The membership row records `added_by`.

### Removing / correcting
- **«No convive»** (D48) removes that person's membership from that household, for everyone. History goes on the affected profiles and the household's other teams are notified. If the same pair is linked again after a correction, admins are notified (dispute), as today.
- **Editing (Jon, 2026-10-27, revised):** «⋯» → «Editar» opens one form, the same for everyone signed in: name, age, «Es menor de edad» and relationship.
  - **Names and ages of ANY profile** (not only household members) can be changed by anyone signed in. The owner's team is notified immediately, in-app and by email (category «Cambios en tus perfiles», respecting each person's email switches), with «Deshacer».
  - **Safeguards:** the previous name is kept automatically as an alias («Conocido/a como», a name token), so search still finds it. «Deshacer» (owner's team or admin, from the notice or the history) restores the name and also keeps the reverted one as an alias. Every change is credited and goes into the history; history kind follows `profilePrivilege` (a stranger's change is a 'contribution'). Concurrent edits use the existing conflict check («alguien cambió este dato mientras lo editabas»).
  - **Relationship:** editable by anyone signed in, with the same notice to the household's teams.
- **Age lives on the profile (Jon, 2026-10-27):** new adopter columns `age` + `age_as_of`. The age goes up by itself as today (`currentAge`) and shows on the person's own profile too. The membership no longer has its own age.
- **Children (Jon, 2026-10-27):** a minor is a profile marked «Menor de edad». Minor means current age under 18, or the «Es menor de edad» checkbox (`is_minor`). The checkbox is always visible and turns on by itself when the age entered is under 18. Such a profile is searchable (so the family is found) and shows the tag. It gets **no rating, no alerts and no adoption records**: those go on the adults. The «¿Qué pasó con …?» actions and rating controls are hidden on it. At 18 (by age) the tag drops and it becomes a normal profile.
  - **Superseded (Jon, 2026-10-28):** «Menor de edad» is an informational marker only — "the intention is just to still be able to capture when a person is minor if the user doesn't know the exact age.. priority is to keep usability as simple as possible ALWAYS". A minor is rated, recorded (every record type) and flagged like anyone else, is picked in the adoption picker and the post import like anyone else, and merges like any profile; marking a profile that has records or alerts as a minor is allowed. Kept: the `is_minor` column, the «Es menor de edad» box (auto-on under 18 by age) and the «Menor de edad» tag in the rating slot, before the rating. No migration; `is_minor` stays as data.
- **Member card (Jon, 2026-10-27):** the person's name is the link to their profile (no «Ver perfil completo» row). A «⋯» menu next to the name holds «Editar», «Quitar del hogar» and «Eliminar perfil de {nombre}» / «Pedir eliminación».
  - **«Quitar del hogar»** asks why. «Lo cargué por error» removes the membership with no record. «No vive acá» is «No convive»: it writes a correction, and a re-add is a dispute.
  - **«Eliminar perfil»** follows today's deletion rules exactly. The owner can delete only when nobody else contributed (no one else's records, photos, edits or contacts, no alerts, no linked forms). Otherwise the owner gets «Pedir eliminación» (admins decide; it goes to the Papelera, restorable). Admins can always delete. Nobody else sees it.
- **Who may remove a membership:** whoever added it; the team (owner, org-mates) of any profile in that household; admins and moderators. Others get «No convive» only through the dispute path.

### Search and duplicate detection (Jon, 2026-10-26)
- **Search returns the people who match, nothing else (Jon).** Searching the son's name and a phone registered only on the son shows **only the son's card**. Pedro gets no card of his own from that search. The son's card carries his household like any profile («Convive con Pedro» with Pedro's live rating and alerts, D46), so a dangerous relative is visible on the card. That line is Claude's reading.
- **Tokens:** each profile tokenizes only itself (name, aliases, contacts). A host's tokens no longer include its members'. Aliases («Conocido/a como») stay name tokens of their own profile.
- **Duplicate detection** never pairs two profiles in the same household («alguien de su hogar» is already a recorded answer). The «¿Es este perfil?» card on «Nuevo adoptante» and on adding a household member shows the candidate's household line, so a relative of a flagged person is recognised before saving.

### Privacy
Each person's contacts follow their own profile's protection and grants. A household card shows each member's live summary exactly as the viewer would see that profile (D46). It never shows more.

Converting an existing inline member: their contacts move to the new profile together with the grants that already unlocked them. Anyone who could see a contact on the host's member before can still see it on the new profile, and nobody else.

### Merges and undo
- Merging two profiles moves the absorbed profile's memberships to the survivor. If the survivor is already in that household, the two collapse into one membership. Undo restores them, through the existing audit payload.
- Merging two profiles that are in the same household removes the self-membership.

### When nobody can answer «¿Es este perfil?» (Jon, 2026-10-26)
Forms, imports (sheet, social) and the API use **the same matching as the API's exact mode** (`findIdentifierHits` + `decideExactOutcome`, src/lib/api/search.ts, src/domain/apiExactMatch.ts). If the person's name fits AND an identifier matches exactly one consistent profile, that **existing profile is used**. The identifiers are exactly the API's (`findIdentifierHits`): **phone, email, ID number**. Addresses and social profiles are not used by the API today, so they aren't used here either; adding them later changes both at once (Jon: «whatever we do, should be the same as the API»; social handles from post imports can belong to the reporter) («Marta Paez» with the same phone → the existing Marta joins the household). Anything ambiguous creates a new profile, and the normal duplicate scan sends any likely match to «Pendientes de revisar». Re-sending the same form never creates the person twice. Exact mode's `nameMatchedAs: 'household_member'` becomes an ordinary profile match.

### «No convive» memory (decided by Claude)
A correction is stored per (household, person). Re-adding that person to that household, or a merge that brings them back into it, is a dispute: admins are notified (as D48).

### API, forms, interview, importer
- Adoption form: named household people → profiles plus memberships (owner = the form's owner). A gift recipient → profile plus a gift membership.
- Interview additions → the same add path (duplicate check skipped, matching by name within that household as today).
- Post importer / `POST /api/adopters`: the `householdMembers` input stays accepted for compatibility and is converted by the same function.
- API v1 `householdNames` keeps its shape, read from memberships.

## Migration

One-time and idempotent. For each of the 29 inline members:
1. Create the member profile (owner = the host's owner, as in «Who owns the profile a household add creates»; the member's `addedBy` is credited on the membership and contacts), carrying name, contacts (with their `addedBy`), relationship, age.
2. Create the household with the host and the member.
3. Move the grants that pointed at those contact values on the host to the new profile.
4. Run the normal duplicate check. Matches go to «Pendientes de revisar» like any new profile.

Each profile also converts itself the first time it is viewed after the release, so nothing looks empty before the bulk run, and anything an old tab writes in the old shape is picked up on the next view. Dry-run on a copy of production first, with a per-member report. It is applied by the deploy pipeline; Jon approves the production run.

`household_members` stays readable, but nothing writes it after the release. It's dropped in a later release once the data has been verified. `household_links` and `household_link_corrections` are migrated into memberships and corrections, then retired.

## Rollout

Behind the existing flag `ENABLE_HOUSEHOLD_MEMBERS`. Staging first: Jon checks Pedro/Jonathan/Marta flows, search by a relative's name, and the form flow. Then production after an independent review (security-adjacent: PII, grants, approvers).

## Left to the builder

Table and column names; how the search join stays cheap on D1 (no `IN(array)`); the exact migration mechanism (SQL plus a script, or a one-off admin action); test plan; whether «¿Es este perfil?» reuses the «Nuevo adoptante» component directly.

## Addendum 2026-10-27 — compact household section (Jon, after staging review of 2.58.0)
Jon: the section took too much space and buried «Actividad»; «Hogar con …» titles were unnecessary; «0 adopciones · 0 registros» didn't count transits; «Vos agregaste a esta persona» + «Perfil cargado por …» contradicted each other. Three variants were prototyped (branch prototype/households-compact, screenshots in proto-shots/households-compact/); **Jon chose A «compact rows»**:
- One dense row per person: avatar initial, name (link to their profile), rating + alerts / «Menor de edad» tag, the person's activity counted exactly like that person's «Actividad» summary (incl. transits, returns), «⋯» menu (unchanged items).
- Second line: relationship (· age) · ONE attribution («agregado por vos» or «según {who added them}») · contacts collapsed behind «N datos ▾» (lock icon when some are protected); «Perfil cargado por …» is gone from household rows.
- No «Hogar con …» titles; a second home appears only when the person lives in 2+ homes, as a small divider; «+ Agregar» is a slim text button and asks «¿En qué hogar?» only with 2+ homes.
- Gift recipient block, «¿Es este perfil?», «Editar» and dialogs unchanged in behaviour.
