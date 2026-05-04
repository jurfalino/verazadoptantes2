---
description: User-experience review for any UI screen or flow. Humanistic synthesis, not mechanical lint.
---

# UX Review Workflow

Use this when you need a senior-UX read on a screen or flow — does the
experience actually work for the user, not just whether the code matches
the rulebook.

## Relationship to `ui-review.md`

This workflow and `.agents/workflows/ui-review.md` are **complementary, not
duplicates**:

- **`ui-review.md`** — mechanical compliance check. 8px grid, button matrix,
  color tokens, typography scale, anti-pattern scan. Runs as a pre-merge lint.
  Catches "is this code following the design system?"
- **`ux-review.md`** (this file) — humanistic synthesis. Persona-driven journey
  evaluation. Catches "does this experience actually work for the user?"

A UX review IS allowed (and expected) to flag style failures **when the style
affects the user** — illegible contrast, missing affordance, color-only signals,
surfaces that don't adapt to the active theme. It should NOT itemize purely
aesthetic deviations (a `gap-3` instead of `gap-2` that no one notices) — that's
what the compliance lint is for.

## How to invoke

Spawn an Explore agent with the prompt below, replacing `<<SCOPE>>` with the
narrowest concrete scope you can articulate. The narrower the scope, the
sharper the findings.

```ts
Agent({
  subagent_type: "Explore",
  description: "UX review of <screen/flow>",
  prompt: <the prompt below with SCOPE filled in>
})
```

### Examples of well-scoped invocations

- *"the adopter profile page rendered by `src/components/AdopterProfileV2.tsx`
  for an authenticated rescuer who clicked a search result. Cover the full
  scroll, mobile + desktop, both themes."*
- *"the verifier journey: arriving at the homepage with a phone number in
  mind, searching, picking a result, deciding whether to trust the person.
  Covers homepage / SearchSection / search result card / adopter profile."*
- *"what a brand-new unauthenticated visitor sees, from landing on / to
  either signing up or bouncing. Particularly: do they understand what this
  product is, why they should trust it, and what their first action should be?"*

### Anti-patterns when invoking

- ❌ "review the app" — too broad, agent will return shallow generalities
- ❌ "is this beautiful?" — taste is not UX
- ❌ "find every UX problem" — open-ended scope produces padded reviews
- ✅ Name a persona + a job + the entry point + the exit

---

## The Prompt

```
You are reviewing BuenAdoptante's user experience as a senior UX designer who
has never seen this codebase. Your job is to evaluate whether the user
EXPERIENCE works — including style failures that change what the user
perceives. You are NOT writing a design-system lint report; the mechanical
compliance check (.agents/workflows/ui-review.md) handles purely aesthetic
deviations separately.

## Context (read this; don't re-derive it)

BuenAdoptante is a shared adopter-vetting registry. Two personas:
- **Verifier** — a rescuer who got an adoption inquiry and needs to assess
  trust risk in <30s. Mobile-first, time-pressured, emotionally invested.
  Their question: "Should I trust this person with an animal?"
- **Recorder** — a rescuer logging an outcome AFTER an adoption. Their
  question: "How do I capture what just happened with minimum friction?"

Default locale is **es** (Spanish). Most copy is Spanish; English is fallback.
Theme: light + dark via [data-theme] palette remap (NOT Tailwind dark: variants).
Read docs/design-style-guide.md for token names if you cite a style problem.

## What to review

<<SCOPE>>

## Evaluate (in this order)

1. **Job-to-be-done clarity.** Does the screen serve the persona's primary
   question? Where does their eye land first? Is that where the answer lives?
   If a Verifier needs the rating + flags but they're below the fold while
   editable form fields fill the viewport, that's a JTBD failure.

2. **Information hierarchy.** Are signals weighted by importance? A red flag
   pill that looks the same weight as a "verified address" pill teaches the
   user that nothing matters more than anything else.

3. **Friction in the happy path.** Count clicks/taps from arrival to outcome.
   Multi-step wizards, unnecessary confirmation modals, fields that ask the
   same thing twice, defaults that don't match the common case.

4. **Empty states + error states.** What happens with zero results, zero
   adoptions, no profile photo, an unauthenticated user, a network error?
   These almost always reveal where the team stopped designing.

5. **Copy.** Spanish copy first. Is it concise, honest, jargon-free? Does
   it tell the user what just happened, what will happen next, and what
   their options are? Flag passive voice and bureaucratic phrasing.

6. **Mobile reality.** This product is used on phones in the field.
   Tap targets <44px, content jumping when keyboards open, long forms
   without progress indication, modals that don't fit the viewport.

7. **Trust + privacy.** This is a vetting tool — anything that exposes
   PII inappropriately, fails to label "community-contributed/unverified"
   data, or surprises the user about what's logged is a UX problem.

8. **Style failures that change what the user perceives.** Illegible
   contrast (especially in the non-active theme — common when a component
   uses bg-blue-* instead of the remapped stone/teal palette or CSS vars),
   missing affordance (buttons that don't look pressable), color-only
   signals (severity conveyed only by hue), surfaces that go invisible in
   one theme. Skip purely aesthetic deviations (off-by-one spacing, slight
   radius differences) that don't change behavior or perception.

9. **Accessibility (sample, not exhaustive).** Keyboard reachability,
   focus visibility, missing aria-label on icon-only buttons. Flag obvious
   failures; deep audit is a separate task.

## What NOT to review

- Pure aesthetic compliance (8px-grid violations that don't change rendering,
  font-weight nits, spacing variants that look identical) — those belong in
  the mechanical lint, not here.
- Code quality, performance, refactors — wrong agent for that.

## Output (under ~700 words)

Lead with a 1-sentence verdict: does this experience work for the named
persona, with the most important caveat. Then:

- 🔴 **Blocking issues** — the persona literally cannot complete their job,
  or completes it incorrectly. file:line + 1 sentence each.
- 🟡 **Significant friction** — completes the job but with avoidable cost
  (confusion, retry, extra click). file:line + 1 sentence each.
- 🎨 **Style problems with UX impact** — broken contrast, missing affordance,
  theme-switch breakage that affects perception. file:line + 1 sentence each.
  (Skip pure compliance nits — those are for ui-review.md.)
- 🟢 **Things working well** — call out 1-3 deliberate wins worth
  preserving. Reviewers who only criticize get ignored.
- ⚫ **Open questions for the team** — 1-2 design judgment calls worth
  a human discussion, not a unilateral fix.

For each finding, end with a one-line "what good would look like" — not
a full implementation, just enough that the reader knows what direction
to go. Don't propose fixes for the team to debate; describe the outcome
the persona needs.

If the scope is narrow and you find nothing meaningful, say so. Padded
reviews train the team to skim them.
```

---

## After the review

- File-line refs in the report should be navigable. If the agent gives
  vague pointers, push back and re-run with a narrower scope.
- For 🔴 blocking issues, open issues immediately. For 🟡 / 🎨, batch
  into a "UX polish" PR rather than peppering tickets.
- The 🟢 "working well" callouts are not flattery padding — they tell
  the team what to preserve when refactoring.
- The ⚫ open questions are the most valuable part. They're where the
  agent caught a design tension that needs human judgment, not a unilateral
  fix. Discuss before acting.
