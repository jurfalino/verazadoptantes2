---
description: Design guide compliance check for any UI change
---

# UI Review Workflow

Run this checklist **before finalizing any UI change** (new component, style modification, or layout update).

## 1. Read the Design Style Guide
Read the canonical guide at **[docs/design-style-guide.md](file:///c:/dev/test/docs/design-style-guide.md)** before starting any UI work. This is the source of truth.

## 2. Spacing Audit (8px Grid)
- Verify every `padding`, `margin`, and `gap` value is a multiple of 8px
- Tailwind equivalents: `p-2` (8px), `p-4` (16px), `p-6` (24px), `p-8` (32px)
- Only permitted exception: `4px` for micro-spacing (toggle thumbs, fine border-radius), must be commented

## 3. Color Token Check
- **No hardcoded hex values** in component files — use CSS variables or Tailwind token-mapped classes
- Verify colors adapt to all themes: check with `[data-theme="dark"]` and `[data-theme="light"]`
- Accent color is **teal** (`--accent` / `teal-*`), never indigo/blue/purple for primary actions

## 4. Button Compliance
- Buttons must use one of the 4 variants: **Primary**, **Secondary**, **Success**, **Destructive**
- Two sizes only: **Standard** (`py-3 px-6 text-sm`) or **Compact** (`py-2 px-4 text-[13px]`)
- All buttons: `rounded-xl`, `font-semibold`, `transition-colors`
- No custom button styles outside the matrix

## 5. Typography Scale
- Headings: 28px/800 (XL), 20px/700 (LG), 16px/700 (MD)
- Body: 15px/500 (Base), 14px/500 (SM)
- Labels: 12px/600 (SM), 11px/600 (XS)
- No font sizes outside this scale

## 6. Elevation & Shadows
- Flat: no shadow (inline elements)
- Floating: `shadow-sm` / `0 2px 8px var(--shadow-color)` (cards, inputs)
- Overlay: `shadow-2xl` (modals, dropdowns)

## 7. Icon Standards
- SVG only, `currentColor`, `strokeWidth={2}` for 24px / `{1.5}` for ≤20px
- Sizes: `w-4 h-4` (inline), `w-5 h-5` (button), `w-6 h-6` (standalone)

## 8. Anti-Pattern Scan
- [ ] No `!important` in new code
- [ ] No hardcoded hex colors
- [ ] No magic numbers outside 8px grid
- [ ] No inline `style={{ }}` for layout spacing
- [ ] No emoji as functional icons (decorative only)

## 9. Cross-Theme Verification
// turbo
Run the dev server and visually verify the component in both Light and Dark themes.
