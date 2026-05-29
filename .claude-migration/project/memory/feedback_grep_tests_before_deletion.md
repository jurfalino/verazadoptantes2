---
name: Grep tests before deleting UI elements
description: Before removing a UI element (H1, button, label, distinctive class), grep the tests/ folder for any selector that targets it — Playwright tests don't fail at compile time, only in CI
type: feedback
originSessionId: f99efda1-ca6b-423d-ae3d-d6dee1612cf7
---
Before deleting any UI element from a component, grep `tests/` for selectors that may target it. Specifically:

- Removing an `<h1>` → grep for `getByRole('heading', { level: 1 })`, `getByRole('heading'`, `locator('h1')`
- Removing a button/label → grep for `getByRole('button', { name:`, `getByText`, `getByLabel` matching the visible text
- Removing a distinctive class or `data-testid` → grep for `locator('.classname')`, `getByTestId('…')`
- Removing a route/link → grep for `goto('/path')`, `href.*/path`
- **Removing or renaming an i18n string → grep `tests/` for the LITERAL VALUE, not just the key.** Playwright `getByText(/literal/)` and `getByRole({ name: /literal/ })` assertions hard-code the rendered text, so deleting `home.value_main: 'Busca adoptantes y Registra adopciones'` breaks any test asserting that visible string. Grepping for the key (`value_main`) doesn't catch it; grepping for a unique snippet of the value does. (v2.14.9-7 → v2.14.9-8 incident: I grepped the i18n key and missed the literal in `smoke.spec.ts:15`, blocking deploy.)

**Why:** Playwright tests are not type-checked against the React tree. They fail only at runtime in CI, AFTER pushing. The CI deploy job is gated on e2e success — so a missed test reference blocks the deploy entirely, even when the production code itself is correct.

**How to apply:** when planning a UI removal, include "grep tests/ for the selector" as an explicit pre-commit checklist item. Update or remove the affected test in the SAME commit as the UI change so deployment isn't blocked.

**Reference incidents:**
- v2.12.1-25: 2 duplicate-banner tests broke when v19 removed the system-duplicate banner; required `test.skip()` to unblock deploys.
- v2.12.1-40: smoke test broke when v39 removed the homepage H1; one-line fix but blocked v39 from deploying for a day.

**When the test still has value but the element is gone**, replace the assertion with a stronger anchor (the actual primary element on the new screen) rather than skipping. v40's smoke test now checks `input#search` + `home.value_main` text — a stronger check than the original H1 assertion.
