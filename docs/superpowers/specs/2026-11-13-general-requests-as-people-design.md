# Formularios generales: people, not an animal card — design

Date: 2026-11-13. Decisions: Jon (product owner). Evidence: senior CX review
(`cx-general-requests.md`, summarised below). Prototype (real app CSS):
https://claude.ai/artifact/SvpUVvaNDDA52nTpmopw8R

## Why

A form shared without an animal («formulario general») becomes a request to
evaluate. In production 2.59.11 these requests are effectively hidden:

- Home: a «Sin animal elegido» row inside the «Mis animales» card, only when a
  slot is free — otherwise folded into «N animales más con solicitudes»
  (counted as an animal). The person also shows as a plain profile row in
  «Mis adoptantes». And a bell notice.
- /my-animals: an animal-like card «Sin animal elegido» in the tab «Con
  solicitudes por evaluar», browsed with «Anterior / Siguiente».
- «Proponer un animal» cannot be undone or changed, nothing marks the
  candidate as team-added, and the wording reads as if the person is told
  (they are not).

Only 3 of 46 production rescuers have an animal up for adoption: a general
form is the normal case, not the edge case. Production has received 0 forms so
far, so links can still change freely — ship before the first form arrives.

## Decisions (Jon 2026-11-13)

1. **General requests are people.** They live in «Mis adoptantes»:
   - Home: amber rows in the «Mis adoptantes» card (the existing
     «waiting for you» row pattern), before the «¿Es la misma persona?» rows,
     within the card's 4 slots; overflow as one amber row.
   - /my-adopters: a «Formularios generales» group, FIRST inside «Pendientes
     de revisar», never paginated; the section opens by itself when one is
     waiting; the header count includes them.
   - A request opens alone («← Volver», no «Anterior / Siguiente», no dots).
     Paging stays inside one animal's own candidates.
   - The bell notice, the email and «Cargar un animal»'s return open the
     request alone: `/my-adopters?solicitud=<applicationId>#pendientes`.
2. **«Sin animal elegido» leaves «Mis animales»** — the home card and the
   /my-animals tab — in the same release. Old links
   (`/my-animals?view=solicitudes&animal=general&solicitud=…`) redirect to
   the new one. The tab count counts animals only.
3. **«Formulario general» everywhere** (it is the label the rescuer picks when
   sharing). A request for an animal already adopted reads
   «Pidió a {animal} (ya adoptada|adoptado)» instead.
4. **«Proponer» becomes «Sumar a un animal»**, team-only, **gender-neutral**
   (the form does not ask gender), and **reversible**:
   - «Cambiar animal» and «Quitar de {animal}» on the request and on the
     animal's candidate, **only while nothing happened on the animal's side
     for that person**: no contract link ever issued, the candidacy still open
     (no «No avanzar», not adopted). Otherwise refused.
   - Quitar = the candidacy disappears (it was internal and untouched) and the
     request is back to «por evaluar». No rating or observation is written.
     The person is not told. Adding the same animal again later works.
   - On the animal, the candidate shows who added them: «Sumó {proposer} ·
     formulario general».

## Copy (es — Jon's; en/pt are translations, pt-BR «você»)

| Where | es |
|---|---|
| General title | Formulario general |
| Home row line | Formulario general · por evaluar |
| Home row line, asked an adopted animal | Pidió a {animal} (ya adoptada/adoptado) · por evaluar |
| Home overflow | 1 formulario general más por evaluar / {n} formularios generales más por evaluar |
| /my-adopters group heading | Formularios generales |
| /my-adopters row line | Formulario general · {when} (or «Pidió a … · {when}») |
| /my-adopters row action | Evaluar |
| «Pendientes de revisar» subtitle | Personas que esperan una decisión tuya: formularios generales y perfiles que podrían ser la misma persona. |
| Panel header (single request) | Formulario general |
| Button | Sumar a un animal |
| Sheet title | ¿A qué animal sumás a {name}? |
| Sheet note | {name} queda entre los candidatos del animal que elijas. {name} no se entera. |
| Sheet, no animals | Todavía no cargaste animales en adopción. Cargá el animal y {name} entra en sus candidatos al guardarlo. |
| Sheet, all already | Ya sumaste a {name} a todos tus animales. Cargá otro y {name} entra en sus candidatos al guardarlo. |
| Sheet last row sub | {name} entra en sus candidatos al guardarlo |
| «Agregar animal» note | Al agregarlo, {name} entra en sus candidatos y volvés a su formulario. |
| «Agregar animal» button | Agregar y sumar a {name} |
| Added toast | Sumaste a {name} a los candidatos de {animal}. |
| Status after adding | En los candidatos de {animal} |
| Under it | {name} no se entera. |
| Actions | Cambiar animal · Quitar de {animal} |
| Confirm title | ¿Quitar a {name} de {animal}? |
| Confirm body | {name} sale de los candidatos de {animal} y su formulario vuelve a «por evaluar». {name} no se entera. |
| Confirm button | Quitar de {animal} |
| Undo refused | Ya no se puede: {animal} tiene un contrato o una decisión para {name}. |
| On the animal's candidate | Sumó {proposer} · formulario general |
| Same-person lock hint | Para sumar a {name} a un animal, primero respondé si es la misma persona. |

## Not in scope (CX misses, noted for later)

- The same person showing twice in «Pendientes de revisar» (request + plain
  duplicate pair).
- Old `/form-results/<id>` notices are read-only (no «Evaluar» button).
- The person's own profile does not show that a request waits.
- Whether quitting brings the bell notice back: no (the request reappears in
  «Pendientes de revisar», which is enough).
