# «Pendientes de revisar» v2 (layout D): design

**Status:** decided in conversation with Jon, 2026-10-25, after the UX + EM audits of the merge-request work and the D prototype (`prototype/pendientes-cards`, `?variant=d`). Builds on branch `feature/merge-requests-d` = merge of `fix/pending-dedup-dark-contrast` (merge requests, emails) and `prototype/import-match-explain` («Qué coincide y qué no»). **Supersedes** parts of `2026-10-25-merge-requests-design.md` where noted. Not built.

## Why

The UX audit found that accepting a request silently moves your adopter to another rescuer's list, same-name pairs can't be told apart, a declined request is a dead end with four names, and "you need to answer" looks like "you're waiting". Jon also decided the rescuer should choose which profile stays. The other branch's comparison card already answers "same person or not?", so the new section reuses it.

## Decisions

| # | Decision | By |
|---|---|---|
| D21 | Layout **D («Bandeja» + comparison)**: one row per pair, grouped and ordered **Necesitan tu respuesta → Enviados → Rechazados → Posibles duplicados**. The first row that needs your answer opens on load; the section opens itself on `#pendientes` or when such a row exists. This **overrides** the other branch's rule that Pendientes always shows the comparison blocks open with no summary line: in D, rows are closed by default and carry the summary line (the other branch's pattern for 2+ candidates) | Jon |
| D22 | A **closed row** shows: the name (or «A / B», or «A ×2» when equal), the state line («Jon te pide combinar · hace 2 días», «Esperando a María · hace 2 días», «Rechazado por María · hace 1 día», «Tuyo y de María»), and the summary line **«Coinciden: … · Distinto: …»** (the other branch's wording). A hand-flagged pair's summary says **«Marcado manualmente»** (plus any matching fields). **No % for rescuers.** **Admins only** also see the match % on the closed row through the **same gauge icon** as inside the card (hover on a computer; tap shows «N%» next to it on a phone; hidden under «view as»; browser admin = DB role «admin» today; built-in-list admins: open item) | Jon |
| D23 | An **opened row** keeps the state line in its header but **does not repeat the names** there (the other branch's «no repeated names»: each block's title = side, owner, source, date, «Ver perfil ↗»; the name sits in its marked row). It shows: for possible duplicates, the **«¿Cuál se conserva?»** switch («El tuyo · fecha» / «El de María · fecha»); then the «Qué coincide y qué no» card (two blocks, label+icon per value, as decided on the other branch), each block's title also carrying the owner («Tuyo» / «Cargado por María») and **«Se conserva» / «Se suma al otro»**, with the kept block outlined in teal; then one line saying what will happen; then the buttons | Jon (layout), Claude (outline restored per audit) |
| D24 | **The rescuer chooses which profile stays** (supersedes "the older profile always survives", D2/D3/D14 survivor rule). Default selection = the older one. Keeping **the other rescuer's** profile → your profile folds into theirs **immediately** (after D25's confirmation), and they are notified. Keeping **yours** while the other is another rescuer's → a **request** («Pedir combinar»). Same team → immediate either way. Admins choose freely | Jon |
| D25 | **Confirmation** whenever your adopter will move to another rescuer's list (immediate merge or accepting a request): «Este adoptante pasará a la lista de {María}. ¿Combinar?» naming which profile stays, with Combinar / Cancelar | Jon |
| D26 | **The asked owner** (or a teammate, D16) can **Aceptar** (requester's choice of survivor), **flip it** («Conservar el mío» → their own profile stays and the requester's folds in), or **Rechazar**. The owner is notified when a teammate answers | Jon (flip), Claude (owner notice, per audit) |
| D27 | **Declined pairs stay** on both rescuers' lists as «Rechazado por María» (supersedes D4b), with **«Quitar de la lista»** (hides it for that person only) and **«Escribirle a María»**. Either side can still combine from the row later, within D43's rules | Jon |
| D28 | **«Escribirle a María»**: a short message box; María gets it in the bell and by email; replying to the email reaches the sender (reply-to = sender's address). The box warns «María verá tu email para responderte». The sender never sees María's address. Offered on **rejected pairs and on open requests** (sent or received), not on plain possible duplicates. **No rate limit** | Jon |
| D29 | **Visuals**: rows that need your answer are visually distinct (warning tone + «Te piden combinar»); sent rows are quiet grey; secondary buttons (Rechazar, Cancelar pedido, Quitar de la lista, Mantener separados) have a visible outline in both themes and ≥44px tap height | Jon |
| D30 | **One word for declining**: «rechazó» / «Rechazado» on the button, toast, bell, email, admin page and row. The decline notice drops the promise of an admin review and links to the row (`/my-adopters#pendientes`) | Jon |
| D31 | **Same-name pairs are distinguishable everywhere**: emails and the admin list name each profile's owner and date and which one stays («se conserva / se absorbe») | Jon |
| D32 | **Merged-profile redirect** shows a one-line note on arrival: «Este perfil se combinó con otro» | Jon |
| D33 | Kept from today's card: «Ver perfil» (new tab) per profile, «Pedir acceso a quien lo cargó» for hidden contacts, paging (10 pairs per page) | Claude (audit) |
| D35 | **Different name, same contact (B6 consistency with the post import)**: when a pair matches on phone / email / address but the names differ (the import's `needsIdentityChoice` test), combining first asks **«¿Es la misma persona?»**. **«Sí, la misma persona»** → merge as usual (the absorbed name kept as an alias). **«No, es alguien de su hogar»** → both profiles stay **separate** (each keeps its history and ratings); the other person is added as a conviviente **by name only**, **only on the profile(s) the viewer can edit** (own / team); the other rescuer's profile is not touched; the conviviente's **name links to their profile** (household members gain an optional `profileId`; the link follows merged-profile redirects); the pair leaves both lists | Jon |
| D36 | **Duplicate search failure on the new-adopter form** shows «No pudimos buscar duplicados ahora · Reintentar» and is logged with an errorId (Jon's rule: every issue affecting a user is logged) | Jon |
| D37 | **Emails sent from staging are labelled**: subject prefixed «[Staging]» and a visible banner at the top of the email body, so a real rescuer with a staging account can tell it's a test. No allowlist | Jon |
| D38 | **Emails go out in each recipient's selected language** (es / en / pt). The language a person picks in the app (today only in the browser, `localStorage['app-locale']`) is also saved to their account, and emails use it; anyone who never picked one gets Spanish (the app default). Because an email's subject and body are the notification's text, notification texts become translatable: each notification type renders its title/body from es/en/pt templates using the notification's data, instead of a Spanish string fixed when it was created. The bell uses the same templates in the viewer's language (one wording per concept, Nielsen #4) | Jon (emails), Claude (bell follows) |
| D39 | **Privacy**: nothing is hidden from PostHog; the unsubscribe link stays as built. Names stay in emails | Jon |
| D40 | **After your profile folds into another rescuer's** (immediate merge, accepted request or the owner's flip), **you keep seeing that profile's details**: the absorbed profile's owner (and their team) gets an access grant on the surviving profile. The D25 confirmation says «Vas a seguir viendo sus datos». *Amended by the final review (C1):* the grant is `all_contact` only for a consented fold (request accepted or flipped by the owner team, or an admin's merge/approval); an immediate keep-theirs merge by a rescuer (D24/D41/D43) grants only the contact values the absorbed profile brought (`scope='entry'` grants keyed by `hashEntryValue`), so the survivor's own contacts stay masked. A duplicate flag with a target may only be filed by the flagged profile's owner team or an admin | Jon |
| D41 | **Hand-flagged pair, keeping the other rescuer's profile** → immediate (only your adopter moves; consent is needed only when theirs would be absorbed). Refines D14 | Jon |
| D42 | **Other profile has no real owner** (anonymous / system): the switch offers only **«El tuyo»**; the merge goes to the admins as a request (D15). Keeping an ownerless profile would leave the adopter on nobody's list and uneditable by the rescuer | Claude (explained to Jon, not contested) |
| D43 | **After «Rechazado»**: the requester **cannot ask the same owner again** (the row offers «Escribirle» instead), but can still combine **keeping the other's profile** (no consent needed); the person who declined can **change their mind** from their row and accept the original request; admins can approve at any time (D6) | Jon |
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

## Release decisions (not code)

- Version **2.57.0** for this release.
- **Release staging → production first** (production is 28 versions behind), so this work ships and can be rolled back on its own.
- Before building and again before pushing: check `prototype/import-match-explain` for new commits and merge them in; tell that session its branch was merged here.
- Not in this release: contract-results page translation (separate small fix). Admins on the built-in list not seeing the gauge: **not an issue** (Jon).

## Non-goals

- No rescuer-to-rescuer chat thread (one-off messages only).
- No change to detection or scoring.
- No reminders/escalation.

## Left to the builder

- How «Quitar de la lista» is stored per viewer.
- Exact copy beyond the phrases above (Spanish first, voseo).

## Addendum 2026-10-25 — linked convivientes (after staging review of 2.57.0)

Jon on staging: Pedro Paez's household shows «Jonathan Urfalino ↗» (linked via «No, es alguien de su hogar») but (1) no contact data or hint of what Jonathan's profile holds, and (2) Jonathan's profile doesn't show Pedro at all — because D35 never writes another rescuer's profile. Living together is mutual and a household member's record is vetting evidence.

| # | Decision | By |
|---|---|---|
| D44 | **The link shows on both profiles without editing anyone's data.** Links are stored in their own table (`household_links`: host adopter, linked profile, created_by, created_at, hidden_at/hidden_by) written whenever a household member gets a `profileId`, backfilled from existing `household_members`. The linked profile shows a read-only «Convive con: {host} ↗ · según {creator name}» built from it | Jon |
| D45 | **The linked profile's owner and team are notified** when a link to their profile is created (type `household_linked`, category «Cambios en tus perfiles», es/en/pt template) | Claude (proposed, Jon ok) |
| D46 | **A linked conviviente is a live summary, not just a name** — on the host's household card and on the reverse «Convive con» row: rating and flags first (e.g. «★2 · 1 alerta»), then «3 adopciones · 5 registros», then the contact details exactly as the viewer would see them on that profile (full / partially masked / locked — same visibility rules, never more), then «Ver perfil completo ↗». Read live; nothing copied | Jon |
| D47 | ~~Hide «Convive con» on my profile only~~ — **withdrawn** (forks reality); replaced by D48 | — |

## Addendum 2026-10-26 — one shared reality (Jon)

Principle (Jon): BuenAdoptante records **one reality for everyone** — a fact (lives with, same person) is the same for every rescuer. Privacy (who may see contact data) and personal workflow (my list, my email switches) may differ per person; facts may not. Disagreements are resolved (attributed, visible, notified, escalated to admins), never forked.

| # | Decision | By |
|---|---|---|
| D48 | **«No convive» corrects the fact for everyone** (replaces D47): the linked profile's owner/team (or admin) can say the link is wrong → the conviviente is removed from the host's household and the link is removed — on both profiles. Both profiles' history records «{name} indicó que no conviven»; the host's owner is notified. The host's owner may re-add (notifying the linked owner); a link removed and re-added again is a **dispute** → admins are notified to decide | Jon |
| D49 | **After a rejection, nobody merges one-sidedly** (revises D43): the requester's «Combinar conservando el de X» on a rejected pair no longer merges; it becomes «Pedir revisión a un administrador» — a request routed to admins (D15 path) marked as a dispute. The rescuer who rejected can still change their mind and accept | Jon |
| D50 | **An immediate merge can be disputed** (D24/D41): the notice to the owner of the kept profile offers «No es la misma persona» → a dispute admins see in «Pedidos de combinación» («Disputas»), with «Deshacer combinación» (the existing undo) or «Mantener»; both rescuers are notified of the outcome | Jon |
| D51 | **Links follow merges**: when a profile with «Convive con» links is merged, its links move to the surviving profile (and move back on undo) | Jon |
| D52 | **After combining in Pendientes**, the row stays until reload as «✓ Combinados — se conservó {nombre} (de {dueño}) · Ver perfil ↗», and the success toast has «Ver perfil» | Jon |
| D53 | **Local runs never send email** (only staging/production builds stamped by CI do), unless explicitly allowed for a test | Claude (Jon ok) |

## Addendum 2026-10-26 — anyone can add to a household (Jon, after staging review of 2.57.1)

Jon on staging: on Jonathan's profile (owned by another rescuer) he could add contact details but not a household member; and inside Pedro's household, Jonathan's linked card showed his data read-only with no way to add to it. Two data about the same person had two different rules.

| # | Decision | By |
|---|---|---|
| D54 | **Household follows the contact-details model: anyone signed in can add a member, or a contact to a member, on any profile**, credited to them («agregado por X»). They can edit or remove only what they added; the owner's team and admins can change everything (members/contacts with no `addedBy` stay team/admin-only). Same side effects as `addContactEntry`: history `kind='contribution'` (doesn't make them an editor), an entry-level grant per contact they typed (so they see it unmasked; everyone else sees it with the profile's normal protection), the owner's team notified, and the access request auto-filed exactly when `addContactEntry` does. A member they added shows its name unmasked to them. | Jon |
| D55 | **A linked member's card adds contacts to that person's own profile**: «Agregar dato de contacto» on a linked conviviente (host's household card and the «Convive con» row) saves through `addContactEntry` on the linked profile — stored once, same rules. Same composer and layout as any household member (no extra label — Jon, 2026-10-26); the card lists with the members, above «Agregar familiar». The summary refreshes in place. | Jon |
