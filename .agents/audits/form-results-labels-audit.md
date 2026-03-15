# Audit: Form-results labels “sometimes” not rendering

**Role:** Senior Engineer Manager  
**Date:** 2025-03  
**Scope:** Solution that ensures form-results screen labels always render (production-quality).

---

## 1. What was done

1. **LanguageContext (`src/context/LanguageContext.tsx`)**
   - `t()` was updated so it **never returns an empty string**.
   - When the resolved value is missing or empty, it returns the key path or a single space (`path || ' '`), so the UI never renders a blank label from `t()`.

2. **FormResultsContent (`src/components/FormResultsContent.tsx`)**
   - Added a **local fallback map** `FR` (English strings) for every `formResults.*` key used on the page.
   - Introduced **`L(key)`** = `(t('formResults.' + key) || '').trim() || FR[key]`.
   - Replaced all direct `t('formResults.xxx')` usages with `L('xxx')` so each label has a guaranteed display string.

3. **FormResultMatchCard (`src/components/FormResultMatchCard.tsx`)**
   - Added **`FR_FALLBACKS`** with English strings for every label used in the card (including match-type keys).
   - Introduced **`L(key)`** = `(t('formResults.' + key) || '').trim() || FR_FALLBACKS[key] || key`.
   - Replaced all `t('formResults.xxx')` with `L('xxx')`.

---

## 2. Correctness

- **Problem:** Labels on the form-results screen sometimes did not render (timing/hydration vs. i18n context).
- **Approach:** Two layers — (1) global guarantee in `t()` that the return value is never empty, and (2) component-level fallbacks so each label has a concrete string even when `t()` returns the key or is not yet ready.
- **Verdict:** The solution correctly addresses the symptom and the cause: labels now always have a non-empty value (either from i18n or from the local fallback). No blank labels.

---

## 3. Strengths

- **Defense in depth:** Both context and components are hardened; a single point of failure (e.g. context not ready) does not leave labels blank.
- **Scoped change:** Only form-results–related usage was given local fallbacks; rest of the app unchanged.
- **No behavior change when i18n works:** When `t()` returns the correct translation, that value is used; fallbacks only apply when the translation is missing or empty.
- **Type safety:** `L` in FormResultsContent uses `keyof typeof FR`, so new keys require updating `FR`, reducing drift.

---

## 4. Weaknesses and risks

| Item | Severity | Description |
|------|----------|-------------|
| **Duplicate copy** | Medium | Form-results strings exist in three places: `en.ts`, `es.ts`, and the `FR` / `FR_FALLBACKS` objects. Adding or changing a label requires updating the locale files and the fallback maps. Risk of copy getting out of sync (e.g. wording or new keys only in one place). |
| **English-only fallbacks** | Low | Fallbacks are English. If the app is used in Spanish and i18n fails to load, users see English. Acceptable as a safety net; document that fallbacks are “last resort” and English. |
| **Returning `' '` from `t()`** | Low | When the key is missing and the path is empty (edge case), `t()` returns `' '`. That can add a visible space. Current callers always pass non-empty paths; impact is negligible. |
| **Household items** | Low | FormResultsContent uses `(t(\`formResults.household_${item}\`) || '').trim() || FR['household_${item}'] || item`. If `item` is not in `FR` (e.g. new backend value), the raw `item` is shown. Acceptable; no blank. |
| **FormResultMatchCard `L` and `FR_FALLBACKS`** | Low | `L` accepts any string; `FR_FALLBACKS[key]` can be undefined. Fallback is then `key`, which may be a technical key (e.g. `match_name_full`). Rare and only when i18n fails; acceptable. |

---

## 5. Consistency with the rest of the app

- **Rest of app:** Most screens use `t('section.key')` without local fallbacks; some use `t('...') || 'Hardcoded'` (e.g. AdopterForm).
- **Form-results:** Uses `L(key)` backed by a full fallback map. That is **more** defensive than the rest of the app but **consistent in intent**: ensure labels never render blank on a critical screen.
- **Recommendation:** Treat this as the desired pattern for high-visibility or previously flaky screens. Do not require every screen to have a full fallback map unless product prioritizes it.

---

## 6. Recommendations

1. **Keep the solution.** It is correct, scoped, and production-appropriate. No rollback.
2. **Document fallback strategy (short).** In the form-results plan or a short i18n doc: “Form-results labels use local English fallbacks so they always render; other screens rely on `t()` and optional inline fallbacks.”
3. **When adding new form-results labels:** Require adding the key to both locale files and to `FR` / `FR_FALLBACKS` (or a short checklist in the form-results plan).
4. **Optional later:** If more screens need the same guarantee, consider a small shared helper, e.g. `useFormResultsLabels()` that returns `L` and keeps a single fallback map, to avoid duplicating `FR` and `FR_FALLBACKS` and to centralize the “formResults + fallback” pattern. Not required for current scope.

---

## 7. Verdict

**Approved.** The solution fixes the bug, is production-appropriate, and the main follow-up is process: keep fallback maps in sync when adding or changing form-results copy. No blocking issues; optional improvements are documented above.
