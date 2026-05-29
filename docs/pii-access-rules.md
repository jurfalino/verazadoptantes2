# How contact-info protection works

> Audience: rescuers using BuenAdoptante, plus product/support folks who need
> to explain the system. Written in plain language with the exact matching
> rules where they matter. Engineering reference is `src/lib/piiAccess.ts`.

## Why this exists

BuenAdoptante is a vetting tool — its job is to help rescuers share what they
know about adopters so animals don't go to bad homes. The notes, observations
and history are meant to be shared. The contact details (phone, email, social
handle, ID, address, family members) are different: they're the adopter's
personal information, and exposing them all to every logged-in rescuer is more
than the vetting work needs.

The principle: **you can see contact details you can demonstrably already
have, plus everything you can earn by approval. Nothing else.**

## Who sees what

For every adopter, every viewer falls into one of three tiers:

| Tier        | Who                                                | Sees                                                            |
|-------------|----------------------------------------------------|-----------------------------------------------------------------|
| **Full**    | The record's owner, any admin, anyone who edited it | Everything — no masking                                         |
| **Partial** | Any other authenticated rescuer                    | Notes always; family members hidden; each contact field either fully visible (because they earned access to it) or partially masked |
| **None**    | Unauthenticated visitors                           | Same masking shape; can search but can't open profiles          |

"Partial" is the new tier the gating creates. Before the change, every
authenticated rescuer saw everything.

## What "partially masked" looks like

The system never just hides values behind a black box. Each field has a
type-specific partial reveal that keeps enough shape to make the field
recognizable without exposing it:

| Type    | Example stored value     | What a non-privileged viewer sees |
|---------|--------------------------|-----------------------------------|
| Name    | `Maria García Lopez`     | `M G L` (initials of unmatched tokens; matched tokens shown in full) |
| Phone   | `11 2345-6789`           | `11 23••-••••` (first 4 digits + separators) |
| Email   | `juan@gmail.com`         | `j•••@gmail.com` (first letter + domain)     |
| Social  | `@juanperez`             | `@j••••••`                                   |
| Address | `Peru 999, San Isidro, 3680` | `…, San Isidro` (last comma-separated locality only) |
| ID      | `30123456`               | `••••••` (fully masked)                       |

## Three ways a viewer can earn full access to a field

### 1. Search match

If you search by a contact value and a record matches, you've just demonstrated
you knew that value. That **specific field** unlocks permanently for your
account. Other fields on that record stay masked.

This is the most common path. Searching is the same act as proving knowledge.

### 2. Verify what you know — on the profile

If you opened a masked profile and you happen to know more, type any extra
detail into the **"Type another detail you know" input** at the top of the
banner. If it matches, that field unlocks for you, permanently.

The input has a second purpose: **identity verification**. If you're not sure
the masked record is the person you have in mind, type something you know and
see whether it matches. A match confirms it's the right person *and* unlocks
that field; no match means stop, this isn't them.

### 3. Request access

You don't know any other details and you genuinely need to reach the person.
Click **"Request access"**, optionally explain why. The record's owner (and
editors) get a notification; admins see it in their dashboard. If approved,
**the whole record's contact info** unlocks for you, permanently.

A denied request triggers a 14-day cooldown before you can re-request the
same record. Requests left pending more than 7 days escalate to admins.

## The matching rules — precisely

The system never unlocks a field just because your query happens to contain a
substring of it. Each field type has a **confidence rule** for what counts as
"you really know this value" — a search needs to clear that bar to unlock.

The bar exists to block fan-grants: a query like `"ana"` would substring-match
hundreds of unrelated handles and addresses, and we don't want one search to
silently unlock dozens of unrelated adopters' contact info. The rules give
each field a cheap shape-check so an evidence-shaped query unlocks but a
guess-shaped one doesn't.

### Phone

- The query must contain a **digit run of at least 6 digits** that appears
  inside the entry's digits.
- Formatting is ignored: `"+54 11 2345-6789"`, `"2345-6789"` and
  `"1123456789"` all reach the same entry digits.

### Email

- The query must contain `@` and be at least 6 characters long.
- The query (lowercase) must be a substring of the entry value.
- Why `@`: distinguishes "I'm typing an email I know" from "I happen to be
  typing a name that's also a substring of someone's email handle."

### Social

- The query must **start with `@`** (e.g. `"@juanperez"`) or be a URL
  (`"https://instagram.com/juanperez"`), and be at least 4 characters.
- The query (lowercase) must be a substring of the entry value.
- Why the `@`: same reason as email. Bare `"juan"` would coincide with
  `@juanperez`, `@juanita`, `@buenosaires_juan`, etc., and fan-grant social
  handles across many adopters.

### ID

- The full normalized ID (digits-only) must appear inside the query's digits.
- Minimum 6 digits — shorter IDs can't anchor on their own.
- Formatting is ignored: query `"30.123.456"` reaches entry `"30123456"`.
- No typo tolerance for IDs — a single-digit difference coincides with
  another valid ID, so we can't tell a typo from a guess.

### Address — the comma-tokenized rule

This is the most nuanced one because addresses are structured values, not flat
strings. The stored address is split by commas; each part is classified, and
the parts work together as evidence.

**Classification:**
- **Specific part** — contains a digit *and* at least 2 letters *and* is at
  least 5 characters long. Captures things like `"Peru 999"`,
  `"Av. Corrientes 3444"`, `"Mendoza 1234"`. A single specific match anchors
  on its own.
- **Loose part** — anything else: locality (`"San Isidro"`), neighborhood
  (`"Palermo"`), city (`"CABA"`), postal code (`"3680"`), apartment number
  (`"5B"`). One loose match is **not enough** — at least **two loose parts**
  must match together for the combination to count as evidence.

**Typo tolerance:**
- Loose parts allow Lev-1 (one-character) typos — `"Sprigfield"` still matches
  `"Springfield"`. Useful for misspelt locality names.
- Specific parts require exact match. Typo tolerance on a street number
  (`"Peru 998"` matching `"Peru 999"`) would let you fish neighboring doors,
  so we don't allow it.

**Worked examples** — stored `"Peru 999, San Isidro, 3680"`:

| Query                 | Result                                                          |
|-----------------------|------------------------------------------------------------------|
| `"Peru 999"`          | ✅ Unlocks — specific part matches                              |
| `"San Isidro"`        | ⛔ Doesn't unlock — only one loose part                         |
| `"3680"`              | ⛔ Doesn't unlock — only one loose part                         |
| `"San Isidro 3680"`   | ✅ Unlocks — two loose parts together                            |
| `"Peru 999, Palermo"` | ✅ Unlocks — specific part matches                              |
| `"Peru 998"`          | ⛔ Doesn't unlock — specific part requires exact match           |
| `"CABA"`              | ⛔ Doesn't unlock — one loose part                              |

### The combined-query bonus — "fragment ride-along"

If one of your query pieces clears the bar for *any* field on a record (the
record is "anchored"), then any **other** fragment in the same query that
substring-matches an address or ID on that same record also unlocks.

This lets `"1123456789 Corrientes"` unlock both the phone *and* the address
fragment, even though `"Corrientes"` alone wouldn't be enough on its own. The
phone match is the evidence that you mean *this* person; the address comes
along for the ride.

This bonus only applies on the same record (no cross-adopter fan-out) and
only to address/ID (notes still never auto-unlock).

## What never auto-unlocks

- **Notes (`other` type free text)** — these are vetting content; they're
  visible to authenticated viewers without any unlock mechanic, but they
  don't act as a key for other fields either.
- **Family members** — always hidden from non-privileged viewers, with no
  partial reveal. They're PII and they're not search-matchable.

## Account-scoped, not device-scoped

Unlocks follow your account, not your browser. Earn a field on your phone,
log into your laptop with the same account, the field's still unlocked.
Different account on the same device → not unlocked.

If the owner edits a value you previously unlocked (e.g. they update a
phone), your old grant no longer matches the new value — the field re-masks
until you re-prove you know the new one. Intended: the grant proves you knew
*that* value, not "this person."

If an admin revokes your access, it's gone everywhere immediately. You can't
"un-see" what you saw, but you can't see new data.

## Practical playbook

**I have a phone but no name.**
Search by the phone. The phone field unlocks on the matching record; name
shows initials; notes are readable; rest of contact is masked. Decide
whether to log an activity or request access.

**I have a name only.**
Search by the name. Matching name tokens unlock; contact stays masked. You
can read notes and decide next steps.

**I have a full address.**
Search by it. If the address parses into a specific part (street + number)
or you typed enough loose parts together, the address unlocks; rest stays
masked.

**I have a DNI / ID number.**
Search by it (with or without dots). If it's at least 6 digits, the ID
unlocks; rest stays masked.

**I have a social handle.**
Type it with the `@` prefix. Without the `@` it won't unlock.

**I'm on a masked profile and want to check if it's the right person.**
Use the "Type another detail you know" input. Any detail that matches
confirms identity *and* unlocks. If nothing matches, it's probably not
the person you had in mind.

**I have nothing else and need to contact them.**
Use "Request access." Owner or admin approves; whole record unlocks.

**Why isn't there a way to unlock by typing just a neighborhood?**
By design — a neighborhood matches hundreds of unrelated adopters, so a
single bare-locality search would fan-unlock far beyond who you actually
meant. Add another piece of info (street number, postal code, anything
specific) and the combined query unlocks.

## What rescuers, owners, and admins should expect

- **As a rescuer (partial tier)** — your search is your evidence. The system
  rewards combined queries (more pieces typed = more unlocked, with the
  cross-checks above). The verify input on a profile is the relief valve when
  search alone doesn't get you there.
- **As an owner (full tier)** — your records are never masked to you. You see
  who has access to your records' contact info, and you can approve, deny, or
  revoke. You also see request notifications.
- **As an admin** — same as owner, on every record. You also see the queue of
  pending requests in the admin dashboard, including any that have been
  pending more than 7 days (escalated for resolution).

## What the system never does

- Reveal a field because the query happened to contain a coincidental
  substring of it (no fan-grants).
- Reveal a field because you logged an activity on the record (logging is
  open; access is separate).
- Reveal anything to unauthenticated visitors beyond the partial-reveal shape
  shared with the rest of the partial tier.
- Allow you to edit a record so you can become an "editor" and gain access
  (core-record edits are owner+admin only).
- Send your raw search query anywhere it isn't needed for the lookup.

## Where the rules live (engineering reference)

| Concern                              | File                                          |
|--------------------------------------|-----------------------------------------------|
| Visibility tiers, partial-reveal     | `src/lib/piiAccess.ts`                        |
| Anchor / matcher rules               | `matchSearchEntries` in `src/lib/piiAccess.ts`|
| Grant writes during search           | `src/app/actions/findAdopters.ts`             |
| Verify-known-info action             | `verifyKnownInfo` in `src/app/actions/piiAccess.ts` |
| Request workflow                     | `src/app/actions/piiAccess.ts`                |
| DB tables                            | `pii_access_grants`, `pii_access_requests` in `src/db/schema.ts` |
| Feature flag                         | `ENABLE_PII_ACCESS_GATING` in `src/config/features.ts` |
