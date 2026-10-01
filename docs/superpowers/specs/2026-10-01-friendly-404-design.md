# Friendly 404 and "belongs to another rescuer": design

**Status:** approved in conversation with Jon, 2026-10-01. Mockups: `.superpowers/brainstorm/58263-1790876540/content/` (local, not committed).

## Why

Jon opened `/my-animals/911ffc00-…` (Frido) on staging and got a bare "Not Found". The animal exists. It belongs to gatitosolivos@gmail.com, and Jon's account is neither the owner, a teammate, nor an admin. The page could not tell "doesn't exist" from "isn't yours", logged nothing, and the 404 itself is an unstyled English stub.

## Decisions

| # | Decision | By |
|---|---|---|
| D1 | Main app only. The public showcase/contract site keeps its own empty states | Jon |
| D2 | 404 illustration is **random per visit**: dog ("Un perro se comió esta página") or cat ("Un gato tiró esta página de la mesa"). No third character | Jon |
| D3 | Another rescuer's animal gets its own screen, not the 404. It **always** shows the owner's display name and first group, whatever the animal's status | Jon |
| D4 | Owner identity = `buildPublicRescuer` (user name, else email local-part; first org). **Never the email.** No contact button | Jon + Claude |
| D5 | Public link only when the animal is **publicly listed** (same rule as `/api/showcase/animal/[id]`: `recordType='available'`, no adopter, ≥1 photo). The rule is extracted so both sites share one definition | Claude |
| D6 | Illustration follows species: cat, dog, bird each with a tag; anything else or empty gets a name tag engraved with the animal's name | Jon + Claude |
| D7 | Headline "**[Nombre] está en buenas manos**": no pronoun, so it fits every species and sex | Claude |
| D8 | Form results and contract results: both "not found" and "not yours" → the 404. These hold applicants' PII, so existence is not confirmed | Claude |
| D9 | Invalid team-invite links keep their specific message | Claude |

## 1. The 404 page

- `src/components/NotFoundView.tsx`: illustration + heading + one line + buttons "Volver al inicio" (primary) and "Buscar un adoptante" (secondary), plus a small "Error 404" label.
- `src/app/not-found.tsx` picks the variant (`'dog' | 'cat'`) with `Math.random()` on the server and passes it as a prop. Picking on the client would cause a hydration mismatch.
- The copy goes through `t()`, with keys in **es, en and pt**. The two illustrations are inline SVG (`currentColor` and theme-safe tokens only, no raw hex), so they work in both themes.
- Layout: centered column, 8px grid, type scale from `design-style-guide.md`, tap targets ≥44px. Lives under the sticky h-16 nav.

## 2. Where the 404 is used

| Surface | Today | After |
|---|---|---|
| Any unknown URL | stub `not-found.tsx` | new 404 |
| `/adopter/[id]` missing | `notFound()` → stub | new 404 (no code change) |
| `/my-animals/[id]` flag off, missing, deleted | `notFound()` → stub | new 404 |
| `/my-animals/[id]` not yours | `notFound()` → stub | **"en buenas manos" screen** (§3) |
| `/form-results/[id]` not found / not yours | grey `ErrorState` 😕 | `notFound()` |
| `/contract-results/[id]` not found / not yours | grey `ErrorState` 😕 | `notFound()` |
| `/contract/[id]` (client) API 404 | "Animal no encontrado" text | renders `NotFoundView` |
| `/invite/[token]` invalid | specific message | unchanged (D9) |

"Database unavailable" `ErrorState`s are real errors, not 404s, and stay as they are.

## 3. "Belongs to another rescuer" screen

**Access split.** `getAnimalProfile` keeps returning `null` for every denial, so its callers are untouched. When it returns `null`, the page calls a new **server-only** (not `'use server'`, so no new action surface) `getAnimalAccess(animalId, viewerEmail)` in `src/lib/animalAccess.ts`:

```
{ kind: 'missing' }                               → notFound()
{ kind: 'not_yours', animal: { name, species },
  owner: { displayName, orgName? },
  publicUrl: string | null }                      → <AnimalOwnedElsewhere …/>
```

- `missing` = no row, or `deletedAt` set.
- `not_yours` is computed with the same `isOwnerOrOrgMate` + `checkIsAdminAsync` checks `getAnimalProfile` uses. If the viewer turns out to have access (a race, or a transient failure inside `getAnimalProfile`), it returns `missing` rather than showing a wrong "not yours". The pure decision lives in `src/domain/animalAccess.ts` and takes plain inputs: row exists, deleted, viewer is owner/mate/admin.
- `publicUrl` = `${getContractBaseUrl()}/animal/${id}` when `isPubliclyListed` holds, else `null`. `isPubliclyListed` is extracted into `src/lib/showcase.ts` and reused by `/api/showcase/animal/[id]`.
- Failure while building the screen (owner lookup, listing check) → `logger.warn` with `{ animalId, userEmail }`. The page still renders, with the owner block or the link omitted. A failure of the access lookup itself → `notFound()` after logging.
- Every `not_yours` render logs `logger.info('animal page: not owner', { animalId, userEmail })`.

**Component** `src/components/AnimalOwnedElsewhere.tsx`:
- Species illustration: `cat` | `dog` | `bird`, otherwise a name tag showing `animal.name`. The animal name is truncated if long.
- Heading `[name] está en buenas manos`. Body: the record belongs to another rescuer; only they and their group can see and edit it; to ask about the animal, talk to them.
- Owner card: initials avatar, display name, "Grupo: X" line only when `orgName` exists.
- Buttons: when `publicUrl` exists, "Ver la ficha pública de [name]" (primary, new tab, `rel="noopener"`) plus "Volver a mis animales" (secondary). Otherwise only "Volver a mis animales" (primary).
- Unauthenticated visitors are unaffected: the page still redirects to sign-in first.

## 4. Testing

- **Unit (vitest):** the domain access decision (all branches); species → illustration mapping incl. `other`, `''`, `null`, free text; `isPubliclyListed`.
- **E2E (Playwright, bilingual-regex selectors):**
  - unknown URL shows the 404 heading (either variant) and both buttons;
  - a dedicated fixture animal owned by another seeded user, opened by the `user` project: shows owner display name and group, **no email anywhere in the page**, no public link;
  - a second fixture that is listed (available + photo): shows the public link pointing at `/animal/<id>`;
  - owner/admin opening the same fixture still gets the real profile.
- Before claiming done: grep `tests/` for the old "Not Found" / "Formulario no encontrado" strings. Then verify on **staging**: Frido with Jon's account, a dead URL, phone (390) and desktop (1280) widths, measuring for horizontal overflow, in both themes.

## Out of scope

- The public showcase/contract site's own empty states (D1).
- A way to message the owner.
- Merged/soft-deleted adopters redirecting to the surviving profile.
