---
description: Code quality checklist. MUST be followed for ANY code change.
---

# Code Quality Checklist

Before committing any code change, verify the following:

## 1. Verify Before Assuming

> ⚠️ **Never assume business rules — verify them in the actual code.**

Before modifying any logic, **read the relevant UI and data code** to confirm how the feature actually works. Common mistakes from guessing:
- Assuming only certain record types carry ratings (check the form — does the input render conditionally or for all types?)
- Assuming a field is optional when the UI always sets it
- Assuming filtering logic based on one SQL query without checking if other paths do it differently

**Rule of thumb:** If you're about to add a `WHERE` clause, a filter, or any conditional, first verify in the UI component whether that condition matches reality.

## 2. Architecture — Domain Layer Separation

This project uses a 4-layer architecture:

```
PRESENTATION    → src/app/**/page.tsx, src/components/*.tsx
DOMAIN          → src/domain/*.ts  (pure functions, business rules, NO DB imports)
DATA ACCESS     → src/app/actions/*.ts  (server actions, SQL queries)
INFRASTRUCTURE  → src/lib/*.ts  (logger, dates, audit — cross-cutting utilities)
```

**Rules:**
- **Business rules** (computing ratings, building flags, evaluating thresholds) belong in `src/domain/`, NOT in server actions or components.
- **Server actions** should be thin orchestrators: fetch data → call domain functions → return results.
- **Components** should NOT contain business logic. They receive computed data via props.
- **`src/lib/`** is for framework-agnostic utilities (logging, date formatting, error handling). NOT for business rules.

> ⚠️ Before writing a computation, search `src/domain/` for an existing function. If one exists, use it. If the rule doesn't exist yet, add it to the appropriate domain file.

## 3. DRY — No Duplicated Business Rules

- The same business rule must NOT be computed in multiple places.
- If SQL and JS both need the same logic, the rule is **documented once** in the domain module, and each caller implements it consistently.
- Flag reason strings, threshold values, and record type constants must come from `src/domain/constants.ts`, not hardcoded strings.

## 4. Constants — No Magic Strings

- Flag reasons → `FLAG_REASONS` in `src/domain/constants.ts`
- Record types → `RECORD_TYPES` in `src/domain/constants.ts`
- Use these constants in both server actions AND components.

## 5. TypeScript

// turbo
```
npx tsc --noEmit
```
Zero errors required before committing.

## 6. Lint Check

// turbo
```
npx next lint 2>&1 | Select-String "Warning:" | Measure-Object | Select-Object -ExpandProperty Count
```
Must not exceed the current threshold defined in the deploy workflow.

