# Set an existing image as the adopter profile photo

**Date:** 2026-07-22
**Status:** approved

## Problem

On the adopter profile, clicking the avatar only ever opens the file picker
(empty state → picker; filled state → lightbox → "Cambiar foto" → picker).
Users cannot pick one of the profile's **existing** photos as the avatar from
that flow. The capability exists — `setProfilePicture(adopterId, imageId)` — but
it is only reachable via a hover-only "Set Profile" star on Photos-section
gallery tiles, which users don't discover.

## Scope

"Existing images" = the profile-level photos `AdopterForm` already receives via
its `images` prop (`adopterId` set, `adoptionId IS NULL`) — uploaded and
scraped/Instagram photos that live on the profile. Photos attached to a specific
activity/adoption record (`adoptionId` set) are **out of scope**.

No new server code: reuse `setProfilePicture(adopterId, imageId)`.

## Design (both surfaces)

### 1. Avatar chooser (new `ProfilePhotoChooser`)

Clicking the avatar (authenticated, saved profile) opens a small chooser
anchored under the avatar:

- Grid of the profile's existing photos; the current profile photo shows a
  check and is not re-selectable. Tapping any other photo calls
  `setProfilePicture(adopterId, imageId)`.
- A final **"Subir nueva foto"** tile that triggers the existing hidden
  file-input (upload path unchanged).
- **Fallback:** if there is nothing to choose from — 0 photos, or the only
  photo *is* the current avatar — skip the chooser and open the file picker
  directly (today's behavior). The chooser only appears when it adds value.
- The lightbox "Cambiar foto" action opens the chooser instead of jumping
  straight to upload.

Component boundary: `ProfilePhotoChooser` takes `{ images, adopterId,
currentProfileId, isOpen, onClose, onUploadNew }`. It owns the grid + the
set-profile call + busy state; `AdopterForm` owns when to open it and the
file-input.

### 2. Gallery button (Photos section)

Make the existing "Set Profile" star **always visible** — drop the
`md:opacity-0 md:group-hover:opacity-100` hover-gating in `ImageGallery.tsx`.
No logic change; it already calls `setProfilePicture` and already hides on the
current profile tile.

## Behavior / data

After a successful set, `window.location.reload()` — consistent with the
current avatar-upload flow — so the avatar and "Profile" badge update
everywhere.

## i18n

New keys in **both** `es.ts` and `en.ts` (reuse existing where present):
`adopter.choose_profile_photo` (chooser title), `adopter.upload_new_photo`
(upload tile). Reuse `adopter.set_as_profile` / `adopter.profile_picture`.

## Testing

- **Component test (`ProfilePhotoChooser.test.tsx`, vitest):** render contract —
  one tile per selectable image + an upload tile, current photo marked
  `aria-current`, `temp-` ids filtered, nothing rendered when closed. Runs
  locally.
- **No new Playwright e2e.** Node 26 blocks local e2e (better-sqlite3), so a new
  spec could only be validated blind in CI — a net risk (an untested selector
  would block the deploy). No existing e2e depends on the old avatar/lightbox
  flow (grep-confirmed), so nothing regresses. The set-profile flow ends in a
  full page reload, which is inherently flaky to assert on.
- **Manual:** visual check on staging on a profile with ≥2 profile photos —
  avatar tap opens the chooser, picking a non-current photo updates the avatar +
  "Profile" badge; single-photo/no-photo profile → file picker (no chooser);
  gallery "Set Profile" button visible without hover.

## Files

- new `src/components/ProfilePhotoChooser.tsx`
- `src/components/AdopterForm.tsx` — open chooser from avatar + lightbox action
- `src/components/ImageGallery.tsx` — one-line: always-visible Set Profile star
- `src/i18n/locales/{es,en}.ts` — new keys
- e2e spec
