---
name: project-adopter-status-deprecated
description: "adopter.status column is effectively deprecated — frozen at \"5\" default, only avgRating (computed from history) is the real rating"
metadata: 
  node_type: memory
  type: project
  originSessionId: ca293daf-bb1a-4040-a0c6-2403065d470b
---

`adopters.status` is a `text("status").default("5")` column in `src/db/schema.ts:16`. Schema label calls it "Rating: 1-5 (1=Dangerous, 5=Excellent)" — but in practice:

- It is initialized to `'5'` at every create path (`AdopterForm.tsx:208,423`, `_adopterFactory.ts:115`, `api/adopters/route.ts:242`).
- **No UI mutates it after creation.** No input, no setter, no admin action writes a non-default value.
- The user-facing "rating" everywhere (search results, my-adopters, adopter profile) is `avgRating` = `computeAvgRating(records)` from `src/domain/ratings.ts` — average of non-null `rating` fields on the adopter's activity records (adoption/request/observation/follow-up/returned_pet).

**Stale reads still in the codebase** (treat `status` as the rating, but it's always 5):
- `src/app/actions/applicants.ts:86` — per-animal applicants disclosure on `/my-animals` shows `adopter.status` as the rating.
- `src/components/DuplicateMergeModal.tsx:156-158` — renders `Rating: {adopter.status}`.

Both should be migrated to `avgRating`. They're drift, not intent.

**Why:** `status` was the rating field in early versions before the activity-log rating model was introduced. The migration to `avgRating` wasn't completed end-to-end — the field stayed in schema for backwards-compat but the UI moved on.

**How to apply:** When designing rating UX for /my-adopters or search surfaces, do NOT fall back to `adopter.status` when `avgRating` is null — that just shows "5" for every unrated adopter, which is meaningless. Instead show a clear "Sin actividad calificada" / "—" placeholder. If you encounter the two stale-read sites, fix them by routing through `computeAvgRating` like the rest of the app.
