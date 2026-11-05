# Homepage modules (2026-11-04)

Approved prototype: https://claude.ai/artifact/9uTeTP8BTfjLCrvrQPAXsP (version 3, after a senior design review).

## What ships

Signed-in users with `ENABLE_CLEAN_HOMEPAGE` **off** see three cards under the search, in place of the action cards. Guests keep the action cards. With the flag on (production today), nothing changes.

- **Mis adoptantes**: «N adoptantes»; amber rows «N pendientes de revisar» (→ `/my-adopters#pendientes`) and «N formularios por revisar» (→ `/my-adopters?filtro=formularios`); the newest 3 people (2 under amber rows), then «Ver los N adoptantes».
- **Mis animales**: «N disponibles · N adoptados»; one amber row per animal with a follow-up due, using the /my-animals badge text (`followupBadgeLabel`), most overdue first. From the third animal on, the second row is «N animales más con controles pendientes» → `/my-animals?view=pendientes` (new tab). Then up to 3 «Disponibles» rows.
- **Posts de redes**: counts **people** («N personas desde posts») → `/my-adopters?filtro=posts` (new «Desde un post» chip). It shows only if the team brought in a post in the last `HOME_POSTS_WINDOW_DAYS` (30). The rows read «Observación · Facebook · hace 3 días».
- **Empty modules** are never cards. They are steps of one «Para empezar» card (no content anywhere) or «También podés» card, which «Ocultar» hides per account (`user_profiles.home_prefs`, migration 0102).

## Rules

- Every count equals the count on the page it opens. Each loader uses that page's own scope: `getOrgMemberEmails` for adopters and posts, `myAnimalsScope` plus `animalFollowupsDue` for animals, and `getPendingDuplicatesForUser().total` for pending.
- «Desde un post» = an observation whose `source_url` is an http(s) link (`isPostRecord`). Both post-import paths write it; spreadsheet and contacts imports leave it empty, and form requests store `form:<id>`. A post added to a profile created by another rescue does not count, because that profile is not on the viewer's /my-adopters.
- Order: cards with something to do, then cards with content; ties go Adoptantes > Animales > Posts (`orderHomeModules`).
- The group chip shows only when the viewer is in 2+ groups, on the card and on /my-adopters alike.
- Contacts import moved into the adopters card («o importá desde tus contactos»), only where the picker works.

## Left for the product owner

- Whether the bulk-import account sees its pending-duplicates count on the homepage.
- «disponibles» vs renaming the /my-animals tabs.
- When to build a list of imported posts and keep failed post links.
- When to turn `ENABLE_CLEAN_HOMEPAGE` off in production.
