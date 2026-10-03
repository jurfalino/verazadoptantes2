# Photo scopes — what a photo is OF, and who gets to see it

Every row in `adopter_images` carries a **`scope`**: what the photo is a
picture of. It decides whether the photo can leave the app.

It exists because `adopter_images.adoption_id` is overloaded — it holds an
**animal** id for the animal's gallery, an **event** id for a timeline entry,
and an **animal** id *again* for photos attached while recording an adoption
from the adopter's side. Once written, no other column tells the first and the
third apart: as soon as the animal is placed, both carry the holder's
`adopter_id`. So each writer states its intent instead.

> **Rule of thumb:** only `animal` is public. Everything else, including a
> photo whose scope was never set, stays inside the app.

Scope answers *which photos* may be public. Whether the ANIMAL is public is a
separate question — `animals.listed`, the rescuer's catalogue switch (2.56.128)
— and both have to say yes.

---

## The four values

| Scope | Generated when… | Shown in… |
|---|---|---|
| **`animal`**<br>*the animal itself* | • Photos added on **«Agregar animal»**, as the animal is created<br>• Photos added from **«Editar»** on the animal's page — including while it is already in a home<br>• These stay the animal's through a devolución | **Public — the animal's adoption page** (`/animal/:id`) and the catalog grid<br>**Public — the shared health record** (`/salud/:token`): cover photo and «todas las fotos»<br>The animal's own page in the app: header, gallery, edit mode<br>The animal's card on **Mis animales** |
| **`placement`**<br>*the handover, not the animal* | • Photos attached while **recording an adopción or tránsito** from the adopter's side (the add-record wizard)<br>• Photos added when **editing an existing adoption record** on an adopter's profile<br>• Typically the signed contract, a document, the family at the handover | **Never public.** Not on the adoption page, not on the health record<br>The adoption record on the **adopter's profile**<br>The record's entry in the animal's timeline |
| **`event`**<br>*evidence for one entry* | • Photos attached to a **timeline entry**: vacuna, desparasitación, consulta veterinaria, castración<br>• Photos attached to a **seguimiento** of the family | The entry they belong to, on the **animal's timeline**<br>**Public — the shared health record**, but only under that entry. Never as the animal's cover photo<br>*(seguimientos are not on the health record at all — they are about the family)* |
| **`null`**<br>*unknown* | • Rows written before the column existed (2.56.124 backfills the ones it can identify)<br>• Photos on an **adopter's own profile**, which hang off no animal and need no scope<br>• A new save site that **forgot to pass one** — see below | Inside the app only. **Treated as not public**, deliberately: a photo of a family shown to strangers is a far worse failure than a photo of an animal a rescuer has to re-add |

---

## Adding a new place that saves photos

`scope` is the 7th argument of `saveImage` and it is optional, so it is
forgettable in the way that hurts: leave it out and the photo saves, looks
right everywhere inside the app, and silently never reaches the public page.
Nothing errors; the rescuer just asks later where their photo went.

`src/app/actions/saveImageScope.test.ts` fails the build in that case. Any
`saveImage` call that passes an `adoptionId` must also pass a scope. Calls with
no `adoptionId` are adopter-profile photos and are not covered by it.

```ts
await saveImage(ownerId, dataUrl, caption, animalId, 'image', false, 'animal');
//                                                                  ^ required
```

## Reading photos on a public surface

Filter on `scope = 'animal'` and drop anything undrawable. Both public readers
do this in one place each:

- `fetchAnimalImages` (`src/lib/showcase.ts`) — the catalog and the adoption page
- `/api/showcase/health/[token]` — the shared health record, which additionally
  loads each entry's own photos by **event id**

A video counts only when it has a poster (`thumbnail_url`). `showableCount`
in `src/domain/animalAccess.ts` is the shared predicate, and it is what keeps
the «Compartir» affordances on **Mis animales** from promising a public page
that would 404.

## History

- **2.56.124** — added the column; backfilled `animal` where unambiguous
  (the `__available__` sentinel, and animal-keyed photos with no caption,
  which only «Editar» writes).
- **2.56.125** — pinning a photo to an animal now requires the right to edit
  that animal; added `event`.
- **2.56.127** — public surfaces play video instead of breaking on it, and a
  posterless video no longer counts as a photo.
