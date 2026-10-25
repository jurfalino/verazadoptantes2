# Merge requests between rescuers: design

**Status:** agreed in conversation with Jon, 2026-10-25; reviewer questions answered the same day. Not built.

## Why

"Pendientes de revisar" on /my-adopters lists a possible duplicate whenever the rescuer created at least one of the two profiles. The other profile may belong to another rescuer, but:

- the card never says **who** created the other profile;
- when the rescuer's own profile is the **older** one, "Combinar perfiles" is shown but always fails ("Este perfil lo cargó otro rescatista…"), because a merge never absorbs someone else's profile into yours (`decideDedupMerge`, `src/domain/dedupPair.ts`, reason `other_owner`). The same happens for duplicates **flagged by hand** across two rescuers (`flag_cross_owner`): only an admin can merge those today.

So the rescuer is offered a button that can never work for them, with no way forward except finding an admin.

## Decisions

| # | Decision | By |
|---|---|---|
| D1 | The card shows who created the other profile whenever it isn't the viewer | Jon |
| D2 | **Viewer's profile is newer** (the other rescuer's existed first): the merge happens immediately, as today, and the owner of the older profile is **notified** that it happened | Jon |
| D3 | **Viewer's profile existed first** (the other's is newer): the button becomes a **merge request** to the other profile's owner, who can accept or decline | Jon |
| D4 | On **accept**, the merge runs. On **decline**, the profiles stay separate and the requester is notified | Jon |
| D4b | A declined pair leaves both rescuers' lists (it is resolved as kept-separate) | Claude |
| D5 | Requester is notified of the outcome either way | Claude (agreed) |
| D6 | Admins can approve or decline a request **at any time**, including after the owner declined. Every request shows when it was made and how long it has waited ("Pedido hace 5 días") | Jon |
| D7 | Owner answers from the bell notification, which opens their "Pendientes de revisar"; the pair there says "Jon pidió combinar estos perfiles" with Aceptar / Rechazar | Claude (agreed) |
| D8 | Requester, while waiting, sees "Pedido enviado hace 2 días · esperando a María" instead of the button, and can cancel the request | Claude (agreed) |
| D9 | Admins get a "Pedidos de combinación" list in the admin panel, next to "Acceso a contacto" (/admin/pii-requests) | Claude (agreed) |
| D10 | Duplicates **flagged by hand** across two rescuers use the same request flow (instead of admin-only) | Claude (agreed) |
| D11 | Teammates' profiles count as the viewer's own, as today: no request, the merge just happens | Claude (agreed) |
| D12 | Every notification also goes out **by email**, governed by per-category switches in Configuración (see *Email notifications*). Supersedes the earlier "bell only" | Jon |
| D13 | A merge done through a request can be undone by an admin like any other merge | Claude (agreed) |
| D14 | A hand-flagged pair across two rescuers **always** becomes a request to the other profile's owner, whichever profile is newer: a flag never merges someone else's profile without consent. The older profile still survives | Jon |
| D15 | When the other profile has no real creator (`added_by` null or `'anonymous'`), the request goes **straight to the admin list**; the card says "Pedido enviado a un administrador" | Jon |
| D16 | The other owner's **teammates** can see and answer the request (accept/decline), and are notified with them | Jon |

## Who sees what

Identity follows the existing rule: non-admins see the rescuer's **display name, else the email handle** (`userNameMap[email] || emailHandle(email)`, `src/lib/userDisplay.ts`), never the email. Admin surfaces keep the full email.

| Situation (viewer = rescuer looking at the pair) | Card shows | Button |
|---|---|---|
| Both profiles the viewer's or teammates' | as today | Combinar perfiles (merges) |
| Viewer's profile newer, other rescuer's older | "Cargado por María" on the other side | Combinar perfiles (merges, María notified) |
| Viewer's profile older, other rescuer's newer | "Cargado por María" | Pedir combinar |
| A request from the viewer is pending | "Pedido enviado hace 2 días · esperando a María" | Cancelar pedido |
| The viewer is the one being asked | "Jon pidió combinar estos perfiles · hace 2 días" | Aceptar / Rechazar |
| Hand-flagged pair across two rescuers | "Cargado por María" | Pedir combinar (D10, D14), whichever is newer |
| Other profile has no real creator | "Cargado por un usuario anónimo" | Pedir combinar → admin list (D15) |
| The viewer's teammate is the one being asked | "Jon pidió combinar estos perfiles · hace 2 días" | Aceptar / Rechazar (D16) |

"Mantener separados" (dismiss) keeps working as today in every row.

## Request lifecycle

States: **pending → accepted | declined | cancelled**, plus **admin_approved / admin_declined** (an admin can act from pending or declined, D6).

- **Create** (requester): only when the viewer created one side, and the other side is owned by someone outside the viewer's team, and the normal merge would be refused for ownership. One open request per pair; asking again while one is pending is a no-op.
- **Accept** (the other profile's owner or a teammate of theirs, D16 — never the requester) or **admin approve**: run the existing merge (`mergeAdopters`, `src/lib/adopterMerge.ts`) with the **older profile surviving**, the same survivor rule the card already shows. Notify the requester (D5).
- **Decline** (owner): pair resolved as kept-separate, so it leaves both lists. Notify the requester (D4). An admin can still approve later (D6).
- **Cancel** (requester): request closed, the pair goes back to its normal state with "Pedir combinar".
- If either profile is merged or deleted by some other path while a request is pending, the request closes on its own and nobody can accept it. The merge function already refuses deleted profiles.
- Accept and approve re-check that both profiles are still live and the request is still open (pending, or declined for an admin) before merging, so two people acting at once can't merge twice. They do **not** require the duplicate pair to still be pending, since a decline resolves it (D4b) and an admin may approve afterwards (D6). *(Claude's call.)*

## Notifications (bell + email, D12)

| Event | Recipient | Opens |
|---|---|---|
| Immediate merge in the D2 case | owner of the older (surviving) profile | the surviving profile |
| Request created | owner being asked and their teammates (D16); admins only, when there is no real owner (D15) | /my-adopters, "Pendientes de revisar" |
| Accepted / admin approved | requester (and the owner, when an admin approved) | the surviving profile |
| Declined / admin declined | requester | /my-adopters |

The D2 notice reuses the wording style of `notifyMergeOwners` ("Se unieron dos perfiles: … → …"). Each row also sends an email (see below); the request rows are in the always-on group.

## Email notifications (D12, D17–D20)

| # | Decision | By |
|---|---|---|
| D17 | Configuración gets an **"Avisos por email"** section with one switch per notification category | Jon |
| D18 | Anything that **asks the person to act** always emails and has no switch, shown as "Siempre activo": merge requests to you (and your teammates, D16) and contact-data access requests | Jon |
| D19 | The **API** category only appears for people who have an API key | Jon |
| D20 | Every switch starts **on** | Jon |

Categories, grouping the existing notification `type`s (my grouping, agreed with Jon):

| Category | Types | Switch |
|---|---|---|
| Pedidos que necesitan tu respuesta | merge request to you; `pii_access_request` | always on (D18) |
| Formularios y contratos | `form_submission`, `contract_result`, `form_attached`, `contract_attached` | on/off |
| Duplicados y combinaciones | `adopter_merged`, merge request accepted / declined / approved by admin | on/off |
| Acceso a datos de contacto | `pii_access_revoked` | on/off |
| Cambios en tus perfiles | `ownership_transferred`, `contact_entry_added` | on/off |
| API | `api_record`, `api_access` | on/off, only with an API key (D19) |

Rules:
- The bell is unaffected by the switches; they only govern email.
- Email goes out where notifications are created (`createNotification`, `src/app/actions/notifications.ts` already has the commented hook), sent with the existing Resend helper (`src/lib/email.ts`), in the recipient's language (es / en / pt), with a link to the item and to the settings section.
- Every email carries a **one-click link to turn that category off without logging in** (signed token). Not offered for the always-on group.
- **No flood from bulk work** *(Claude's call)*: imports and API batches create many notifications at once (one API import created 5,740 records). Email must never go out one-per-record in those cases; the builder adds a cap/grouping per recipient and category (e.g. one summary email for a batch).
- Sending failures are logged and never block the action or the bell notification.
- A new notification type must be assigned to a category; an unassigned type defaults to on/off-able "Otros" rather than silently never emailing *(Claude's call)*.

**Sending is in place:** Jon confirmed 2026-10-25 that Resend email from the app works; email login (`ENABLE_EMAIL_OTP`) is on in production. Reuse the same key and sender.

## Admin list (D6, D9)

`/admin/merge-requests`, modeled on `/admin/pii-requests`: one row per request with both profiles (names linking to them), who asked, who owns the other one (full emails, admin surface), the state, **"Pedido el 21 oct · hace 4 días"**, and Aprobar / Rechazar. Pending first, oldest first. Declined requests stay visible with an "Aprobar igual" action (D6).

## Constraints

- Layer rules: who may request, accept, approve and which side survives are pure functions in `src/domain/` (extend `dedupPair.ts`); server actions only fetch and call them.
- New `merge_requests` table via a **hand-written** migration (repo convention); D1-safe queries (no `IN (array)`).
- New server actions need the action-surface ratchet sign-off (raise `EXPECTED_ACTIONS` in the same commit).
- Every new string in **es, en and pt**.
- Errors: logged with context, shown with an error id (`resolveErrorId`), never swallowed.
- UI follows `docs/design-style-guide.md`, works in both themes (only remapped colour classes), and at 390px wide.
- Merges stay undoable (D13): nothing in the request flow may bypass `mergeAdopters`' audit row.

## Non-goals

- No change to how duplicates are detected or scored.
- No change to same-team merges or to admin merges from the duplicates panel.
- No reminders or automatic escalation; admins see the waiting time and decide (D6).
- No digest/scheduling preferences (daily summaries, quiet hours); only on/off per category.

## Left to the builder

- Table columns and indexes for `merge_requests`; whether the dedup candidate row or a flag id is stored as the pair reference.
- Exact copy beyond the phrases above (Spanish first, voseo, matching the app).
- Whether the admin list also gets an entry on the admin home and a count badge.
- Whether this ships behind a feature flag. My call: no flag, since it only changes pairs that are broken today, verified on staging before production.
