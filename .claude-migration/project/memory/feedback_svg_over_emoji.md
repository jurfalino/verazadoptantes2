---
name: SVG icons over emoji
description: Design guideline — use inline SVG for functional icons (info, close, action affordances), not emoji
type: feedback
originSessionId: f99efda1-ca6b-423d-ae3d-d6dee1612cf7
---
For functional UI icons in BuenAdoptante, use **inline SVG**, not emoji.

**Why:** Emoji rendering is inconsistent across OS / browser / theme — they look different on iOS vs Android vs desktop, can clash with the chosen color theme (you can't restyle the glyph), and don't respond to `currentColor` so they break dark-mode coherence. SVG icons inherit text color, scale cleanly, and match the rest of the app's icon language (the design-style-guide.md specifies SVG with `currentColor` and `strokeWidth={2}` at 24px / `{1.5}` at ≤20px).

**How to apply:**

- Functional affordances (info, close, dismiss, expand, edit, delete, action buttons) → inline SVG, `currentColor`, `aria-hidden="true"` on the svg + a meaningful `aria-label` on the parent button.
- Decorative-only emoji (e.g. 🐱 next to a species label, 🏠 next to a count) is acceptable when the meaning is the emoji's literal subject and there's already a text label carrying the semantics.
- Replace existing emoji icons opportunistically when touching surrounding code; the design-style-guide section "Icon Standards" is the source of truth.

**Reference patterns in this codebase:**

- Hero-style stroke icons: `src/components/AdminSidebar.tsx`, `src/components/AdopterProfileV2.tsx` back-nav arrow.
- Filled circle/path: most action buttons in `src/components/AdopterFlagging.tsx`.
- For a generic info icon: stroke variant `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="8"/><path strokeLinecap="round" d="M10 9v4M10 7h.01"/></svg>`.
- For close/X: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8"/></svg>`.
