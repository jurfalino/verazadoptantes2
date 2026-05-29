---
name: BuenAdoptante theming system
description: How light/dark themes are implemented in the app — palette remapping in globals.css under [data-theme] selectors, NOT Tailwind dark: variants
type: project
originSessionId: f99efda1-ca6b-423d-ae3d-d6dee1612cf7
---
The app has two themes selectable via UI: **`light`** (label "Claro") and **`dark`** (label "Azul Noche"). Defined in `src/components/ThemeSelector.tsx`.

**Why:** The codebase deliberately uses CSS-level palette remapping rather than per-component `dark:` Tailwind variants, so the vast majority of components don't need any dark-mode-specific code.

**How to apply this knowledge:**

1. **Theme switcher** lives in `src/components/ThemeSelector.tsx`. Themes array is hardcoded:
   - `{ id: 'light', label: 'Claro', icon: '☀️', bg: '#e5e5ea', fg: '#1d1d1f' }`
   - `{ id: 'dark', label: 'Azul Noche', icon: '🌙', bg: '#0a1628', fg: '#e0e7ff' }`
   - **Labels are NOT i18n'd** — they're Spanish-only string literals. English users still see "Claro" / "Azul Noche". Same for the `title` / `aria-label` "Cambiar tema" on the trigger button.

2. **State management:** `src/context/ThemeContext.tsx` — `useTheme()` hook, persists to `localStorage['theme']`, sets `document.documentElement.setAttribute('data-theme', theme)`. Migrates legacy `'apple'` value to `'light'`.

3. **The actual styling:** `src/app/globals.css` lines 252–360+ remap large swaths of the Tailwind palette under `[data-theme="dark"]`:
   - `.bg-white`, `.bg-stone-50/100/200`, `.bg-teal-50/100/200/300/500/600/700`
   - `.text-stone-900/800/700/600/500/400`, `.text-teal-500–950`
   - `.border-stone-200/100`
   - And more (`divide-stone-100`, etc.)

4. **Auditing dark-mode compliance:** A naive "find components missing `dark:` Tailwind variants" search produces mostly **false positives** — the global remap covers them. A correct audit looks for:
   - **Hardcoded hex/rgb in inline `style={{...}}`** (e.g. `src/app/global-error.tsx` uses `#fafaf9`, `#1c1917`, `#0d9488` — not theme-aware).
   - **Tailwind opacity variants** like `bg-white/80`, `bg-black/40` — these generate distinct classes (`.bg-white\/80`) that the remap rules in globals.css don't cover unless explicitly added.
   - **Colors outside the remapped palette.** Only `bg-white`, `bg-stone-{50,100,200}`, `text-stone-{400-900}`, `border-stone-{100,200}`, `bg-teal-{50,100,200,300,500,600,700}`, and `text-teal-{500-950}` are remapped in `globals.css`. Using **`bg-blue-*`, `bg-amber-*`, `bg-rose-*`, `bg-purple-*`, `text-blue-*`, etc. as primary surface/text colors will NOT adapt to dark mode** — they stay the same color and contrast breaks. Treat these palettes as semantic accents only (small badges, pills) — never as a card background or body text. For themed surfaces, use either the remapped stone/teal palette OR inline CSS vars (`var(--surface-card)`, `var(--text-primary)`, `var(--status-info-bg)`, `var(--btn-primary-bg)`, etc.).

5. **Adding a new theme:** comment in globals.css line 6 says "adding a new theme = adding one new `[data-theme]` block." So a third theme would be e.g. `[data-theme="sepia"]` with new variable values + corresponding palette overrides.
