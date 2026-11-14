# Group branding on the public pages — design

Date: 2026-11-13 · Status: draft for Jon's approval

## Intent

Rescue groups share two public things with adopters: their **adoption form** and their **animal catalogue**. Today both look generic (dark page, indigo accent, no rescue identity). Groups should be able to make those pages look like *their* rescue: logo, optional banner, colour theme, and links to their Instagram, Facebook and website.

Branding belongs to **groups only**. A rescuer who works alone and wants branding creates a group (Jon, 2026-11-13).

## Goals

1. A group can set: **logo**, **banner** (optional), **theme** (light or dark) + **accent colour**, **Instagram**, **Facebook**, **website**.
2. The group whose branding a user's shared pages carry is the **existing «Al compartir, usar:» choice** in Settings → «Formulario y contrato de adopción» (`user_profiles.adoption_docs_source`). Picking «Los de {grupo}» now means that group's form, contract **and look**; «Los míos» means the user's own form/contract and today's unbranded look. No separate «Grupo principal» setting.
3. The branding shows on every adopter-facing page of the public app (enadopcion.org): form, thank-you screen, group catalogue, personal catalogue, animal detail, contract page.

## Non-goals

- Branding for accounts with no group.
- A free colour picker or custom fonts.
- Branding the rescuer dashboard (buenadoptante.org), notification emails, or the generated contract **PDF**.
- The `/all` catalogue (mixes every rescuer) stays unbranded.

## Anti-goals (failure even if it "works")

- Any combination of theme + accent that makes text or buttons hard to read.
- A page that looks broken or half-styled in the light theme (a stray dark panel, invisible text) — the public pages are the conversion surface.
- One group's branding showing on another group's page, or on someone who isn't a member.
- The form getting noticeably slower, or flashing the default look and then switching to the group's look.

## Decisions (Jon)

- Groups only; solo users create a group to get branding.
- Social links: Instagram, Facebook, website.
- ~~Main group selector in Settings~~ → **merged into the existing «Al compartir, usar:» choice** (Jon, 2026-11-13, after the prototype showed both would ask the same question). Below, «main group» means *the group chosen in «Al compartir, usar:»*.
- Users in **exactly one group** who never made that choice start on «Los de {grupo}» (Jon, 2026-11-13).
- Colour approach **B**: accent colour **plus** a light/dark choice (see Approaches).
- Form arriving from a group catalogue keeps that group's look (if the owner is a member) — delegated to me, see table.
- Contract page: logo + name + accent, stays light.
- A brief loading moment before the form is acceptable.

## Approaches considered

| | What | Trade-off |
|---|---|---|
| A | Accent colour only; pages stay dark | Smallest and safest; doesn't suit rescues with light/pastel brands |
| **B (picked)** | Accent colour + light/dark theme | Fits more brands; every public screen must be made to work in light — roughly 3× the work of A |
| C | Free colour picker with auto-contrast | Exact brand match; bad picks can still look broken in front of adopters |

Jon picked **B**. A is effectively step one of B (the accent part), so B can be built in that order.

## Behaviour

### Group setup (dashboard, `/organizations`)

- Each group card gets a **«Personalizar»** section: logo upload, banner upload, theme (Oscuro / Claro), accent (a row of ~8 swatches), Instagram, Facebook, website, and a small **live preview** of the public header in the chosen theme. *(My call: preview, so people see the result before an adopter does.)*
- **Any member can edit** — same rule as renaming a group today. *(My call.)*
- Everything is optional. A group with nothing set looks exactly like today. Partial setup works (e.g. logo only → logo on today's dark/indigo page).
- Removing a logo/banner is possible.

### Which group a user's pages carry (dashboard, `/settings`)

- No new control. The existing «Formulario y contrato de adopción» section («Al compartir, usar: Los míos / Los de {grupo}») decides it. Its hint copy is updated to say the choice also sets the look (logo, colours, links) — exact wording to Jon.
- `adoption_docs_source` today: `NULL` or `'self'` = own; `'org:<id>'` = that group. New rule for the default: **`NULL` (never chosen) + exactly one group → behaves as that group.** An explicit `'self'` is respected. *(Consequence: an existing single-group user who never touched the setting switches to the group's form/contract too — it only differs if the group customised them. Builder must check how many prod users that affects before release and tell Jon.)*
- If the chosen group stops being valid (user left it / group deleted) → behaves as «Los míos» until they choose again — same as the existing setting does today *(builder: confirm current behaviour and keep it)*.
- «Los míos», or no group → no branding.

### Al cambiar de grupos (Jon, 2026-11-14)

The sole-group default stops the moment she is in two groups, so a join would otherwise switch her links silently. Instead she is **asked when it changes**, and nothing ever switches silently:

- **Join or create a group, ending in ≥ 2 groups** → after success, a dialog «¿Qué formulario y contrato usás al compartir?» with exactly the «Al compartir, usar:» rows (same component, `DocsSourceOptions`: logos, names, look sub-lines, pills), her current choice pre-selected and marked «(el que usás)», the hint «Podés cambiarlo cuando quieras en Configuración.» and one button, «Listo» (saves through `setAdoptionDocsSource`, only if she changed it). Asked on every such join/create, also when she had already chosen (her choice pre-selected).
- **Closing without answering keeps what she had.** So, before the new membership is written, `joinOrganization` / `createOrganization` store a never-chosen (`NULL`) source of a sole-group member as `'org:<that group>'` while `ENABLE_GROUP_BRANDING` is on (`pinSourceBeforeJoin`; audited `adoption_docs_source_changed` with `reason: 'kept_on_join'`; only written while still `NULL`). A failed pin is logged and never fails the join.
- **«Salir» of the group her links used, with ≥ 1 group left** → the same dialog with the groups she still has, her new effective choice (normally «Los míos», since the stored group no longer applies) pre-selected. Closing keeps that. No group left → no dialog.
- **Not asked:** no group; either flag (`ENABLE_GROUP_BRANDING`, `ENABLE_CUSTOM_ADOPTION_DOCS`) off; leaving a group she wasn't using; when someone else removes her from a group (she isn't there to answer — her links fall back as before).
- The server decides (`shouldAskDocsSource`, returned as `askDocsSource` by the three actions). The invite page carries it to `/organizations?askSource=1`, which opens the dialog once and drops the parameter.

### Which branding each public page uses

| Public page | Branding source |
|---|---|
| Form `/form?u={userId}` + thank-you screen | The group of the catalogue the adopter came from (carried in the link), **only if the form owner is a member of it** (checked server-side); otherwise the form owner's **main group** (Jon: «you pick», 2026-11-13) |
| Group catalogue `/org/{slug}` | That group (regardless of members' main groups) |
| Personal catalogue `/user/{handle}` | That user's **main group** |
| Animal detail `/animal/{id}` | The group of the catalogue it was opened from (carried in the link); opened with no group context (`/all`, home featured animals, a direct link) → poster's main group |
| Contract page `/c/{token}`, `/{uuid}` | Rescuer's main group — **logo, group name and accent colour only; the page stays white/light regardless of the group's theme** (Jon, 2026-11-13). The PDF stays unbranded. |
| `/all` | None (the list page itself) |

The group carried in links is a hint, never trusted: a group that the form owner / animal poster doesn't belong to is ignored and falls back to their main group, so nobody can put a group's branding on someone else's page.

The «posted by» group shown on animal cards (`buildPublicRescuer` in `src/lib/showcase.ts`, today an arbitrary one of the poster's groups) follows the same rule.

### What the adopter sees

```
┌──────────────────────────────────────┐
│ [ banner, optional ]                 │
│  (◉ logo)  Gatitos Olivos            │
│            Instagram · Facebook · Web│
├──────────────────────────────────────┤
│  page in the group's theme, buttons/ │
│  highlights in the group's accent    │
└──────────────────────────────────────┘
```

- Header: logo + group name + social links, on form, catalogues and animal detail.
- Thank-you screen after the form repeats the social links (the moment adopters are most likely to follow the rescue). *(My call.)*
- Social links open in a new tab. Only set links are shown.

### Colour

- **~8 preset accents**, each defined with a shade for the dark theme and a shade for the light theme, both meeting WCAG AA contrast for button text and for links on the page background. Swatch names in Spanish (e.g. «Violeta», «Verde», «Naranja»…). Exact values are left to the builder, checked with a contrast tool.
- Theme default: **Oscuro** (today's look).

### Images

- Logo: square, shown in a rounded tile that has its own background, so transparent PNGs read on both themes. Banner: wide (~3:1), cropped to fit on phone and desktop.
- Formats JPG/PNG/WebP; resized in the browser before upload; size cap enforced server-side.
- Stored in the existing public R2 images bucket — logos and banners are public by nature.

## Constraints

- **Public pages live in `contract-app/` (Vite) on enadopcion.org** and read from buenadoptante.org APIs cross-origin. Never move them into the Next app (see memory: public surface on its own domain). Catalogue and animal pages already fetch before rendering, so branding rides on those responses (`/api/showcase/org/[slug]`, `/api/showcase/user/[handle]`, `/api/showcase/animal/[id]`, contract endpoints). The form already fetches the rescuer's settings on load (`/api/form/[userId]`, 3s timeout, rendering the standard form meanwhile) — branding rides on that response; the form now waits for it behind a **brief neutral loading screen** (still capped by the 3s timeout), then renders already branded. *(Corrected 2026-11-13 while planning: the builder check had read an outdated checkout.)* No flash of the default look. (Jon OK'd the loading moment, 2026-11-13.) Server-rendering branding into enadopcion.org is out of scope.
- **Cache lag:** the showcase endpoints are publicly cached (`max-age=60, stale-while-revalidate=600`), so a branding change can take ~10 min to appear on catalogue/animal pages. Accepted; the dashboard preview and the form update immediately.
- **Light theme:** `contract-app/src/petshield.css` defines dark-only tokens on `:root`. The ~143 hard-coded colours in `PetShieldForm.tsx` are almost all inside the option illustrations (fine on both themes); the real gaps, found by the prototype (branch `prototype/group-branding`, `contract-app/src/proto/proto.css`), are hard-coded indigo/dark values in `petshield.css` (`.ps-animal-badge`, `.ps-animal-cta-sticky`, `.ps-showcase-card__photo(-fade)`, `.ps-animal-hero`, `.ps-form-animal__photo--empty`, card hover shadow), the primary-button text colour, and the option check-mark stroke. These must become theme tokens. Every public screen (all form steps, thank-you, catalogue, empty state, animal detail, contract, error states) must be checked in both themes on a phone width.
- D1: no `inArray` / array `IN` — fan out per id.
- i18n: new strings in **es + en + pt** in both apps (dashboard `src/i18n/locales/`, public `contract-app/src/i18n/catalogs`).
- New server actions raise the action-surface ratchet (`EXPECTED_ACTIONS`).
- Errors follow the logging + errorId conventions in CLAUDE.md.
- Ship behind a feature flag (`ENABLE_GROUP_BRANDING`) on staging first. *(My call.)*

## Success

- A group can set logo, colour and links in a couple of minutes from a phone.
- A member's shared form and the group's catalogue look like the rescue's own on a phone, in both themes.
- No readability failures on any public screen in any theme × accent combination.

## Open — needs Jon

None.

## Left to the builder

Column names and storage (group fields; no new user-profile field — reuse `adoption_docs_source`), upload endpoint, the form's branding endpoint and how branding is added to the other public responses, the URL parameter that carries the group, the token mapping for the light theme, the exact palette values, the swatch names, image size limits, link validation/normalisation (accept a handle or a full URL), and the loading screen's look.

## Release steps

Before turning `ENABLE_GROUP_BRANDING` on in production (a D1 write: needs per-call approval; idempotent):

1. Re-run the 0110 «explicit self» backfill, immediately before flipping the flag. Why: `migrate-production`
   applies 0110 before `deploy-production`, and the old build keeps serving (and, through deploy-skew forwarding,
   keeps answering saves from old tabs) until the deploy finishes — indefinitely if e2e fails after the migration.
   In that window the old `setAdoptionDocsSource` still stores «Los míos» as `NULL` (with a `'self'` audit row).
   With the flag on, `NULL` + exactly one group reads as "never chose" → that group's form, contract and look
   would override the explicit choice. The statement, exactly as in `drizzle/0110_group_branding.sql`:

   ```sql
   UPDATE user_profiles SET adoption_docs_source = 'self'
   WHERE adoption_docs_source IS NULL AND user_id IN (
     SELECT u.id FROM user u JOIN audit_log a ON lower(a.user_email) = lower(u.email)
     WHERE a.action = 'adoption_docs_source_changed' AND json_extract(a.details, '$.source') = 'self');
   ```

   ```bash
   npx wrangler d1 execute pet-adoption-db --remote --command "<the statement above>"
   ```

2. Then switch the flag on in Admin → Config.
