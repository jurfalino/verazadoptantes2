---
name: Text-overflow audits need screen-level walkthroughs, not just grep
description: Pure grep-driven overflow audits miss JS-side truncation, deeply nested flex children without min-w-0, and small-grid-tile patterns. Walk each user-facing screen with long test data
type: feedback
originSessionId: f67b0d31-bbc2-47fc-b0c8-9785c546d8b5
---
When auditing the BuenAdoptante codebase for text overflow, grepping for `{adopter.name}`, `{user.email}`, `flex-1.*truncate`, etc. catches the obvious cases but **misses three categories**:

1. **JS-side truncation that's only applied to one half of a pair.** Example: `AdopterProfileV2.tsx:238` truncates `delta.from` to 30 chars in JS, but `delta.to` renders raw at line 241. No CSS pattern flags this.
2. **Deeply nested flex children that need `min-w-0`.** Example: `settings/page.tsx:144-178` — outer `flex`, inner `<div>` two levels deep wraps the value. Grepping `flex-1` doesn't reach into nested non-`flex-1` children.
3. **Small-grid-tile patterns** (e.g. `grid-cols-1 sm:grid-cols-3` with ~190px tile widths) where IANA timezones, full Argentine province names, etc. overflow.

**How to apply:** when the user asks for a text-overflow audit, don't rely solely on grep. Walk through each user-facing screen and stress-test with deliberately long values — 50-char names, 100-char emails, 30+ char timezones, multi-sentence notes. The screens worth always checking on this app: adopter profile (header + change log + activity), my-adopters list, contract-results / form-results pages, settings (geo tiles), notification dropdown, toasts, merge modal, wizards (adoption / report / import), admin screens (users, audit, query). The change-log's diff format (`from → to`) and the settings geo tiles are recurring miss-targets — visit them explicitly.
