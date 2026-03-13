---
description: Code quality checklist. MUST be followed for ANY code change.
---

# Code Quality Checklist

> **Run this checklist mentally before submitting ANY code edit.**

## Before Writing Code

1. **Read the function you're calling.** Open its implementation. Understand:
   - What does it return? (exact type, not assumed)
   - When does it throw? What errors?
   - Does it have side effects?
   - Never write a caller based on the function *name* alone.

2. **Search for blast radius.** Before fixing a bug or changing a pattern:
   ```
   grep -r "functionName\|patternToFix" src/ --include="*.tsx" --include="*.ts"
   ```
   Fix ALL instances or document why you're only fixing some.

3. **Understand the context.** Before editing a component:
   - What theme is active? Will this work in both light AND dark?
   - Is the user authenticated? What happens if they're not?
   - Is this server or client code? Can you use hooks? Can you use `redirect()`?

## While Writing Code

4. **No dead code.** For every condition you write (`if`, `catch`, ternary):
   - Can this branch actually execute? Trace the data flow to prove it.
   - If not, delete it. Don't leave "defensive" checks for impossible states.

5. **No redundant code.** Before adding a new block:
   - Does equivalent logic already exist above/below?
   - Am I duplicating a redirect, a check, or a fetch?

6. **Respect framework internals.** In Next.js specifically:
   - `redirect()` throws a `NEXT_REDIRECT` error — catch blocks must re-throw it.
   - Server Actions that throw are auth guards — don't change their contract without auditing all callers.
   - `'use server'` functions have different constraints than page components.

7. **One concern per edit.** Don't mix:
   - Auth fixes with styling changes
   - Refactors with feature additions
   - Token infrastructure with violation fixes

## Before Calling It Done

8. **Re-read your own output.** Read the diff as if reviewing someone else's PR:
   - Does every line serve a purpose?
   - Are there typos in template literals, extra braces, wrong variable names?
   - Is the type annotation accurate (not `any` when a real type is known)?

9. **Type check.** Run before declaring any edit complete:
   // turbo
   ```
   npx tsc --noEmit
   ```

10. **Verify all affected sites.** If you changed a function's behavior, grep for every caller and confirm they still work.

11. **Schema changes → run `/schema-sync`.** If you touched `src/db/schema.ts` or added a migration file, run the schema-sync workflow to ensure the local D1 database matches.

12. **Before pushing → run `/deploy`.** Follow the full deploy workflow for commits.
