---
name: feedback-test-mobile-before-done
description: Always check mobile breakpoints before claiming UI work is done — absolute positioning over content is a recurring regression pattern
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

I keep introducing mobile-only regressions by absolute-positioning controls over content I haven't reserved space for. Latest: v40b's "Empezar de nuevo" button at `absolute top-3 right-3` overlapped the wizard step indicator on narrow viewports. User shipped my change and immediately hit the bug.

**Why:** absolute positioning is fine when the surrounding container has been intentionally padded to make room; it's a regression when the underlying content is allowed to flow into the same coordinates. Mobile is where this hurts because horizontal space is tight and label text wraps unpredictably.

**How to apply:** before declaring any UI change done —
1. Prefer normal-flow layout (flex header rows, grid) over `absolute` positioning. Reserve space explicitly.
2. If `absolute` is the right choice (overlay icons on a thumbnail, etc.), add corresponding padding to the parent so the underlying content can't reach the same cell.
3. Stress-test mentally at narrow widths: name-with-very-long-text, button-with-3-Spanish-words ("Empezar de nuevo" = 18 chars), Latin diacritic widths.
4. If unsure, ship as a `<div className="px-4 py-2 border-b flex items-center justify-end">` header row, not as overlay. Trivial extra height, no overlap class of bug.
5. After deploy, open the staging URL on a phone-width viewport before reporting "ready to smoke-test". The chrome devtools mobile emulation is sufficient.
