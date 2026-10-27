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
- `household_memberships(id, household_id, adopter_id, relationship, relative_to_adopter_id, age, age_as_of, gift_recipient, added_by, added_at)`. Unique `(household_id, adopter_id)`.

The relationship is relative to the person they were added next to, e.g. «pareja de Pedro», «hijo de Pedro». On Pedro's profile Marta shows as «Marta · pareja». On Lucas's profile she shows as «Marta · pareja de Pedro», and Pedro (the person relationships point at) shows with no label. No reverse labels (gender isn't recorded). `unknown` is allowed, and is most of today's data. (Claude's call.)

With a group, adding Marta and Lucas from Pedro's profile shows all three on each other's profiles. Pairwise links (today's `household_links`) would show Marta only Pedro.

### Gift recipient (decided by Claude, flagged for Jon)
The person the adopter gives the animal to (form flow, `giftRecipient`) does not live with the giver. They become a profile, because they are the actual future keeper and get vetted like anyone. The giver's profile shows them as «Destinatario del regalo», a membership with `gift_recipient = 1` in a household of its own with the giver. They are never shown under «Convive con».

### Who owns the profile a household add creates (decided by Claude, after the builder check)
**The host's owner** (the owner of the profile the person was added from), with the person who typed it credited on the membership and on every contact (`addedBy`), and given entry grants as contributors get today (D54). This keeps today's reality: the host's team sees and answers for what is written about the household, an outside contributor sees only what they typed. From an adoption form, the form's owner (today's behaviour).

### Privacy carried over (decided by Claude)
Going forward each person's contacts follow their own profile (owner, team, grants). At the migration nobody loses or gains sight: each new member profile copies the host's `is_public`, and every grant that unlocked the host's contacts (`all_contact` and `entry`) is copied to the member profiles it covered.

### Adding someone to a household
Anyone signed in can do it (D54). Fields: name, relationship, age, contacts. **The profile rule applies (Jon): a name or at least one contact detail** (`hasMinimumIdentifier`); a relationship alone isn't enough. Before saving, the existing duplicate check runs (as on «Nuevo adoptante»):
- **A likely match** → «¿Es este perfil?» Choosing it links the existing profile, and the contacts typed are added to it through `addContactEntry` (credited, grants, no double copies).
- **No match, or "no, es otra persona"** → a new profile owned by the adder, with the contacts on it. Then the membership.

Credit, history and notices are the same as today's contribution model (D54). The membership row records `added_by`.

### Removing / correcting
- **«No convive»** (D48) removes that person's membership from that household, for everyone. History goes on the affected profiles and the household's other teams are notified. If the same pair is linked again after a correction, admins are notified (dispute), as today.
- **Who may remove a membership:** whoever added it; the team (owner, org-mates) of any profile in that household; admins and moderators. Others get «No convive» only through the dispute path.

### Search and duplicate detection (Jon, 2026-10-26)
- **Search returns the people who match, nothing else (Jon).** Searching the son's name and a phone registered only on the son shows **only the son's card**. Pedro gets no card of his own from that search. The son's card carries his household like any profile («Convive con Pedro» with Pedro's live rating and alerts, D46), so a dangerous relative is visible on the card. That line is Claude's reading.
- **Tokens:** each profile tokenizes only itself (name, aliases, contacts). A host's tokens no longer include its members'. Aliases («Conocido/a como») stay name tokens of their own profile.
- **Duplicate detection** never pairs two profiles in the same household («alguien de su hogar» is already a recorded answer). The «¿Es este perfil?» card on «Nuevo adoptante» and on adding a household member shows the candidate's household line, so a relative of a flagged person is recognised before saving.

### Privacy carried over (decided by Claude)
Going forward each person's contacts follow their own profile (owner, team, grants). At the migration nobody loses or gains sight: each new member profile copies the host's `is_public`, and every grant that unlocked the host's contacts (`all_contact` and `entry`) is copied to the member profiles it covered.

### Adding someone to a household
Anyone signed in can do it (D54). Fields: name, relationship, age, contacts. **The profile rule applies (Jon): a name or at least one contact detail** (`hasMinimumIdentifier`); a relationship alone isn't enough. Before saving, the existing duplicate check runs (as on «Nuevo adoptante»):
- **A likely match** → «¿Es este perfil?» Choosing it links the existing profile, and the contacts typed are added to it through `addContactEntry` (credited, grants, no double copies).
- **No match, or "no, es otra persona"** → a new profile owned by the adder, with the contacts on it. Then the membership.

Credit, history and notices are the same as today's contribution model (D54). The membership row records `added_by`.

### Removing / correcting
- **«No convive»** (D48) removes that person's membership from that household, for everyone. History goes on the affected profiles and the household's other teams are notified. If the same pair is linked again after a correction, admins are notified (dispute), as today.
- **Who may remove a membership:** whoever added it; the team (owner, org-mates) of any profile in that household; admins and moderators. Others get «No convive» only through the dispute path.

### Search and duplicate detection (abuse detection)
- **Search:** a match on any profile also returns the households it belongs to. The result names the matched person and shows «Convive con Pedro (★1)». Searching a household member's name or phone still lands on the main person's record, as today.
- **Tokens:** today a host's tokens include its members' names and contacts. After the change, each profile tokenizes itself only. Household expansion happens at match time: candidate matches pull in the matched profile's household. Duplicate detection never pairs two profiles that share a household («alguien de su hogar» is already a recorded answer).
- **Pre-save check** on «Nuevo adoptante» and on adding a household member: a match against any household member shows that person's household in the «¿Es este perfil?» card, so an abuser's relative is recognised.

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
1. Create the member profile (owner = the member's `addedBy`, else the host's owner), carrying name, contacts (with their `addedBy`), relationship, age.
2. Create the household with the host and the member.
3. Move the grants that pointed at those contact values on the host to the new profile.
4. Run the normal duplicate check. Matches go to «Pendientes de revisar» like any new profile.

Each profile also converts itself the first time it is viewed after the release, so nothing looks empty before the bulk run, and anything an old tab writes in the old shape is picked up on the next view. Dry-run on a copy of production first, with a per-member report. It is applied by the deploy pipeline; Jon approves the production run.

`household_members` stays readable, but nothing writes it after the release. It's dropped in a later release once the data has been verified. `household_links` and `household_link_corrections` are migrated into memberships and corrections, then retired.

## Rollout

Behind the existing flag `ENABLE_HOUSEHOLD_MEMBERS`. Staging first: Jon checks Pedro/Jonathan/Marta flows, search by a relative's name, and the form flow. Then production after an independent review (security-adjacent: PII, grants, approvers).

## Left to the builder

Table and column names; how the search join stays cheap on D1 (no `IN(array)`); the exact migration mechanism (SQL plus a script, or a one-off admin action); test plan; whether «¿Es este perfil?» reuses the «Nuevo adoptante» component directly.
