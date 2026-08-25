# Social platform capture on contact entries

**Goal:** every `contactEntries` entry of `type:'social'` carries which network it is
(`facebook | instagram | tiktok | x | threads | other`). URL ⇒ auto-deduced; free text ⇒ user picks.

## Context / why
Today a social entry is just `{type:'social', value}` — we don't know the network. We want it
captured so profiles show/verify the right platform and links resolve. Confirmed with user: 5
networks + an **"Otra"** fallback; a URL deduces the platform, plain text forces a pick.

## Model + chokepoints (do FIRST — a `platform` field is silently dropped until these change)
- `src/lib/contactEntries.ts`
  - Add `SocialPlatform` type + `SOCIAL_PLATFORMS` (key,label,host,color) + `PLATFORM_LABEL`.
  - Add `platform?: SocialPlatform` to `ContactEntry`.
  - `detectSocialPlatform(value): SocialPlatform | null` — host regex (facebook/fb·me, instagram/instagr.am,
    tiktok, x·twitter·t.co, threads.net·com); null for handles / unlisted URLs.
  - `socialUrl(platform, value)` — return value if URL, else `https://<host>/<handle>` (strip leading `@`).
  - **`deserializeContactEntries` (rebuilds field-by-field):** preserve `platform` when `type==='social'`
    and the value is in the enum; **deduce-on-read** via `detectSocialPlatform` when missing (backfills old rows,
    no migration).
  - `buildContactEntries`: accept `socials: Array<string | {value; platform?}>`; deduce platform when absent.
  - `dedupe` key for social: `social|<normValue>|<platform>` (so same handle on 2 nets doesn't collapse).
- `src/app/actions/validation.ts` — add optional `platform` (enum) to `addContactEntrySchema` & `updateContactEntrySchema`.
- `src/lib/tokenizer.ts` — extend `SOCIAL_PATTERNS`/`extractSocials` to also recognize tiktok/x/threads URLs
  (today only FB/IG) so those become `type:'social'` on ingestion.

## Surface 1 — manual composer (UI) · `src/components/ContactEntriesSection.tsx`
- Composer: add `composerPlatform` state. When `composerType==='social'`, render the picker under the value input:
  on value change run `detectSocialPlatform` → auto-set (green "Detectado", still correctable via pills);
  if null → required pill picker (Facebook/Instagram/TikTok/X/Threads/Otra), **Save disabled until chosen**.
- `buildNewEntry` + server payload (`addContactEntry`) include `platform`. Inline edit row: allow changing platform.
- Display: social chip shows a platform badge; `socialHref` → `socialUrl(platform, value)` so bare handles link.

## Surface 2 — import row editor (UI) · `src/components/ContactEntriesInput.tsx`
- When a row is `type:'social'`, render a platform `<select>` next to the value input; auto-fill from
  `detectSocialPlatform(value)`, **red-outline when unset**. Persist `platform` on the entry in `onChange`.

## Auto-deduce / passthrough (no UI)
- `_adopterFactory` + contract submit (`src/app/api/contract/[id]/submit/route.ts`): `buildContactEntries` deduces
  from the `socialNetworks` string.
- Spreadsheet import: `src/lib/importRow.ts` (column header already implies platform via `domain/importFields.ts`) +
  `importBatch.ts` (create) / `importUpsert.ts` (upsert `addContactEntry`) forward `platform`.
- `POST /api/adopters`, `appendToExistingAdopter`, `saveAdopter` — carry through once the chokepoints above accept it.

## Known lossy paths (call out; not fixed here unless asked)
- `POST /api/adopters/[id]/add-record` (ImportWizard social-URL merge-into-existing) — blob-only, drops structure.
- `mergeAdopters` (`duplicates.ts`) — secondary's structured entries collapse to blob.

## Also update
- `src/lib/walkthroughDemo.ts` social fixtures → add `platform` to stay type-valid.
- i18n es/en/pt: platform labels + "¿Qué red social es?" prompt.
- `contract-app` (optional): keep free-text `socialNetworks` (auto-deduced server-side) OR add a dropdown later.

## Verify
- `npx tsc --noEmit`, `npm run build`, `npm run lint` (≤125).
- Manual: add social by URL (auto) + by handle (must pick) on the ficha; import a row with a tiktok/x URL
  (auto) and a bare handle (red until picked); confirm the chip badge + link; confirm old rows deduce on read.
- Deploy staging-first; no DB migration (platform lives in the JSON contactEntries).
