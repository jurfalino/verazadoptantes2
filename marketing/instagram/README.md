# Buen Adoptante — Instagram launch kit

On-brand launch assets for **@buenadoptante** (rescuer/protectora recruitment).
Extends the app's existing mark (teal shield + white paw, `public/icon.svg`).

## What's here

| File | Use |
|------|-----|
| `content-es.md` | **All copy** — bio, carousel text, captions, hashtag sets, posting plan |
| `generate.mjs` | Generator — one template + all copy → every SVG (edit here, re-run) |
| `profile-image.*` | Profile picture (teal shield + paw on off-white) |
| `logo-lockup.*` | Stacked logo (mark + “VERAZ ADOPCIONES” + tagline), 1080² |
| `carousel-01-cover` … `carousel-07-cta` | **7-slide launch carousel** (pin this) |
| `post-01-hook` … `post-06-cta` | 6 single posts to seed the grid |
| `highlight-quees / como / faq / sumate` | Story-highlight covers (centered for circle crop) |

`.svg` = editable source · `.png` = ready-to-post 1080×1080.

## Regenerate / export

```bash
node generate.mjs                       # rebuild every .svg from copy + template
for f in *.svg; do qlmanage -t -s 1080 -o . "$f"; done   # .svg → .png (macOS)
```
`carousel-01-cover.svg` is hand-authored (mixed-color headline); the rest come from `generate.mjs`.

## Notes

- **Fonts:** SVGs request `Poppins`/`Montserrat`, falling back to `Arial`. The PNGs here are Arial-rendered and fully usable; for pixel-perfect brand type, install Poppins and re-render.
- **Link:** uses `buenadoptante.org` (provisional — swap if the public domain changes; it appears in `carousel-07-cta.svg` and `content-es.md`).
- **No invented stats:** nothing claims figures we can't back up.
- **Colors:** teal `#0f766e` / `#14b8a6`, deep `#042f2e`, off-white `#f2f2f7`.
