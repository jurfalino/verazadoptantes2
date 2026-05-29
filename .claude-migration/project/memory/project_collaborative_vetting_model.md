---
name: collaborative-vetting-model
description: "Authority model: adds are open, mutations are gated. Any authenticated user can add activities, contact entries, aliases; only owner+admin can rename, edit or remove existing data. PII gating restricts exposure, not contribution."
metadata: 
  node_type: memory
  type: project
  originSessionId: 66eb7fda-6152-4780-91e1-fd5105f5fd1a
---

BuenAdoptante is a **collaborative vetting platform**. The user who first
creates an adopter profile is the first contributor; they have no special
authority over the profile beyond that. Other authenticated rescuers
contribute equally.

**The crisp principle: adds are open, mutations are gated — and each
contributor owns the entries they themselves added.**

- **Adds** (open to any authenticated user): activity records, contact
  entries of any type (phone, email, social, id, address, alias, other),
  flags. Append-only paths that preserve other contributors' data.
- **Mutations** (owner + admin + the original contributor of *that
  specific entry*): renaming the profile, editing or removing existing
  contact entries, editing family members / notes / address-as-non-entry.
  Record-wide mutations are owner+admin only; per-contact-entry edit /
  remove also allows the original contributor (v2.16.0-9). Entries with
  no `addedBy` field (legacy / blob-migrated / pre-2.16.0-9 contributions)
  stay owner+admin-only.

**The only thing PII gating restricts is exposure**, not contribution. A
viewer who has never seen an adopter's phone can still *add* a phone they
learned through other channels; they just can't *see* phones they haven't
demonstrably already known.

**Why:** the platform's mission is collective truth about adopters — if only
the original creator could update contact info, the vetting signal would
degrade the moment that user moves on. But unrestricted *mutation* would let
one contributor destroy another's record. The split (open adds + gated
mutations) preserves both collaboration and signal integrity.

**The same-phone-different-name scenario (2026-05-28).** User B is contacted
by someone using a different name with the same phone as User A's profile.
B's options:
1. Log an activity describing the interaction (open path).
2. Add an `'alias'` contact entry for the alternate name (open path) —
   becomes searchable; the discrepancy itself is vetting signal.
3. Flag the record for admin review if B suspects fraud.

B **cannot** rename the profile or edit A's existing entries. Mutations are
gated; the alternate identity is recorded additively, not destructively.

**How to apply:**

- **Don't propose owner-approval queues for additive contributions.** "User
  adds → owner reviews → maybe accepts" is the wrong default. The default is
  "user adds → it lands → owner gets a heads-up notification + can act
  later" (revert/cleanup is a mutation, owner-gated).
- **Contributor-added contact entries are first-class search-match anchors.**
  They don't carry a `confirmed`/`unverified` bit — gating them from the
  matcher would defeat the collaborative point.
- **Edit/remove must check the gate every time.** New server actions for
  mutating existing data must enforce `addedBy === actor || isAdmin`. The
  "editor" tier as a separate concept collapses to owner ∪ admins once
  `saveAdopter` is gated, because `kind='edit'` history rows only come from
  owner+admin from that point forward.
- **Adding an alias is the answer to "I know this person by a different
  name."** Don't propose renaming, don't propose merge, don't propose a new
  profile — `'alias'` contact-entry type is the canonical surface.
- **Contributing PII grants the contributor entry-scope visibility on
  that entry** (`pii_access_grants.origin='contribution'`), same model as
  `search_match` grants. Aliases are not PII — `addContactEntry` skips the
  grant insert for `type='alias'`.

**Current state of saveAdopter ACL (verify before relying):** the existing
gate was understood to be in place but a 2026-05-28 review found it loose.
Plan `.agents/plans/2026-05-27-unified-per-entry-contact-section.md`
includes the tightening as part of the unified-contact refactor. If touching
saveAdopter or any new mutation path, confirm the gate is present.

Related: [[pii-address-deserialize-tests-pending]], the v2 PII plan
(`.agents/plans/pii-access-gating.md` if it exists), and the planned
unified-contact refactor at
`.agents/plans/2026-05-27-unified-per-entry-contact-section.md`.
