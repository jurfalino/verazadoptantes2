# Evaluating applicants — design (2026-11-10)

Decision page Jon answered: https://claude.ai/artifact/2mAe1G3bDhAbwfvJe1ghLc (version 3).

## Why

Jon, 2026-11-10: «when I share a form (or contract) the objective is to evaluate someone for an animal adoption.. so if that's a duplicate is not less important but just one more factor to take in consideration».

What the app does today (verified on staging code, v2.58.54):

- A form with no match reaches the rescuer only as a bell notice and a grey «Disponible · N interesadas» line on the animal. Nothing asks them to act. A form with a match surfaces only as «¿Es la misma persona?» in «Pendientes de revisar», so the duplicate question stands in for the evaluation.
- The only action on an applicant is «Enviar contrato» (`ApplicantDetailPanel`, per animal, with «← Anterior / Siguiente →»). There is no way to turn someone down, so an application never ends unless the animal goes to that person.
- Most forms are general (11 of 14 on staging) and cannot be sent a contract at all: `createContractInvitation` is reachable only from an animal's applicant list.
- When an animal is adopted, the other applicants stay open forever and nobody tells them.
- **One live contract link per animal** (`createContractInvitation`, contract.ts:93-102): sending a contract retires every unused link for that animal (`expiresAt = now`), and a link lasts 30 days (`INVITATION_TTL_DAYS`). A retired link answers «Invitation expired». But `hasInvite` (`_applicants.ts`) checks only `usedAt`, so today the panel shows «Reenviar contrato» to people whose link is already dead. (Corrected 2026-11-10 after the builder check; I had told Jon several links could be live at once.)
- **A fostered animal cannot be sent a contract.** The animal page lists its applicants (still looking for a home), but the `adoptions` view takes the adopter from any active placement, foster included, so `createContractInvitation` («Animal already adopted»), `/api/contract/by-token` (410) and `/api/contract/[id]/submit` (409) all refuse it.
- **Every form creates a new profile** (no lookup first), so a person who applies twice is two profiles and a duplicate pair until someone answers «Sí»; the merge then moves both forms onto one profile.
- A form for an animal that is already adopted is accepted like any other.
- Production has had 0 forms, 0 contract invitations and 0 signed contracts (2026-11-10). Staging has 14 forms.

## Goal

Every application is something a rescuer evaluates and **finishes**. The home shows what is waiting, the panel gives what is needed to decide (profile, the answers that need attention, a possible duplicate as one more factor), and each application ends in a recorded outcome.

## Non-goals

- The open contract link (`/contract/{animalId}` from «Compartir» › «Firmar con quien elegiste»), which lets anyone holding it sign and adopt. Separate work (decision 6).
- Contracts as a source of applications: a signature already opens the adoption. What follows a signature (identity, duplicates) stays where it is today (contract results, «Pendientes de revisar»).
- The app writing to adopters. It has never emailed an adopter (only OTP and rescuer notices); decision 4 keeps it that way.
- Changing which questions a form asks, or the colour rules (`answerSignals.ts`).

## Anti-goals

- An application that can never leave the to-do list.
- A «No avanzar» with no rating or no reason.
- The same person shown twice as two to-dos to the same rescuer.
- A second store for «¿Es la misma persona?» answers ([[one shared reality]]: the `duplicate_candidates` pair stays the only record).

## Words

- **Solicitud** (application): one person asking for one animal, or a general one (no animal). Comes from a form; also from «Proponer un animal».
- **Candidatos** of an animal: its applications, as the animal page lists them today (`applicantScope.ts`: the owner's team).
- **Por evaluar**: an application with no outcome yet.
- **Outcomes**: «Contrato enviado», «No avanzó», «Cerrada» (the animal went to someone else), «Adoptó», «Propuesta para {animal}» (general only).

## Decisions (Jon, binding)

Earlier the same day:

- **E1.** «No avanzar» is a **regular observation**, neither good nor bad. It **requires a rating and a reason.**
- **E2.** A possible duplicate is one more factor inside the evaluation, not the to-do. The owners of the other profile keep their say: the pair stays in their «Pendientes de revisar», and an answer from either side is the one answer for everyone (2.58.50 «answer once, cleared everywhere»).
- **E3.** An evaluation ends with «Enviar contrato» or «No avanzar» (general applications: «Proponer un animal» or «No avanzar», decision 2).

From the decision page:

1. **Home rows per animal, in Mis animales.** The animal row's line turns amber: «3 solicitudes por evaluar». Tapping it opens the existing applicant panel over the home, with that animal's candidates to compare. General applications are one row per person in Mis adoptantes: «Julián Torres · Completó tu formulario · hace 3 días».
2. **A general application ends with «Proponer un animal» or «No avanzar».** «Proponer un animal» opens a picker of the team's available animals (those matching the form's «Prefiere» first). The person becomes a candidate of that animal, compared with the others; the general application ends as «Propuesta para Luna».
3. **When the animal is adopted, the other candidates close on their own.** No rating (it says nothing about them). Their history reads «Solicitud cerrada · Luna fue adoptada por otra persona», by «Automático». A rescuer who wants to leave an opinion adds a normal observation.
4. **The app offers to tell them; the rescuer sends it.** Once, right after the adoption: a sheet lists the closed candidates with «WhatsApp» / «Email» per person (whatever contact they left) and a message the rescuer can edit. «Ahora no» dismisses it. Sent from the rescuer's own WhatsApp or mail app, like the contract today. **The message text is Jon's to write.**
5. **A form for an animal already adopted becomes a general application,** shown as «Sofía Díaz · Pidió a Luna (ya adoptada) · hoy», with decision 2's outcomes.
6. **The open contract link is separate work** (non-goal above).

## Behaviour by surface

### Home — Mis animales

- An animal with ≥1 application por evaluar shows the amber line «N solicitudes por evaluar» (1: «1 solicitud por evaluar») instead of its grey status line.
- It takes a slot like an animal with a check-up due (2.58.41: 4 equal slots). When an animal has both, see open question Q5.
- Tapping opens `ApplicantDetailPanel` over the home (like `HomeDuePanel` opens «Para hacer ahora»), with the animal's candidates **por evaluar first**, then the rest, so the rescuer can still compare against someone who already has a contract.
- After an outcome the card reloads (the same `onChanged` pattern as `HomeDuePanel`); the panel moves to the next candidate por evaluar, or closes when none is left.

### Home — Mis adoptantes

- One row per general application por evaluar, using the existing pending-row look (amber icon, name, amber line): «Completó tu formulario · hace 3 días» or, decision 5, «Pidió a {animal} (ya adoptada) · {when}».
- These rows come **before** «¿Es la misma persona?» rows (someone is waiting for an answer).
- Tapping opens the same panel for that one person, with the general footer («No avanzar» / «Proponer un animal»).

### Destination pages (every home count equals the page it opens)

- **Mis animales:** a new tab «Con solicitudes por evaluar» (`?view=solicitudes`), shaped like «Con controles pendientes»: its count equals the sum on the home, and «N animales más con solicitudes» lands there.
- **Mis adoptantes:** general applications por evaluar — **open question Q1.**

### The applicant panel (`ApplicantDetailPanel`)

Unchanged: paging, identity block (rating badge, source pill, date), «Perfil del adoptante» (alerts, «N adopciones · N pedidos», «Abrir perfil»), selfie, photos, map, «Ver formulario completo».

Changed:

- **Possible duplicate:** when the applicant's profile is in a pending `duplicate_candidates` pair, a «Posible duplicado» box inside «Perfil del adoptante»: «Se parece a {name}, cargado por {who}. Coinciden: {fields}.» with `samePerson.yes` / `samePerson.no`, the same answer path as «Pendientes de revisar».
- **Answers summary:** instead of the fixed intent/preference/household lines, the answers that got a red («Atención») or amber («Para conversar») dot (`answerSignal`, `personSignal`), red first, each as «{question}: {answer}». Then «N respuestas sin observaciones · Ver todas», which opens the existing «Todas las respuestas» (`FormAnswersPanel`). «Prefiere» stays at the top for general applications (it is asked only there). A form with no red or amber reads «Ninguna respuesta para revisar».
- **Footer:** «No avanzar» (secondary) + «Enviar contrato» (primary) for an animal; «No avanzar» + «Proponer un animal» for a general application. An applicant with a contract sent shows today's «Reenviar contrato» and no «No avanzar»? — see open question Q2.
- **Outcome line** on an application that has one, in place of the buttons: «Contrato enviado el 9 nov», «No avanzó · 10 nov», «Cerrada: Luna fue adoptada por otra persona», «Propuesta para Luna».

### «No avanzar»

- Opens over the panel: title «No avanzar con {first name} para {animal}» (general: «No avanzar con {first name}»), line «Se guarda como una observación en el perfil de {first name}, como cualquier otra.»
- The first line of the observation is pre-filled and editable: «No avanzamos con su solicitud para {animal}.» (general: «No avanzamos con su solicitud.»).
- **Calificación (1-5)** with the real `StarRating` (size lg, label beside), **required**, not clearable. 1★ shows `import.rating_one_bans`' sentence. **Motivo**, required. «Guardar» stays disabled with «Falta: calificación y motivo» until both are filled.
- Saving writes an `observation` record on the applicant's profile through the existing record save (same visibility, history, notices and team-audience rules as any observation), and ends the application as «No avanzó», pointing at that record.

### «Proponer un animal»

- Picker: the team's animals that can take applications (available, not adopted), those matching the form's species / life stage first, each with «N candidatos».
- Picking one creates an application for that animal (origin «propuesta»), and ends the general one as «Propuesta para {animal}». The person then appears in that animal's candidates, and «Enviar contrato» works as for anyone who applied (`createContractInvitation`'s applicant check must accept it).
- The form answers shown are the person's original form.

### Adoption closes the other candidates

- Adoptions through the **open contract link** are the exception: see Q4 (the signer always arrives as a new profile, so their own application would look like «someone else»).
- When an adoption placement opens for an animal (the single write point, `updateRecord` in `_recordWrite.ts`; callers: the contract submit route and `recordSave`), every application por evaluar or with a contract sent for that animal **from anyone else** ends as «Cerrada», and the adopter's own (if any) as «Adoptó».
- Each closed candidate gets the history line of decision 3. Not a record (no rating, never counts in ratings or flags).
- A **foster** placement does not close anything (the animal is still «Disponible» for adoption).
- The adopter's contract link is used; nobody else's was live (one live link per animal).

### The offer to tell them (decision 4)

- When the rescuer registers the adoption in the app: the sheet opens right after the save, listing the candidates just closed.
- When the adoption came from a contract signature (the rescuer was not there): open question Q3.
- Each person shows the contacts they left on the form (WhatsApp from a phone, Email from an email); the buttons open the rescuer's app with the message pre-filled (as the contract share does). Nothing records whether it was sent; the sheet appears once.

### Forms for an adopted animal (decision 5)

- At submit time, if the selected animal already has an active adoption placement, the application is stored as **general**, remembering which animal was asked for (for the line «Pidió a Luna (ya adoptada)»). It never joins the adopted animal's candidates.

### Duplicates, both sides

- The pair stays in `duplicate_candidates` and in «Pendientes de revisar» for the other profile's owners, unchanged.
- **For the team evaluating the application**, a pair whose side is an applicant por evaluar of theirs is shown inside the evaluation and **not counted** in their «esperan tu respuesta» (home and Mis adoptantes header), so the same person is not two to-dos. Once the application has an outcome and the pair is still unanswered, it counts again. (My proposal, not yet confirmed by Jon — Q4.)

### Notifications

- Unchanged: the bell notice for each form stays. Its link opens the panel for that application.
- No new notices.

## Existing data

- Staging: every form without a contract sent and whose animal is not adopted starts por evaluar; forms whose animal was adopted by someone else start «Cerrada» with no offer sheet. Production has none.

## Production

- `ENABLE_CLEAN_HOMEPAGE` is on in production, so the home cards (and these rows) do not show there. Production rescuers see the work on the destination pages and the animal page. Turning the flag off stays Jon's call.

## Coordination

- A parallel session (worktree `verazadoptantes2-homecards`, branch `feat/home-due-panel`) is changing the same home cards and panels. This work builds on whatever of it has landed on staging and reuses its row and panel patterns (`PendingRow`, `HomeDuePanel`, `homePendingRows`, 4 slots).

## Calls I made (Jon can overrule)

- **An animal with a check-up due and applications** shows the check-up line on the home (care that is overdue comes first, as the card's order already does). Its applications still count in «Con solicitudes por evaluar».
- **Only app forms are applications.** Adoption requests that arrive through the API (e.g. Catpuccino) are not.
- **The `adoption_request` record each form writes stays as it is**; outcomes do not edit it.

## Open questions for Jon (2026-11-10, after the builder check)

- **Q1. Contract sent, then sent to someone else.** Sending a contract to Pedro kills Ana's link (one live link per animal). Recommendation: an application counts as «Contrato enviado» only while its link is live; when it is replaced or expires (30 days), it is por evaluar again, with the line «Su contrato se reemplazó el 10 nov» / «Su contrato venció el 9 dic». And «No avanzar» is allowed on someone with a live contract; it voids their link.
- **Q2. Fostered animals.** Recommendation: they keep taking applications, and the contract works for them (signing ends the foster and opens the adoption). This changes three contract routes. Alternative: leave fostered animals out of this work; their applications then end only with «No avanzar».
- **Q3. The same person applying twice.** Until «¿Es la misma persona?» is answered they are two profiles (the panel shows the duplicate). After «Sí», recommendation: one application per person per animal: the newer form replaces the older one (the older ends «Reemplazada por un formulario más nuevo»), and a general application ends on its own when the same person has one for an animal («Propuesta para Luna» is not used; the line reads «También pidió a Luna»).
- **Q4. The offer to tell the others when the adoption came from a signature** (the rescuer was not there). Recommendation: after an invitation signature, the animal's home row reads «Luna fue adoptada · avisá a 2 candidatos» until they send or tap «Ahora no». After an open-link signature, the others close with the neutral line «Luna fue adoptada» and no offer (the signer may be one of them under a new profile), until the open-link work.
- **Q5. Where general applications live in Mis adoptantes** (the page the home rows open): a «Solicitudes por evaluar» section above «Pendientes de revisar» (recommended), or a filter in «Filtros».
- **Q6. Confirm the duplicate double-count rule** («Duplicates, both sides»).
- **Q7. A returned animal.** If Luna comes back available, the closed candidates do not reopen (recommended); their history keeps «Cerrada», and they can apply again.
- **Q8. The message text** for decision 4.

## Left to the builder

- Storage of application state and outcomes (a table of applications vs. columns on `form_submissions`), the migration and backfill, and keeping `applicantScope` the one rule for «which applications belong to an animal».
- Paging order inside the panel beyond «por evaluar first».
- How the panel is opened from the home (reuse of `HomeDuePanel`'s pattern).
