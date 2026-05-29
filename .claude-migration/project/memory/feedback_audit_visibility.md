---
name: Audit identity is at-a-glance info on vetting screens, not metadata
description: On BuenAdoptante (a rescuer-vetting tool), the creator of a record and the source URL are high-signal trust info — keep them always visible, do not hide behind hover/···/popovers
type: feedback
originSessionId: f67b0d31-bbc2-47fc-b0c8-9785c546d8b5
---
When designing scannability on profile/activity screens, the impulse is to demote audit-trail metadata (who created a record, where it came from) into a `···` corner menu or hover-revealed popover. **For BuenAdoptante this is wrong.** The product is about deciding whether to trust an adopter; knowing *who recorded* a given adoption and *where the data was sourced* is core to that decision, not metadata.

**Why:** I tried to "clean up" the activity timeline in `v2.14.7-8` / `2.14.7-9` by tucking source URL + "Agregado por X" into a `···` popover. The user pushed back: "I think we want both the creator of the record and the source of the record to be visible at first glance." Reverted in `v2.14.7-10`.

**How to apply:**
- On vetting / risk-assessment screens (adopter profile, search results, flag details), keep `addedBy` and `sourceUrl` always visible — even if it costs a row of vertical space.
- Compact styling is fine (small text, hairline divider, muted color) — but always-rendered, not behind a tap.
- The "F" lever in scannability redesigns ("hide footer behind hover") does NOT apply to audit-identity fields. It still applies to truly tertiary metadata (timestamps that duplicate the date, internal IDs, etc.).
- When in doubt: ask "would a rescuer making a trust decision want this visible without an extra click?" If yes, keep it visible.
