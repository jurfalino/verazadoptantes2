# PetShield Design Style Guide
**Source of Truth — v1.0**

---

## Section 1: The Foundation (Design Tokens)

### 1.1 The 8px Grid

Every spacing value must be a multiple of **8px**. No exceptions. Refer to these named tokens:

| Token | Value | Usage |
|-------|-------|-------|
| `--sp-1` | 8px | Inline gaps, icon padding |
| `--sp-2` | 16px | Input padding, card gap |
| `--sp-3` | 24px | Section padding (mobile) |
| `--sp-4` | 32px | Section padding (desktop) |
| `--sp-5` | 40px | Large gaps |
| `--sp-6` | 48px | Hero spacing |
| `--sp-8` | 64px | Page sections |
| `--sp-10` | 80px | Top-level containers |

> **CAUTION:** The **only** permitted exception is `4px` for micro-spacing (inner toggle thumb offsets, border-radius fine-tuning). Document it with `/* 4px: half-grid exception */`.

### 1.2 Color Architecture

#### Neutral Surfaces ("Deep Space" in dark, "Warm Stone" in light)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--surface-base` | `#e5e5ea` | `#0a1628` | Page background |
| `--surface-card` | `#f2f2f7` | `#1e293b` | Cards, inputs |
| `--surface-muted` | `#d1d1d6` | `#1e293b` | Subtle separators |
| `--surface-elevated` | `#c7c7cc` | `#334155` | Hover states, elevated surfaces |

#### Accent Palette (Teal — Brand)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--accent` | `#0f766e` | `#5eead4` | Links, selected state |
| `--accent-strong` | `#042f2e` | `#99f6e4` | Headings, high emphasis |
| `--accent-hover` | `#115e59` | `#14b8a6` | Hover state |
| `--accent-subtle-bg` | `rgba(20,184,166,0.08)` | `rgba(94,234,212,0.1)` | Badge/pill backgrounds |
| `--btn-primary-bg` | `#0f766e` | `#14b8a6` | Primary CTA background |
| `--btn-primary-shadow` | `rgba(15,118,110,0.2)` | `rgba(20,184,166,0.3)` | CTA glow |

#### Semantic Status Colors

| Intent | `*-bg` | `*-text` | `*-border` |
|--------|--------|----------|------------|
| **Success** | `--status-success-*` | Green | Confirmations, linked profiles |
| **Warning** | `--status-warning-*` | Amber | Duplicate matches, gift intent |
| **Error** | `--status-error-*` | Rose | Validation, API failures |
| **Info** | `--status-info-*` | Teal (dark) / Blue (light) | Neutral information |
| **Purple** | `--status-purple-*` | Violet | Special states, secondary actions |

### 1.3 Typography Scale

Font stack: **Geist Sans** (Next.js app), **Inter** (contract-app / PetShield form).

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Heading-XL | 28px | 800 | 1.2 | Form step titles |
| Heading-LG | 20px | 700 | 1.3 | Page titles |
| Heading-MD | 16px | 700 | 1.4 | Card headers, section labels |
| Body-Base | 15px | 500 | 1.6 | Body text, input values |
| Body-SM | 14px | 500 | 1.5 | Descriptions |
| Label-SM | 12px | 600 | 1.4 | Input labels, step counters |
| Label-XS | 11px | 600 | 1.3 | Badges, keyboard hints, error IDs |

> **IMPORTANT:** Letter-spacing: `-0.02em` on Heading-XL/LG. `0.05em` (uppercase tracking) on Label-SM.

---

## Section 2: The Component Library

### 2.1 The Button Matrix

All buttons use: `border-radius: 12px` (`rounded-xl`), `font-weight: 700`, `transition: all 200ms ease-in-out`.

#### Two Size Variants

| Size | Padding | Font | Usage |
|------|---------|------|-------|
| **Standard** | `12px 24px` (py-3 px-6) | 14px | Page CTAs, form nav |
| **Compact** | `8px 16px` (py-2 px-4) | 13px | Inline actions, share triggers |

#### Four Color Variants × Five States

| Variant | Default | Hover | Active | Disabled | Loading |
|---------|---------|-------|--------|----------|---------|
| **Primary** | `bg: --btn-primary-bg` `text: white` `shadow: 0 2px 8px --btn-primary-shadow` | `bg: --accent-hover` `shadow: 0 4px 16px` `translateY(-1px)` | `translateY(0)` | `opacity: 0.4` `cursor: not-allowed` | Spinner replaces label |
| **Secondary** | `bg: --accent-subtle-bg` `text: --accent` `border: 1px solid --border-accent` | `bg: --accent-badge-bg` `border-color: --accent` | — | `opacity: 0.4` | — |
| **Success** | `bg: --status-success-bg` `text: --status-success-text` `border: 1px solid --status-success-border` | Intensified bg (15%) | — | — | — |
| **Destructive** | `bg: --status-error-bg` `text: --status-error-text` `border: 1px solid --status-error-border` | Intensified bg (15%) | — | — | — |

### 2.2 The Luminous Card

All interactive cards use this spec:

```css
.card {
    background: var(--surface-card);
    border: 1px solid var(--border-default);
    border-radius: 16px;                    /* rounded-2xl */
    padding: 16px;                          /* --sp-2 */
    transition: all 200ms ease-in-out;
}

.card:hover {
    border-color: var(--border-accent);
    box-shadow: 0 0 20px rgba(var(--accent-glow-rgb), 0.15),
                0 0 40px rgba(var(--accent-glow-rgb), 0.05);
    transform: translateY(-2px);
}

.card--selected {
    background: var(--accent-subtle-bg);
    border-color: rgba(var(--accent-glow-rgb), 0.4);
    box-shadow: 0 0 24px rgba(var(--accent-glow-rgb), 0.3),
                0 0 48px rgba(var(--accent-glow-rgb), 0.1);
}
```

### 2.3 Form Inputs (Typeform Style)

| Property | Value |
|----------|-------|
| Background | `var(--surface-card)` |
| Border | `1px solid var(--border-default)` |
| Border (focus) | `var(--border-accent)` + glow shadow |
| Padding | `16px` (all sides) |
| Font size | 15px / weight 500 |
| Border radius | `12px` |
| Label | 12px / 600 / uppercase / `--text-muted` |
| Error text | 12px / 500 / `--status-error-text` |
| Placeholder | `--text-faint` |

### 2.4 Share Modal

Both `ShareMenu` and `ShareFormMenu` must follow identical structure:

| Element | Spec |
|---------|------|
| Backdrop | `bg-black/40 backdrop-blur-sm` |
| Modal panel | `bg: --surface-card`, `border: 1px solid --border-default`, `rounded-2xl`, `max-w-sm` |
| Header icon | `40×40px rounded-xl`, `bg: --accent-subtle-bg` |
| Option rows | `px-4 py-3 rounded-xl`, hover: `--surface-muted` |
| Option icon box | `40×40px rounded-xl`, colored bg matching intent |

---

## Section 3: Visual Language & Depth

### 3.1 Elevation Levels

| Level | Shadow | Use case |
|-------|--------|----------|
| **Flat** | `none` | Inline elements, text |
| **Floating** | `0 2px 8px var(--shadow-color)` | Cards, inputs, buttons |
| **Overlay** | `0 8px 32px var(--shadow-lg), 0 2px 8px var(--shadow-color)` | Modals, dropdowns, toasts |

### 3.2 Iconography

| Property | Spec |
|----------|------|
| Format | **SVG only** (no icon fonts, no PNGs) |
| Stroke width | `2px` for 24×24, `1.5px` for 20×20 and below |
| Sizing | `16px` (inline), `20px` (button icon), `24px` (standalone) |
| Color | `currentColor` — inherits from parent text color |
| Style | Rounded linecaps and linejoins (`strokeLinecap="round"`) |

### 3.3 Animation Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-micro` | `200ms ease-in-out` | Buttons, inputs, card hovers |
| `--ease-slide` | `400ms cubic-bezier(0.16, 1, 0.3, 1)` | Form step transitions |
| `--ease-modal` | `300ms cubic-bezier(0.16, 1, 0.3, 1)` | Modal enter/exit |

> **TIP:** Never animate `width`/`height`. Prefer `transform`, `opacity`, and `box-shadow` for GPU-accelerated performance.

---

## Section 4: Anti-Patterns (The "Don'ts")

### ❌ Prohibited Practices

| Anti-Pattern | Why | Instead |
|-------------|-----|---------|
| `!important` | Creates specificity wars, unmaintainable cascade | Use scoped selectors or CSS layers |
| Hardcoded hex in components | Breaks theme switching | Use `var(--token-name)` |
| Magic numbers (e.g., `13px`, `7px`, `23px`) | Inconsistent spacing, no grid compliance | Use multiples of 8 (exception: `4px` micro-spacing, documented) |
| Ad-hoc opacity values | Inconsistent translucency | Use token-defined `rgba()` values |
| `font-size` without a scale token | Typography drift | Use the 7-tier typography scale |
| `animation-duration` without a token | Inconsistent motion | Use `--ease-micro`, `--ease-slide`, or `--ease-modal` |
| Inline `style={{ }}` for layout | Untrackable, no theme support | Use Tailwind utilities or CSS classes |
| Emoji as icons in production components | Accessibility, inconsistent rendering | Use SVG icons with `aria-label` |

### ✅ Required Patterns

| Pattern | Description |
|---------|-------------|
| **Token-first** | Every color, spacing, and shadow must reference a CSS variable |
| **Scoped styles** | New feature CSS must be scoped (`.ps-*`, `.card-*`) |
| **8px audit** | Before merging, verify all spacing is grid-compliant |
| **Contrast check** | All text must pass WCAG 2.1 AA (4.5:1 for body, 3:1 for large) |
