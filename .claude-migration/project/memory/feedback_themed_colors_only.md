---
name: feedback-themed-colors-only
description: "Only Tailwind color classes that globals.css [data-theme] explicitly remaps are theme-safe; anything else renders raw and clashes with dark surfaces"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

The BuenAdoptante theming system remaps Tailwind utility classes under `[data-theme="light"]` and `[data-theme="dark"]` in `src/app/globals.css`. It does **not** use Tailwind's `dark:` variants. Any class that is not in those `[data-theme]` rule blocks falls through to the raw Tailwind value, which clashes with the dark `--surface-base` (`#0a1628`).

**Themed shades I have seen confirmed (greppable in globals.css):**
- `bg-white` (solid → surface-card), `bg-white/80`, `/90`, `/20` (with opacity)
- stone: bg-50/100/200, text-400/500/600/700/800/900, border-100/200, divide-100
- teal: bg-50/100/200/300/500/600, text-* (most), border-*
- rose: bg-50/100/200/300/500/600, text-500/600/700/800/900, border-100/200/400
- amber: bg-50/100 (and bg-200 light-only), text-600/700/800 (NOT 900), border-200
- blue: bg-50/100 (limited)
- indigo: bg-100 only
- purple: bg-50/100 (limited)
- green: bg-50/100 (limited)

**Not themed — render raw and break in dark mode:**
- Any shade outside the list above (`text-amber-900`, `bg-amber-200` in dark, etc.)
- Gradient stop classes: `from-*`, `via-*`, `to-*` (these are tw gradient utilities, not bg-*)
- `ring-*` utilities, including `ring-color-*/opacity` (`ring-amber-200/60`)
- Hover variants: `hover:border-stone-300` etc. are typically not in the themed rules
- Literal hex inside inline `<style>` tags or component-level CSS strings

**Why:** because we use `[data-theme]` class remapping. Anything not listed in those rules passes through as raw Tailwind, which is calibrated for white backgrounds and looks terrible on the dark indigo surface.

**How to apply:**
1. Before adding any Tailwind color class, `grep -n "<class>" src/app/globals.css` to confirm it's remapped under both `[data-theme="light"]` and `[data-theme="dark"]`.
2. For gradients with literal colors: use CSS variables (`var(--surface-base)`, `var(--surface-card)`, `var(--text-primary)`, `var(--accent)`, etc.) instead of hex.
3. For ring colors: prefer `border-` (which is themed) over `ring-` for accent outlines, OR add the ring rule to globals.css if a ring is essential.
4. For non-themed accent shades (e.g., `text-amber-900`): step down to a themed one (`text-amber-800`), OR add the rule to globals.css.
5. If a new accent color is needed (e.g., I keep wanting indigo for showcase surfaces), add it to globals.css under both `[data-theme]` blocks in the same PR — don't ship the class without the remap.

**Recent bugs caused by ignoring this:**
- v2.14.10-14 `ShareFormMenu` button: shifted to indigo, broke dark mode.
- v2.14.10-10 `/quienes-somos`: hero backdrop with literal `#f5f5f4` / `#fafaf9`, mission-banner gradient with `via-white`, `ring-*-200/60` on pillars — all broke dark mode.
- v2.14.10-12 `ShowcaseUrlChips` photo notice: `text-amber-900` not themed.

Related: [[project-theming]] (high-level description of the system itself).
