# Audit: Admin option not visible in user menu (e.g. on form-results page)

**Date:** 2025-03  
**Role:** Senior Engineer Manager  
**Scope:** Root cause analysis and remediation for Admin menu item visibility across all routes.

---

## 1. What was done so far (pre-audit)

1. **UserMenu.tsx**
   - Extended `UserMenuProps.user` to include `isAdmin?: boolean`.
   - Set `userIsAdmin` to prefer `user?.isAdmin` (server-passed) with fallback to `session?.user?.isAdmin` from `useSession()`.

2. **auth.ts**
   - Moved the DB lookup for canonical `token.sub` and `token.isAdmin` **out of** the `if (trigger === 'signIn')` block so it runs on **every** request when `token.email` is present (not only at sign-in).

**Result:** Admin still did not show on the form-results page.

---

## 2. Root cause (why it still failed)

### 2.1 Session not passed to the client

- **Root layout** calls `await auth()` and passes `user={session?.user}` to `<UserMenu />`.
- **SessionProvider** did **not** receive the server `session`. So on the client, `useSession()` starts with no initial session and fetches it asynchronously.
- On first paint (and after client navigation), the client session can be `undefined` or stale, so `session?.user?.isAdmin` is not available when the menu renders.
- So we were depending on the **server-rendered** `user` prop only. If that prop was missing `isAdmin` for any reason (see below), the Admin link never appeared.

### 2.2 Session callback only set `user` when `token.sub` was set

- Session callback had: `if (token.sub && session.user) { ... session.user = { ..., isAdmin }; }`.
- So `session.user.id` and `session.user.isAdmin` were only set when `token.sub` was truthy.
- If the JWT never got `token.sub` (e.g. DB lookup failed in Edge, or old cookie from before the fix), the session callback never wrote `id`/`isAdmin` onto `session.user`, so the server-passed `user` prop had no `isAdmin`.
- So the server-rendered `UserMenu` could receive `user` without `isAdmin`, and the client session was not yet available → Admin never shown.

### 2.3 No explicit `isAdmin` from layout

- Admin visibility depended on the shape of `session.user` (and later `useSession().data?.user`) only.
- There was no explicit, server-resolved `isAdmin` prop passed from the layout, so any bug or delay in session/JWT handling directly hid the Admin option.

---

## 3. What’s happening (data flow)

1. **Layout (server):** `auth()` → JWT callback (resolve `token.sub` / `token.isAdmin` from DB or cookie) → session callback (set `session.user.id` and `session.user.isAdmin`) → `session` returned.
2. **Layout (server):** Renders `<SessionProvider session={…}>` and `<UserMenu user={session?.user} isAdmin={…} />`.
3. **Client:** SessionProvider now gets the same `session` (including `user.isAdmin`) so `useSession()` has it on first paint.
4. **UserMenu:** Uses `isAdmin` from props first, then `user?.isAdmin`, then `session?.user?.isAdmin`, so Admin shows as soon as the server-rendered layout is correct and remains correct after hydration.

---

## 4. Changes made (remediation)

### 4.1 Pass server session into SessionProvider

- **File:** `src/app/layout.tsx`
- **Change:** `<SessionProvider session={session ?? undefined} ...>`
- **Why:** The client gets the same session the server used, so `useSession()` is populated immediately and Admin visibility no longer depends on a second, delayed session fetch.

### 4.2 Session callback always sets `user.id` and `user.isAdmin`

- **File:** `src/auth.ts`
- **Change:** When `session.user` exists, always set `(session as any).user = { ...session.user, id: token.sub ?? (session.user as any).id, isAdmin: !!(token.isAdmin) }`. No longer guarded by `token.sub`.
- **Why:** Every response from `auth()` exposes `user.id` and `user.isAdmin` in a consistent shape, even when the JWT lacks `sub` (e.g. old cookie or failed DB lookup in Edge).

### 4.3 Explicit `isAdmin` prop and single source in UserMenu

- **File:** `src/components/UserMenu.tsx`
  - Added `isAdmin?: boolean` to props.
  - `userIsAdmin = isAdminFromServer ?? user?.isAdmin ?? session?.user?.isAdmin`.
- **File:** `src/app/layout.tsx`
  - Pass `isAdmin={(session?.user as { isAdmin?: boolean })?.isAdmin}` into `UserMenu`.
- **Why:** Admin visibility has a single, clear source of truth: server-resolved `isAdmin` from layout first, then server/user/session fallbacks, so the Admin option shows on first paint and on every route (including form-results) when the user is an admin.

---

## 5. What to do for clean, quality code that works

- **Keep** passing `session` from the layout into `SessionProvider` so client and server stay in sync.
- **Keep** the session callback always setting `user.id` and `user.isAdmin` when `session.user` exists.
- **Keep** the explicit `isAdmin` prop from layout to `UserMenu` and the fallback order in `UserMenu`.
- **Optional:** If the app grows more “admin-only” UI, consider a small `useIsAdmin()` hook that reads from the same sources (server-passed + session) so behavior stays consistent and testable.
- **Optional:** Add a short comment in the layout above `UserMenu` that `isAdmin` is required for correct Admin menu visibility on all routes, including form-results.

---

## 6. Verification

- Log in as an admin and open the form-results page (direct URL or via client navigation). The user menu should show the Admin option on first paint.
- Repeat from a cold load (new tab) and after client-side navigation from another page; Admin should remain visible.
- Sign in as a non-admin; Admin option must not appear on any page.
