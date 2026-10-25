# «Pendientes de revisar» v2 (layout D): design

**Status:** decided in conversation with Jon, 2026-10-25, after the UX + EM audits of the merge-request work and the D prototype (`prototype/pendientes-cards`, `?variant=d`). Builds on branch `feature/merge-requests-d` = merge of `fix/pending-dedup-dark-contrast` (merge requests, emails) and `prototype/import-match-explain` («Qué coincide y qué no»). **Supersedes** parts of `2026-10-25-merge-requests-design.md` where noted. Not built.

## Why

The UX audit found that accepting a request silently moves your adopter to another rescuer's list, same-name pairs can't be told apart, a declined request is a dead end with four names, and "you need to answer" looks like "you're waiting". Jon also decided the rescuer should choose which profile stays. The other branch's comparison card already answers "same person or not?", so the new section reuses it.

## Decisions

| # | Decision | By |
|---|---|---|
| D21 | Layout **D («Bandeja» + comparison)**: one row per pair, grouped and ordered **Necesitan tu respuesta → Enviados → Rechazados → Posibles duplicados**. The first row that needs your answer opens on load; the section opens itself on `#pendientes` or when such a row exists. This **overrides** the other branch's rule that Pendientes always shows the comparison blocks open with no summary line: in D, rows are closed by default and carry the summary line (the other branch's pattern for 2+ candidates) | Jon |
| D22 | A **closed row** shows: the name (or «A / B», or «A ×2» when equal), the state line («Jon te pide combinar · hace 2 días», «Esperando a María · hace 2 días», «Rechazado por María · hace 1 día», «Tuyo y de María»), and the summary line **«Coinciden: … · Distinto: …»** (the other branch's wording). A hand-flagged pair's summary says **«Marcado manualmente»** (plus any matching fields). **No % for rescuers.** **Admins only** also see the match % on the closed row through the **same gauge icon** as inside the card (hover on a computer; tap shows «N%» next to it on a phone; hidden under «view as»; browser admin = DB role «admin», see D37) | Jon |
| D23 | An **opened row** keeps the state line in its header but **does not repeat the names** there (the other branch's «no repeated names»: each block's title = side, owner, source, date, «Ver perfil ↗»; the name sits in its marked row). It shows: for possible duplicates, the **«¿Cuál se conserva?»** switch («El tuyo · fecha» / «El de María · fecha»); then the «Qué coincide y qué no» card (two blocks, label+icon per value, as decided on the other branch), each block's title also carrying the owner («Tuyo» / «Cargado por María») and **«Se conserva» / «Se suma al otro»**, with the kept block outlined in teal; then one line saying what will happen; then the buttons | Jon (layout), Claude (outline restored per audit) |
| D24 | **The rescuer chooses which profile stays** (supersedes "the older profile always survives", D2/D3/D14 survivor rule). Default selection = the older one. Keeping **the other rescuer's** profile → your profile folds into theirs **immediately** (after D25's confirmation), and they are notified. Keeping **yours** while the other is another rescuer's → a **request** («Pedir combinar»). Same team → immediate either way. Admins choose freely | Jon |
| D25 | **Confirmation** whenever your adopter will move to another rescuer's list (immediate merge or accepting a request): «Este adoptante pasará a la lista de {María}. ¿Combinar?» naming which profile stays, with Combinar / Cancelar | Jon |
| D26 | **The asked owner** (or a teammate, D16) can **Aceptar** (requester's choice of survivor), **flip it** («Conservar el mío» → their own profile stays and the requester's folds in), or **Rechazar**. The owner is notified when a teammate answers | Jon (flip), Claude (owner notice, per audit) |
| D27 | **Declined pairs stay** on both rescuers' lists as «Rechazado por María» (supersedes D4b), with **«Quitar de la lista»** (hides it for that person only) and **«Escribirle a María»**. Either side can still combine from the row later | Jon |
| D28 | **«Escribirle a María»**: a short message box; María gets it in the bell and by email; replying to the email reaches the sender (reply-to = sender's address). The box warns «María verá tu email para responderte». The sender never sees María's address. **Scope (any cross-rescuer pair vs. only after a decline): OPEN — Jon** | Jon |
| D29 | **Visuals**: rows that need your answer are visually distinct (warning tone + «Te piden combinar»); sent rows are quiet grey; secondary buttons (Rechazar, Cancelar pedido, Quitar de la lista, Mantener separados) have a visible outline in both themes and ≥44px tap height | Jon |
| D30 | **One word for declining**: «rechazó» / «Rechazado» on the button, toast, bell, email, admin page and row. The decline notice drops the promise of an admin review and links to the row (`/my-adopters#pendientes`) | Jon |
| D31 | **Same-name pairs are distinguishable everywhere**: emails and the admin list name each profile's owner and date and which one stays («se conserva / se absorbe») | Jon |
| D32 | **Merged-profile redirect** shows a one-line note on arrival: «Este perfil se combinó con otro» | Jon |
| D33 | Kept from today's card: «Ver perfil» (new tab) per profile, «Pedir acceso a quien lo cargó» for hidden contacts, paging (10 pairs per page) | Claude (audit) |
| D35 | **Different name, same contact (B6 consistency with the post import)**: when a pair matches on phone / email / address but the names differ (the import's `needsIdentityChoice` test), combining first asks **«¿Es la misma persona?»** — **«Sí, la misma persona»** → merge as today (the absorbed name is kept as an alias); **«No, es alguien de su hogar»** → the profiles stay **separate** (different people keep their own history and ratings), each is added as a conviviente of the other, and the pair leaves the list. *Proposed by Claude — Jon to confirm the «alguien de su hogar» outcome* | Jon (B6), Claude (Pendientes outcome) |
| D34 | Fixes carried in: the profile banner's «Revisar →» and the list's «Posible duplicado» pill point to `#pendientes` (today a dead `#pending-dedup`); the admin gauge hides the made-up 100% for flagged pairs and pairs rebuilt from a request | Claude |

## Request & merge rules after D24/D26

- A request now stores the requester's chosen survivor (`primary_id`) and the profile to absorb (`secondary_id`) — it no longer assumes the older one.
- Accept → merge with the stored survivor. Flip → merge with the survivor swapped (the asked owner's profile stays); only the asked side (or admin) can flip.
- Every merge still goes through `mergeAdopters` (audit row, undo, merged-profile redirect, closing requests on the absorbed id).
- An immediate merge into another rescuer's profile notifies them (`adopter_merged`).

## Constraints

Same as the earlier spec's Global Constraints (layering, D1 no-IN, logging with errorId, names never emails for non-admins, es/en/pt, theme-safe classes, 390px, action-surface ratchet, `runAfterResponse` for side effects). Plus:
- The «Qué coincide y qué no» card's decisions from the other branch stay binding (two blocks, label+icon only, admin-only gauge inside the card, «También:» line, privacy masking).
- «Escribirle» must not expose the recipient's email to the sender; the sender's email reaches the recipient only through reply-to, after the warning.

## Non-goals

- No rescuer-to-rescuer chat thread (one-off messages only).
- No change to detection or scoring.
- No reminders/escalation.

## Left to the builder

- How «Quitar de la lista» is stored per viewer.
- Exact copy beyond the phrases above (Spanish first, voseo).
- Rate limit for «Escribirle» (suggest ≤ 3 messages per pair per day per sender).
