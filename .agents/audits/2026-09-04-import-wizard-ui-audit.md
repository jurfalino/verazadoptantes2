# Import Wizard — UI/UX audit

**Date:** 2026-09-04
**Surface:** `src/components/ImportWizard.tsx` (2,070 lines) and its step-3 sub-tree
**Measured against:** `docs/design-style-guide.md` + `docs/ux-ui-guidelines.md`

## Why this exists

The wizard accumulated visual drift that repeated review kept catching one item at a
time — a heading here, a colour there. Fixing symptoms individually was not working,
so this audits the surface as a whole against the two documents that already define
the answers.

**Root cause of the drift, stated plainly:** changes were being made by reasoning from
general UI principles rather than from `ux-ui-guidelines.md`, which had not been read.
That document already names most of these failures, including two as anti-patterns the
project had explicitly walked back and then reintroduced here.

## Findings

### ① Two walked-back anti-patterns are live — §5 rows 6 and 8

**Emoji as functional icons.** Removed project-wide in v36 because emoji render
differently per OS/browser, do not inherit `currentColor`, and break theme coherence.
26 emoji sites remain in the wizard. Not all are violations — §1.3 permits *"emoji as
decorative subject markers next to text labels"*, which covers the species picker
(🐕/🐱/🐦) and the record-type chips (🏠/📝/📞/👁️/🐾). The violations are the
functional ones:

| Glyph | Sites | Role |
|---|---|---|
| `⚠️` | 4 | status signal |
| `✕` | 3 | close control |
| `✓` | 2 | selection state |
| `⏳` | 2 | loading spinner |
| `📎 📤 📹 🎬 🤖 💾` | 6 | action / affordance icons |

**`bg-blue-*` as a primary surface.** Fixed in v32 for `DisclaimerToast` because the
blue palette is not remapped in `globals.css`, so it breaks contrast in Azul Noche.
Verified still present and still unmapped: `bg-blue-500` ×2, `bg-blue-600` ×4,
`border-blue-500` ×1. Dark mode is genuinely broken on those surfaces.

### ② The button matrix is not followed — style guide §2.1

The matrix defines exactly two sizes: Standard `py-3 px-6` and Compact `py-2 px-4`,
both `rounded-xl` with `font-weight: 700`.

The wizard uses **eight distinct padding pairs** and **neither matrix size appears**:

```
py-2.5 px-4 ×8 · px-3 py-2 ×6 · px-3 py-2.5 ×4 · px-4 py-3 ×3
px-4 py-2.5 ×2 · px-2.5 py-1 ×2 · px-2 py-0.5 ×2 · px-3 py-1.5 ×1
```

Weights are `font-medium` (500) where the matrix mandates 700. Radii mix `rounded-xl`,
`rounded-lg` and `rounded-full`.

### ③ Inputs will auto-zoom on iOS — §1.5 and §2.3

Of 8 `input`/`textarea` elements, **7 declare no font size** and one is `text-sm`
(14px). Both documents require a 16px minimum so iOS Safari does not auto-zoom on
focus. `SearchSection` carries an explicit comment about having been bitten by exactly
this; the wizard never received the fix.

### ④ Tap targets below the minimum — §1.5

Multiple `w-8 h-8` (32px) controls against the documented ≥44×44px floor.

### ⑤ The type scale and the codebase disagree — needs a decision, not a patch

The scale says section labels are **Heading-MD, 16px/700**. `AdopterForm` — the
reference surface for consistency — uses `text-sm font-semibold` (14px/600), and the
wizard now matches `AdopterForm`. So *conforming to the guide* and *matching the code*
currently point in opposite directions.

Matching the code was chosen, because a lone conforming heading would look like a bug
next to every other section in the product. **One of the two should move**, and that is
a product decision rather than an implementation one.

### ⑥ The structural cause — no doc rule, but it is why ①–④ happen

2,070 lines in a single component with ~22 inline-styled buttons and no shared button
or section-header primitive. Nothing enforces the matrix, so every change invents its
own spacing. The drift is a consequence of the structure, not of carelessness in any
one change.

## Disposition

| # | Finding | Status |
|---|---|---|
| ① | Functional emoji → inline SVG | **fixed** |
| ① | `bg-blue-*` / `border-blue-*` → themed teal | **fixed** |
| ③ | Inputs to 16px | **fixed** |
| ④ | Tap targets to ≥44px | **fixed** |
| ② | Shared button primitive enforcing the matrix | **partial** — primitive added and adopted for the wizard's step CTAs; remaining inline buttons tracked below |
| ⑤ | Type-scale conflict | **open** — needs a product decision |
| ⑥ | Component decomposition | **open** — 2,070 lines; step bodies are the natural split |

## Follow-ups

- Migrate the wizard's remaining inline-styled buttons onto the shared primitive, then
  add a lint rule so a bespoke button style fails CI rather than review.
- Resolve ⑤: either move the type scale to match the codebase, or migrate section
  headings product-wide to Heading-MD.
- Split `ImportWizard.tsx` by step. Each step body is independently testable and the
  file is currently too large to hold in review.
- Re-run the §6 verification checklist — notably the 375px walk-through and the
  Claro/Azul Noche toggle — which this audit substitutes for only in part.
