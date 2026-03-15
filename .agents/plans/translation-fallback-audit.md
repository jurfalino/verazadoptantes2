# Audit: Translation fallback solution (Engineering Manager)

## 1. Current architecture

### 1.1 LanguageContext (`src/context/LanguageContext.tsx`)

- **Locales:** `en`, `es`. **Default locale:** `es`.
- **`t(path)` behavior:**
  - Resolves `path` (e.g. `'dashboard.share_buttons_hint'`) against the current locale’s dictionary.
  - If the key is **missing** in the current locale, it falls back to **`DEFAULT_LOCALE` (Spanish)**, not English.
  - If the key is still missing there (or any step in the path fails), it returns **`path`** (the key string) or `' '` so the UI never gets an empty string.
- **Empty values:** If the resolved value is an empty string, `t()` returns `path` or `' '`, so labels are never blank.

**Implication:** When a key exists in `en` but is missing in `es`, and the user’s locale is `es`, `t()` returns the **key path** (e.g. `dashboard.share_buttons_hint`), not the English string. So the “context-level” fallback is Spanish-only; there is no automatic fallback to English.

### 1.2 Component-level fallbacks

Three patterns appear in the codebase:

| Pattern | Where | Example |
|--------|--------|--------|
| **Inline `t('key') \|\| 'Hardcoded'`** | Many components (AdopterProfile, ShareMenu, my-animals, AdopterFlagging, ImageGallery, my-adopters, etc.) | `t('dashboard.share_contract') \|\| 'Share contract'` |
| **Centralized section fallback** | FormResultsContent, FormResultMatchCard | `const L = (key) => (t(\`formResults.${key}\`) \|\| '').trim() \|\| formResultsFallbacks[key] \|\| key` with `formResultsFallbacks = en.formResults` |
| **Explicit String + trim + fallback** | my-animals (share hint) | `String(t('dashboard.share_buttons_hint') \|\| '').trim() \|\| 'Share the form...'` |

So:

- **Form results:** One shared source of fallbacks (`en.formResults`), used via `L(key)`. Good for consistency and avoiding duplication for that section.
- **Rest of app:** Many ad‑hoc `t('...') || '...'` with English (or Spanish) strings in JSX. Those strings duplicate `en.ts` (or `es.ts`) and can drift.

---

## 2. Strengths

1. **No blank labels:** `t()` always returns a non-empty string (value, or `path`, or `' '`), so the UI doesn’t show empty text.
2. **Safe traversal:** Missing intermediate keys don’t throw; the function falls back to `DEFAULT_LOCALE` or returns `path`/space.
3. **Form results:** A single, clear pattern and single source of truth for form-results fallbacks (`en.formResults` + `L()`).
4. **my-animals hint:** Robust fallback with `String(...).trim() || '...'` so the hint always shows readable copy even when the key is missing or empty.

---

## 3. Issues and risks

### 3.1 Context fallback is Spanish-only

- When a key is missing in the **current** locale, the context uses **Spanish** (`DEFAULT_LOCALE`), not English.
- If the key is missing in **both** en and es (e.g. new key only in en), **es** users see the **key path** (e.g. `dashboard.share_buttons_hint`) instead of a readable string.
- So: “fallback” at context level does not use English as a last resort; only component-level `|| '...'` does.

### 3.2 Inconsistent and duplicated fallbacks

- Many components use `t('key') || 'Some English'`. That English is duplicated from `en.ts` and can get out of sync when copy changes.
- No single rule for when to add a fallback: some screens have many, others none.
- Long copy in JSX (e.g. my-animals hint) is harder to keep in sync with locale files.

### 3.3 Raw key path can appear in UI

- Whenever a key is missing in the **active** locale and the context fallback (es) also doesn’t have it, `t()` returns the path. So users can see strings like `dashboard.share_buttons_hint` or `formResults.section_matches`.
- Form results avoid this via `L()` and `en.formResults`. Other screens rely on ad‑hoc `|| '...'`; where that’s missing, key paths can show.

### 3.4 Mixed responsibility

- Context: “never return empty; on missing key try DEFAULT_LOCALE (es); else return path.”
- Components: “sometimes provide a last-resort English (or other) string.”
- There’s no documented contract (e.g. “always use `t()` only” vs “always use `t() || fallback`” or “use section helpers like `L()` where they exist”).

---

## 4. Recommendations

### 4.1 (High) Make context fall back to English when key is missing in both

- After resolving from current locale and then `DEFAULT_LOCALE` (es), if the key is still missing (or result is empty), try **English** and return that if present.
- Effect: missing keys in es (or in both) still show readable text (from en) instead of the key path, without touching every component.

### 4.2 (High) Document the intended pattern

- Add a short “i18n / translation fallbacks” section to the repo (e.g. in a CONTRIBUTING or docs file):
  - Prefer `t('section.key')`; ensure the key exists in both `en.ts` and `es.ts`.
  - For new keys, add to both locale files in the same PR.
  - If a component must guarantee a string when the key is missing, use a single fallback (e.g. `t('key') || fallbackEn`), and prefer reusing a constant or `en.section.key` so the fallback stays in sync with `en.ts`.

### 4.3 (Medium) Reduce duplication for long copy

- For long or critical copy (e.g. share hint), avoid repeating the same long string in JSX. Options:
  - Use a helper that reads from `en.dashboard.share_buttons_hint` (or a shared constant) when `t('dashboard.share_buttons_hint')` is missing/empty, similar to form results’ `L()`.
  - Or keep the current `String(t(...)).trim() || '...'` but move the fallback string to a constant (e.g. `DASHBOARD_HINT_FALLBACK_EN`) next to the locale files or in a small i18n-fallbacks module.

### 4.4 (Medium) Extend the “section fallback” pattern only where it pays off

- The form-results `L()` + `en.formResults` pattern is good where many keys are used together and should stay in sync. Consider the same for other dense sections (e.g. dashboard, adopters) only if you add many keys there and want one place for fallbacks. Don’t force it everywhere.

### 4.5 (Low) Optional: last-resort fallback inside `t()`

- As an alternative to 4.1, inside `t()` when both current and DEFAULT_LOCALE fail, try the other locale (e.g. `en`) and return that value if it’s a non-empty string. That keeps “try English when all else fails” in one place and avoids showing the key path in the UI.

---

## 5. Summary

| Aspect | Status | Action |
|--------|--------|--------|
| Blank labels | OK | None |
| Context fallback | Spanish only; key path can show | Add English as last-resort in context (or try “other” locale in `t()`) |
| Duplication / drift | Inline fallbacks duplicate en.ts | Document pattern; prefer constants or `en.*` for fallbacks |
| Form results | Good pattern | Keep; reuse idea only where it clearly helps |
| Long copy (e.g. hint) | Fallback in JSX | Prefer constant or shared fallback source |

Overall, the solution is **production-safe** (no blank labels, no throws), but **inconsistent** and **leaning on component-level fallbacks**. Centralizing “missing key → try English” in the context and documenting when and how to use fallbacks would improve consistency and maintainability without a large refactor.
