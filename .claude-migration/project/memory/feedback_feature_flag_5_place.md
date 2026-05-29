---
name: Feature flag plumbing is 5 places, not 4, for client-visible UI
description: When adding a feature flag that controls UI visible to non-admin users, the public /api/config whitelist is the 5th place that's easy to miss
type: feedback
originSessionId: f67b0d31-bbc2-47fc-b0c8-9785c546d8b5
---
The feature-flag pattern in this codebase is documented as 4 places (CLAUDE.md, the v2.14.8-5 ENABLE_MILESTONE_BADGE commit, etc.):

1. `src/config/features.ts` — `FEATURE_FLAGS` const + `getAllFeatureFlags` defaults
2. `src/app/api/admin/config/route.ts` — admin GET response
3. `src/app/admin/config/page.tsx` — UI toggle list + state + hydration
4. `src/i18n/locales/{es,en}.ts` — `flag_label_*` and `flag_desc_*`

**But there's a 5th place when the flag gates UI that's visible to non-admin users**:

5. `src/app/api/config/route.ts` — `PUBLIC_FLAG_KEYS` whitelist + `PUBLIC_FLAG_DEFAULTS`

The public `/api/config` endpoint is what unauthenticated and non-admin users hit. It deliberately whitelists which flags it exposes (so admin-only flags don't leak). If the flag isn't on the whitelist, the homepage / non-admin pages will see `undefined` for that key — regardless of what the admin sets in `/admin/config`. The admin endpoint writes correctly, but the public reader never reads back.

**Why:** `appConfig.SOMETHING !== 'false'` is `true` when the value is `undefined`, so a non-whitelisted flag silently behaves as "always on."

**How to apply:** when adding a new feature flag, ask "does any non-admin code path read this?" If yes (homepage, /search, any unauthed route, any logged-in-non-admin page), update **both** `/api/config/route.ts` and `/api/admin/config/route.ts`. If no (admin-only feature), the 4-place pattern is enough.

**Reference incident:** v2.14.8-5 added `ENABLE_MILESTONE_BADGE` with full 4-place plumbing. v2.14.9-9 had to follow up to add the 5th place after a user reported the toggle did nothing on the homepage.
