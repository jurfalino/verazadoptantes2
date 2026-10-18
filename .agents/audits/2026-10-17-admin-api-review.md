# Admin → API — senior EM review (2026-10-17, staging v2.56.197)

Context: since 2.56.197 anyone signed in can create their own API keys at /developers
(after accepting the terms; 100 exact / 50 fuzzy per day per key; max 3 active
self-created keys). The admin page was built for admin-issued keys only.
★ = needed before turning the API on in production.

1. ★ **Limits bypassable**: caps are per key and the 3-key rule counts only active keys →
   revoke + recreate gives another 50 fuzzy lookups, without end. Fix: per-person daily cap
   across all keys + a limit on keys created per day. M.
2. ★ **Admin can stop a key, not a person**: no suspend anywhere. Fix: "Block from the API"
   per user (revokes all keys, refuses new ones, reason, checked on every call). S–M.
3. ★ **No view of who looks people up**: page filters only outcome/key; no fuzzy filter, no
   heavy-fuzzy badge. Fix: per-person view (fuzzy calls/day, 30 days), owner/mode/date
   filters, searched name in rows, "heavy fuzzy" badge. M.
4. ★ **"Many voids" badge**: per key (spreading hides it) and counts admin voids. Fix: per
   person, excluding admin voids. S.
5. ★ **No audit of admin reading a call's details** (full bodies with person data); audit
   page has no wording for api_* actions. S.
6. ★ **«Regenerar» on a self-created key shows the rescuer's new secret to the admin.**
   Hide it for self-created keys (owner regenerates at /developers). S.
7. ★ **No API health/controls on the page**: on/off only in Config; no "pause
   self-service"; no counts of calls, 4xx, 5xx/503, daily_cap_reached,
   daily_call_ceiling_reached. Status strip + switch + 24h/7d counts. M.
8. Partner support: requestId/externalId search box; store and show the error code per
   row (needs a column). S / S–M.
9. Cap inputs: clearing a box saves 0; no save feedback; "exact"/"fuzzy" not translated.
   Explicit Save, refuse empty. S.
10. Key list: created/revoked-by/terms version columns, active/revoked/flagged filters,
    pagination (stops at 200, 3 queries per key); admin-issued-to-self mislabelled
    self-created. S–M.
11. Page order: tabs Overview / Keys / Calls; loading state ("No keys" flashes); issue
    form lower; check phone width. S–M.
12. Retention/terms (product): profileIds kept forever; 90-day purge only runs on page open
    or ~2% of calls; a new terms version doesn't stop existing keys; 401 attempts only in logs.

Decisions for Jon: who may create keys (any Google account today); whether admins see
searched names inline; how long to keep who-looked-up-whom.
