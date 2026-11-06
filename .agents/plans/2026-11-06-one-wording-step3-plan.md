# One way to ask «¿Es la misma persona?» — Implementation Plan (step 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** design addition 5 (Jon OK'd the prototype `proto-shots/misma-persona`, images `5-hogar-propuesta.png`, `5-pendientes-abierto-propuesta.png`). On every screen where a rescuer answers "same person?", the question, the concept and the two answers read the same. The consequence stays where it is today (the line above the buttons, or the confirmation). The profile bar looks the same for every viewer. The contract screen and the spreadsheet import's Duplicados step move to i18n.

**Spec:** `.agents/plans/2026-11-05-form-matches-are-duplicates.md` § CX addition 5. Inventory: 21 surfaces (subagent, 2026-11-06).

## The strings (one namespace, `samePerson`, es / en / pt)
| key | es | en | pt |
|---|---|---|---|
| question | ¿Es la misma persona? | Is it the same person? | É a mesma pessoa? |
| yes | Sí, es la misma persona | Yes, same person | Sim, é a mesma pessoa |
| no | No, es otra persona | No, it's someone else | Não, é outra pessoa |
| concept_one | Posible duplicado | Possible duplicate | Possível duplicado |
| concept_many | Posibles duplicados | Possible duplicates | Possíveis duplicados |

Buttons that only move on («Crear perfil nuevo igualmente», «Crear un perfil nuevo», «Continuar con el perfil nuevo», «Omitir») keep their words: they answer nothing (consistency rule).

## In scope (the prototype's table: 7 rows, 14 screens)
1. «Pendientes» detected pair (PairRow `group === 'pair'`): main button → yes (merge, request and dispute alike; the explain line above says which). «Mantener separados» → no. The «¿Cuál se conserva?» switch stays.
2. «Pendientes» identity dialog: «Sí, la misma persona» → yes. «No, es alguien de su hogar» stays (a different answer).
3. Shared match card (MatchCardActions): yes / no for every user. The `sameLabel` overrides on the new-profile peek, strip and save modal go.
4. Form results: heading «Perfiles coincidentes ({n})» → concept_many ({n}); banner copy that quotes the button now quotes yes.
5. Contract results page: i18n (es/en/pt) with the same words; heading concept_many.
6. New profile: peek «N posibles coincidencias» → «N posibles duplicados»; strip title → concept_one; save modal title → concept_many.
7. Contact window: title → question; «Unir con este perfil» → yes; «No es esta persona» → no.
8. Household card (and the post import's relatives, which reuse it): title → question, yes / no.
9. Post import person match: title → question; «Agregar al perfil elegido» → yes.
10. Spreadsheet import Duplicados step: i18n. «Actualizar» → yes, «Crear» → no, «Omitir» stays. The confidence badges are translated as they are.
11. Profile bar: the same orange bar for every viewer. «Revisar» shows only for those who may answer (step 2).

## Not in scope (listed to Jon)
The admin screens (duplicates panel, merge requests, disputes), the merge-request answers (Aceptar / Rechazar: they answer a request, not the question), the interview guide (flag off), notification texts and the post-merge «¿No es la misma persona?» prompt.

## Checks
- The e2e suite runs in English: grep `tests/` for every English string that changes before changing it.
- tsc, lint ≤ 125, vitest, build, the affected e2e. Measure a 390 px card: the long «Sí, es la misma persona» must not overflow.
