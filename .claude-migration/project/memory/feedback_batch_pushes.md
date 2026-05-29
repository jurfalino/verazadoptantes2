---
name: feedback-batch-pushes
description: "Don't push every tiny fix as its own version/commit/CI cycle — batch related changes before shipping"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

Pushing every fix as its own commit (one regex, one CSS class, one button color) burns CI cycles and floods the user with green/red notifications they don't want. The 8–15 min pipeline cost compounds; even on green runs the noise is real.

**Why:** The user said "I'm getting tired of you triggering a push every couple minutes" — explicitly tired of the cadence, not any individual change. The pattern that triggered the feedback: shipping v33 → v36 in ~30 minutes as four separate versions, each on its own pipeline. Most of those could have been one commit.

**How to apply:**
- After completing a small fix, do NOT auto-bump version + commit + push. Pause.
- Bundle related fixes locally in one commit: e.g., a UX feedback round, a "style-guide alignment pass," a hot-fix triage session.
- Push when (a) a batch makes coherent sense as a release note, (b) the user asks me to ship, or (c) it's a single legitimately-urgent fix that can't wait for siblings.
- For tiny single-line fixes, still ask "Want me to bundle this with the next change or ship it now?" — don't assume immediate-ship is the default.
- Cron-pace, not panic-pace. Most days the right answer is one push, not five.
