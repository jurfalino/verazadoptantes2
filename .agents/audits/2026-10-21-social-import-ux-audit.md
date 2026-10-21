# Social-post import (`/import`) — UI/UX audit

**Date:** 2026-10-21
**Surface:** `src/components/ImportWizard.tsx` as of `origin/staging` (v2.56.209), plus its entry points
(`HomeClient.tsx` "Desde un post" button, PWA share target `api/share-target` → `/import?shared_url=…`).
Contacts import (`?contact_import=1`) and `/import/sheet` are out of scope.
**Prior audit:** `2026-09-04-import-wizard-ui-audit.md` — its open items ⑤ (type scale) and ⑥ (split the
2,100-line component) are still open and not repeated here.

## Method

| Evidence | What it covers |
|---|---|
| **Live on staging** (Chrome, signed out, desktop 1854px; "390px" = a same-origin 390px iframe inside the desktop window, measured with `scrollWidth` — not a device or emulator, so touch and iOS focus-zoom were not exercised) | Step 1, step 2, share-link entry, error/retry states, mobile layout of steps 1–2 |
| **Code only** (`origin/staging`, line refs below) | Step 3 (review) and the save/duplicate screen — reaching them needs a signed-in session, and nothing was saved |
| **PostHog** (production, 90 days) | See *Usage evidence* |

Each finding is tagged **[live]** or **[code]**.

## Usage evidence (PostHog)

PostHog has collected since about 2026-09-03 and keeps replays for 30 days. ~40% of `/import` events come from staging, so all
numbers below are filtered to the production host.

- **No external rescuer has used `/import` in production.** All 30 production sessions belong to the two internal
  admin accounts. **Every wizard number below describes our own use.**
- **The only outsiders, 3 anonymous mobile visitors, stopped at the login prompt.** They tapped "Desde un post" on
  the home page. One tapped "Continuar con Google" and never came back. Two were in an Instagram/Facebook-style in-app
  browser, and one of those threw an Android in-app-browser error 27 s later. **Today the drop-off is the login wall, not the wizard.**
  (Sign-in from in-app browsers is a known open problem, shipped in v2.56.149 but never checked on a device.)
- **The share target is the main mobile path:** 16 of 22 mobile sessions. Shared images and contacts were never lost
  (`shared_images_lost` 0).
- **For people who get in, it works:** since 10-03, 12 of 14 social imports completed. Median about 60 s from share to saved. 0 `$exception`.
- **Possible feedback gap at save** (A13): "Verificando…" re-tapped in 6 sessions; "Crear Perfil" logged as a dead click
  in 11/11 mobile sessions; Guardar → done median 8.5 s.
- **Tracking gaps:** nothing records extraction start, success or failure, or error toasts; `import_merged` never reaches PostHog;
  `import_completed` exists only since 10-03; in-app navigation records no pageview. **Until A0 lands, we can't
  measure any drop-off on this flow, including A1–A4.**

Replays: share → completed `01a155c4-048e-76ed-8176-8bad0753dea3`; share → Extract → left (already-imported post)
`01a14b7a-819c-7702-80a4-845a292e1383`; re-tap on "Verificando…" `01a14a5c-591b-750f-9d04-6b8bcafdf8db`.

## A. Defects — fixable without a product decision

Items tagged **design change** alter the flow or layout and need Jon's OK before building. The rest are plain defects.
Ranked by how badly each one blocks a rescuer. PostHog can't rank by frequency yet (see above), which is why A0 comes first.

### A0. Instrument the flow before (or alongside) the fixes **[PostHog]**
Track `import_fetch_failed` / `import_extract_started|succeeded|failed` (with reason and source: share, paste or image),
error-toast `errorId`s, and route `import_merged` to PostHog. Without these, A1–A4 can't be measured, and their
real frequency is unknown. **(S)**

### A1. A shared link that can't be read leaves the rescuer stuck, and "Volver" throws the link away **[live: reproduced via the signed-out 401; per `:645` any fetch error ends the same way]**
**What the rescuer sees:** they share a Facebook post to the app → step 2 opens with an empty text box,
a red error, **no Reintentar**, and "Extraer con IA" disabled. "← Volver" goes to an empty step 1 — the
link they shared is gone, so they have to go back to Facebook and copy it again.
**Why:** the share handler falls back to step 1 with the link pre-filled in a `.catch` (`ImportWizard.tsx:485-490`),
but `handleFetchUrl` catches its own errors and never rethrows (`:645-646`), so the fallback never runs.
Reintentar only renders when the step-1 field has text (`:1246`), and on this path it is empty.
**Fix (S):** on fetch failure, keep the URL in the step-1 field (or return a result from `handleFetchUrl` instead of swallowing).

### A2. Signed-out visitors fill in the whole wizard, then get an English "Unauthorized" **[live]**
**What they see:** `/import` opens without sign-in. They paste, continue, press "Extraer con IA" →
red **"Unauthorized"** (or **"Authentication required"** on the link path), in English, with no sign-in button.
**Who hits it:** every rescuer who shares from the PWA after a deploy that bumps `REQUIRED_SESSION_VERSION`, since that
signs everyone out. Also anyone whose session expired, or who opens a saved link.
The home button guards with `handleAuthNavigation`, the share target does not.
**Why:** `/import` is not in `PROTECTED_ROUTES` (`middleware.ts:61` — `/import/sheet` is).
**Fix (S):** add `/import` to `PROTECTED_ROUTES`. The redirect already carries `pathname + search` as `callbackUrl` (`middleware.ts:143`),
so `shared_url` survives sign-in. Check that shared *images* (held in the service-worker cache) do too.
This touches middleware, so it needs an independent review before production.

### A3. "Reintentar" after a failed AI extraction does nothing **[live: reproduced via the 401; the wiring at `:1250` is the same for any extraction error]**
**What they see:** the error clears, they stay on the same screen, and nothing runs again.
**Why:** the retry button calls `handleSmartSubmit` (`:1250`). That re-does step 1 (go to step 2), not the extraction that failed.
**Fix (S):** retry the operation that failed (fetch vs extract).

### A4. A link pasted together with any text is never opened **[live]**
**What they see:** pasting `Mirá este post https://facebook.com/… quiere adoptar` goes straight to step 2
as plain text. The post is never fetched, so its photos and caption are missing.
**Why:** the link is only fetched when the *whole* field is a URL (`:658`). The share-target route already
pulls a URL out of surrounding text (`api/share-target/route.ts:23-29`). The in-app paste box doesn't.
**Fix (S):** same extraction as the share-target route, keeping the surrounding text as context.

### A5. Step 2 scrolls sideways on phones; the upload control is the browser's raw English one **[live]**
**What they see (390px):** the "Agregar más imágenes" control pokes 16px past the card (`scrollWidth 387 > clientWidth 371`),
so the page wobbles horizontally. It reads **"Choose Files — No file chosen"** in English and is 26px tall.
**Why:** an unstyled `<input type="file" className="">` (`:1542-1548`). Step 1 has a proper dropzone; step 2 doesn't reuse it.
Step 2's preview grid also renders `<img src="">` for videos (`:1553`), while step 1 shows a play tile (`:1314-1319`) **[code]**.
**Fix (S):** reuse the step-1 dropzone and preview tile.

### A6. Pasted text gets an extra screen that only repeats it **[live] · design change**
**What they see:** paste a WhatsApp message → Continuar → the same text again, now labelled **"Texto Extraído"**
(nothing was extracted) → press "Extraer con IA". That's one extra tap and a wrong label on the most direct path.
Step 2 is useful only when a link was fetched (to see and trim the scraped caption and photos).
**Fix (S–M):** when the input is text or images only, go straight to extraction. Keep step 2 for fetched links.

### A7. When the AI misses an adoption, the rescuer can't add it **[code] · design change**
**What they see:** the block with record type, animal, species, rating and date appears only when the AI flagged an
adoption (`:1728`). When it didn't, there is no way to say "this *is* an adoption request", and the save quietly records it
as an `observation` (`:937`).
**Fix (M):** always show the record-type pills, pre-selected from the AI. The animal/rating fields expand when the type needs them.

### A8. Desktop "dropzone" isn't one, and screenshots can't be pasted **[code]**
**What they see:** dragging a screenshot onto "Hacé clic para subir imágenes" opens the image in the browser
and leaves the app. Pasting a screenshot (Cmd/Ctrl+V), the natural way to bring in a social post on desktop, does nothing.
**Why:** no `onDrop`/`onDragOver`/`onPaste` anywhere in the component.
**Fix (S):** add drop + paste handlers that feed `handleImageUpload`.

### A9. Two "Volver" buttons that do different things **[live + code] · design change**
The top "‹ Volver" is `router.back()` (`:1195`). It leaves the wizard, and when the rescuer arrived from the
share sheet there's no in-app history, so it leaves the app. The bottom "← Volver" goes back one step.
The top one is 21px tall at 390px (minimum is 44). **Fix (S):** top control becomes "Cancelar" (to home), or is removed while inside a step.

### A10. On phones, the step indicator is three bare numbers **[live] · design change**
Labels are `hidden sm:block` (`:1219`). At 390px the rescuer sees `1 — 2 — 3` with no meaning, and the
duplicate/confirm screen is an unlabelled fourth step that hides the indicator (`:1210`).
**Fix (S):** show the current step's label under the numbers on mobile.

### A11. Videos over 50 MB are dropped without a word **[code]**
`:682-684` "Skip oversized videos silently". The rescuer believes the video was attached. This also breaks the
"never silently swallow" rule in CLAUDE.md. **Fix (S):** toast with the size limit.

### A12. Language leaks **[live + code]**
- Success toast is hard-coded: **"¡Adoptante Creado!"** + English **"Profile + adoption record created"** (`:989-993`).
- Adoption-confidence pill prints raw `high`/`medium`/`low` (`:1737`). Label suffix `(from facebook.com)` is English (`:1404`).
- 10 inline `locale !== 'en' ? 'es' : 'en'` strings, so **Portuguese users get Spanish** on the video warning, retry countdown, errors and video count.
- Server errors "Unauthorized" / "Authentication required" reach the UI raw (see A2).
- Page `<title>` is "Import Content — BuenAdoptante" in every locale [live].
- Double paw: code renders `🐾` before `t('import.adoptionDetected')`, and that key's value (in the `import` block, es/en/pt) already starts with `🐾` (`:1731-1732`).
- Aside, site-wide: the mobile header login button is hard-coded "Log in" (`UserMenu.tsx:105`) [live at 390px].

### A13. Save feels unresponsive **[PostHog — confirm in a replay first]**
"Guardar Adoptante" runs the duplicate checks before anything appears (`handlePreSave`, `:809-877`). The button
only reads "Verificando…", and rescuers tap it again (6 sessions). "Crear Perfil" is logged as a dead click in every mobile
session. That may be PostHog's detector reacting to the ~3 s save, not a real failure.
**Next step:** watch replay `01a14a5c-…` before deciding whether this needs more than a clearer loading state.

### A14. Small polish **[live]**
- The paperclip icon sits on its own line above "Agregar fotos (opcional)" (`:1288`, an inline icon inside a block label).
- Fake progress creeps to 95% over 110 s for the link fetch (`:133-149`), then the AI step has a bare spinner. That's two waits with different feedback.

### A15. Mobile: step CTAs stick to the bottom of the screen **[requested by Jon 2026-10-21]**
On phones the step's buttons scroll away under long text, photo grids and the review fields. Pin the action row
(Continuar · Volver + Extraer · Volver + Guardar · confirm-screen actions) to the bottom below `md`.
Follow the existing pattern in `FormResultsContent.tsx:400` (`--surface-card`, top border/shadow, `safe-area-pb`), but make
the **same** action row `sticky bottom-0` rather than rendering a second copy. A second copy would break `.first()` e2e selectors.
Also: move the floating chat bubble above the bar while it shows, and keep 44px targets.

## B. Product calls for Jon

| # | Question | Today | My recommendation |
|---|---|---|---|
| B1 | **Where does the rescuer land after saving?** | Post import → **home**; the profile is only reachable via the toast link (`:1021`, `:1176`). Contacts import → **the new profile** (`:1019`). | Land on the profile for both. That's one concept and one outcome (Nielsen #4), and it's where they check what was saved. |
| B2 | **Public by default for link imports?** | Toggle starts **on** (public) for any URL import (`:206`), as a 36×20px switch (`:1650`). It starts off only when Facebook withheld the caption. | Keep it as a decision, but make it a 44px control with a one-line consequence ("Otros rescatistas verán teléfono y redes"). |
| B3 | **Keep "¿Crear nuevo perfil?" when no duplicates were found?** | It's an extra screen that only repeats the name (`:2113-2128`). | Drop it when there are no matches; save directly. Keep it when there are matches. |
| B4 | **Allow saving without a name?** | "Guardar" is disabled with no explanation when the name is empty (`:1927`). Posts often carry only a handle. The spreadsheet import already allows nameless profiles. | Either allow it (as the sheet import does) or say why the button is disabled. |
| B5 | **Duplicate-screen hierarchy** | "Agregar al perfil seleccionado" is purple. The fallback "Crear nuevo perfil igualmente" is the teal primary (`:2092-2105`). Purple and yellow aren't theme tokens. | The recommended action should be the primary. Use theme colours only. |

## C. Carried over from the 2026-09-04 audit and not on staging

The 09-04 audit marked these **fixed**. They are still present in `origin/staging`:
- `blue-*` surfaces (dark-mode unsafe, §5 anti-pattern): step indicator `:1215-1216`, "Compartido desde" badge `:1360-1363`
  [live: it renders blue in Azul Noche], "Seleccionar todo" `:1429`, confirm icon `:1978`, links `:2001`, `:2053`, dropzone hover `:1292`.
- 20px controls (minimum 44px): image remove/expand/select on tiles `:1325`, `:1460`, `:1472`, `:1494`, `:1556`, `:1896`.
- `⤢` glyph as a functional icon (`:1475`).

## D. Duplicate handling (added 2026-10-21)

Checks run: (1) after "Guardar", the post's link is compared to existing profiles; (2) a name + contact match (`findAdopters` duplicate mode) runs both
live on the review screen and again on save; (3) the outcome screen offers **merge** (`add-record` + `appendToExistingAdopter`) or **create**.
Evidence: code on `origin/staging`, plus read-only production D1 counts.
**Scale:** 37 imported profiles in prod, all internal, and 0 exact repeated links. These are **latent risks**, not observed failures.

| # | What the rescuer experiences | Evidence | Fix |
|---|---|---|---|
| D1 | **The same post shared twice isn't recognised** unless the link is character-for-character identical. Facebook `/share/…` links carry a per-share id, and tracking parameters vary. | Exact string compare (`api/adopters/route.ts:72-76`). Fetchers follow redirects but never return the final URL. Prod: 6 of 37 imported links are `/share/` links. | Fetchers return the resolved post URL. Match on a **post id** (FB `posts/<id>` / `story_fbid`, IG shortcode), not on the string. S–M |
| D2 | **A post that was merged into an existing profile is forgotten.** Sharing it again doesn't warn. | The link check reads only `adopters.source_url`. A merge stores the link on the activity and sets the profile's link only when it's empty (`adopters.ts` append, `:73-76`). Prod: **14 activities** carry a link their profile doesn't. | Also check `adoptions.source_url`. S |
| D3 | **Re-sharing an already-imported post pushes "Agregar nueva interacción" as the main action**, which records the same post twice on the same profile. | `:2066-2076`. PostHog: the only mid-flow drop since 10-03 was this exact case (replay `01a14b7a…`). | Say "Ya importaste este post", with "Ver perfil" as the main action. S (wording: Jon) |
| D4 | **A post naming two people blocks the second one.** Once the link matches, the options are add-interaction / view / back. There's no "this is someone else from the same post", and the name + contact check is skipped. Only the first profile with that link is shown. | `:826-829` (early return, `matches[0]`), `:2066-2089` | **Jon's call (B6).** S once decided |
| D5 | **A weak match comes pre-selected for merging.** One tap on the purple button adds the post to a "posible" match. | `setSelectedMatch(matches[0])` regardless of band (`:867`). The sheet import does the opposite: weak matches must be reviewed and are never pre-selected (v2.37.0). | Pre-select only high-confidence matches. Otherwise nothing is selected. XS |
| D6 | **No way to compare before deciding.** Each card shows the name, one sentence and a band. "Ver" opens a new tab, which on a phone loses the wizard. | `:2016-2061`. The sheet import already has the "¿por qué?" panel (`getMatchContext`: what matched, your record vs. what the existing profile has, presence only). | Reuse that panel: same concept, same UI (Nielsen #4). M |
| D7 | **The review-screen hint is a bare count** ("1 posible duplicado") with no name and no action, so the rescuer keeps editing a profile they may end up merging. | `:1694-1708` (by design since v2.16.0-43) | **Jon's call (B7):** show the top match inline with "Agregar a este perfil". |
| D8 | **Merging silently loses or misplaces data.** (a) A different name in the post isn't kept as an alias, although aliases are first-class name tokens. (b) The "Público" switch stays visible and on, but merged contacts always land **protected**. (c) The activity note gets `Contact: <full contact list>` + `Source: <url>` appended. | (a) `handleMerge` sends no name. (b) `mergeContactEntries` carries no `isPublic`, and `:1133` doesn't pass it. (c) `add-record/route.ts:73-77`. That's the "PII in notes" pattern the admin data-quality tool (`dataQuality.ts:18`) hunts for. | (a) **Jon's call (B8)**. (b) Hide the switch on merge, or honour it: S. (c) Stop writing contacts into the note: XS. **Still to check: whether other rescuers see that note unmasked.** If they do, this jumps to the top and needs the independent review. |
| D9 | **We can't tell if duplicate detection is right.** Nothing records that the duplicate screen appeared, its band, or what the rescuer chose. Merges never reach PostHog. | §Usage evidence | Add `import_duplicate_shown {kind: url\|person, band}` + `import_duplicate_choice {merge\|create\|back}`. Fold into A0. |

**Checked and cleared:** the duplicate search can't be used to fish for other people's contacts. Anonymous callers get nothing
(`findAdoptersAction.ts`, since the 10-04 audit), and non-name matches are exact, so the values it returns are the ones the rescuer typed.
**Note for D1:** `source_url` means two things. ~62 manual profiles hold what look like the adopter's own Facebook profile link,
while imports hold a post link. Post-id matching should treat only post links as "same post".

**New product calls (add to B):**
- **B6** · When a link matches, offer "otra persona de este post" → create?
- **B7** · Show the top match on the review screen, not just a count?
- **B8** · On merge, save the post's name as an alias when it differs?
- **B9** · Re-sharing an already-imported post: "ya importado → ver perfil" only, or still allow a new interaction?

## Suggested order

0. **A0** (tracking) ships with the first batch, so the next audit has real numbers.
   The bigger lever for real adoption is outside this wizard: **sign-in from in-app browsers**, where every outside visitor so far was lost.
1. **A1–A4** together: four small fixes that remove dead ends on the main mobile path (sharing a post).
2. **A5, A11**: mobile layout and the silent video drop.
   **A6, A9, A10** (design changes): once Jon OKs them.
3. **A12 + C**: one sweep of i18n and theme compliance.
4. **A8**, then **A7** (design change), with a short design note first.
5. **B1–B5** once Jon decides.

## Decisions (Jon, 2026-10-21)

**Go-ahead:** Batch 1 (dead ends + tracking), Batch 2 (mobile + polish + sticky CTAs), Batch 2b (duplicate fixes).

| # | Decision |
|---|---|
| B1 | After saving (create or merge), land on **the profile**. |
| B2 | Link imports stay **public by default**, with a 44px switch and a one-line consequence. |
| B3 | **Drop** the "¿Crear nuevo perfil?" screen when there are no matches. |
| B4 | A profile **can be saved without a name** if it has **at least one strong identifier** (phone, email, social handle or ID number; an address alone isn't enough). |
| B5 | Duplicate screen: **merge is the main action only for a strong match**. For weak ones nothing is pre-selected and "Crear nuevo" leads. |
| B6 | A post naming several people: **the other people become relatives of the first profile**. *Later phase:* relatives become profiles you can add activities to (see household-members redesign). |
| B7 | Review screen: **show the top match by name, with "Agregar a este perfil"**, not just a count. |
| B8 | On merge, a different name in the post is **saved as an alias automatically**. |
| B9 | Re-sharing an already-imported post: **"Ya importado", with "Ver perfil" as the main action**. "Agregar nueva interacción" stays as a secondary option. |
| 12–15 | Approved: skip the echo screen for text/screenshots · always show record type · top "Volver" → "Cancelar" · step name on phones. |
| 16 | Save feedback: watch replay `01a14a5c…` first, then decide. |
