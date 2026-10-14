# Adoption form: new topics, ways to ask, and the public-form guidelines

**Status:** draft for Jon's review — 2026-10-14
**Builds on:** `2026-09-29-custom-adoption-docs-design.md` (form settings, `hidden_steps`),
`2026-10-04-household-people-form-step-design.md` (household people, gift flow, phone option).

## 1. Why

Catpuccino's two adoption forms (cats, dogs; ~5,900 applications 2022–2026) show
that **promise questions carry no signal** — 99.9% accept the costs, 99.7% say the
whole household agrees — while **"what would you do if…" questions surface the
honest red flags**: 6–10% would leave or give back the animal if a new home
didn't allow it, 5% name a reason they'd return it, 1–3% have given an animal
away, 5% would let a cat roam the street or roofs. Their forms also ask for
evidence (photos of the protection), which ours never does.

This spec adds those topics, plus seven common vetting topics neither form
asks, and lets each rescuer decide which questions their form asks and how.

## 2. Decisions (Jon, 2026-10-14)

1. Every new question goes in, and **every one can be switched off** by the rescuer.
2. Nothing is removed. "Me comprometo a llevarlo al veterinario" and
   "¿Estás dispuesto/a a castrar?" stay; new questions are added alongside.
3. **A topic can be asked more than one way**, chosen per rescuer — like
   "¿Hay niños?" vs "Personas del hogar" today:
   - closed (options) vs open (free text);
   - for the previous-animal and moving topics, the old question vs the new one.
   Default, when the rescuer hasn't chosen: **closed**, and **the new question**.
4. **On by default:** the "what would you do if…" questions. **Off by default
   (switches the rescuer turns on):** photos, cat-only and dog-only questions,
   Instagram/Facebook.
5. **Production:** none of this reaches applicants until custom forms
   (`ENABLE_CUSTOM_ADOPTION_DOCS`) is switched on — production forms stay as they are.
6. **Semáforo:** as proposed in §5 (red / amber per answer).

## 3. Public-form guidelines (new section for `docs/ux-ui-guidelines.md`)

The guidelines name two personas, both rescuers. The public form serves a third:

- **The Applicant** — someone who wants to adopt, filling the form on a phone,
  often from an Instagram link, once. *Their question: "How do I show I'm a
  good home without this taking forever?"* They are not our user afterwards;
  every screen they abandon is an applicant the rescuer never sees.

Rules for the public form:

1. **One question per screen.** A follow-up that only applies after a specific
   answer appears **on the same screen**, under the answer that triggers it
   (e.g. "¿Están castrados y vacunados?" under a non-zero pet count). It never
   adds a screen.
2. **Answer styles:** big icon cards for 2–4 options that move on when tapped;
   a row of short options for counts and ranges; a switch for a single
   commitment; text fields only for identity, names and open questions.
3. **Options: aim for 5 or fewer.** Six is acceptable only when every option
   means something different to the rescuer (§4: "¿Qué pasó con tu último
   animal?"). Never two options that mean the same thing.
4. **Closed by default, open when the rescuer prefers.** Options are faster on
   a phone and the semáforo can read them; an open answer has no dot. Wherever
   the applicant could describe their situation in their own words, the rescuer
   may switch that question to open text (Jon, 2026-10-14). It stays closed when:
   - the form **branches on the answer** (species → cat/dog questions; intent →
     gift flow; housing type → household wording; pet count → its follow-up);
   - it is a **yes/no fact** ("¿Tenés patio?", allergies);
   - it is a **consent** (visits and follow-up need an unambiguous answer);
   - it is **identity or a count** (name, email, age range, how many pets);
   - it is a **single-promise switch** (vet, special needs).
5. **Ask what they would do, not whether they promise.** A promise gets the
   expected answer from everyone; a situation gets an honest one.
6. **Photos are optional unless the rescuer requires them**, at most 3 per
   question, compressed on the phone before upload, and stored privately like
   the selfie (visible only to whoever may see that form's results).
7. **Length:** a rescuer's default form stays at or under ~30 screens. A new
   on-by-default question must be cheap to answer (one tap) or replace one.
8. **Wording:** voseo; about 8 words per question; never guess the gender of
   someone other than the applicant ("Laura acepta…", not "Laura está
   dispuesto/a…"); "No sé" only where the person answering may genuinely not
   know (the gift flow).

## 4. The topics

Default = what a rescuer who hasn't changed anything gets (with custom forms on).
"Ways to ask" lists the alternatives the rescuer can choose in Ajustes.

### 4.1 From the Catpuccino analysis

| Topic | Question (default way) | Options | Ways to ask | Default |
|---|---|---|---|---|
| Moving | Si te mudás y no aceptan animales, ¿qué harías? | Busco otro lugar que acepte / Lo dejo con un familiar / Lo devuelvo o lo doy / No sé | **this** · old "¿Tenés pensado mudarte pronto?" · open | on |
| Previous animal | ¿Qué pasó con tu último animal? | Sigue conmigo / Murió de viejo o enfermo / Se perdió o escapó / Murió en la calle (atropellado, envenenado) / Lo di o lo regalé / Es mi primera vez | **this** · old "¿Tuviste mascotas antes?" · open | on |
| Gave one away | ¿Alguna vez diste o regalaste un animal? | No / Sí → "¿Por qué?" (text, same screen) | closed · open | on |
| Return reasons | ¿Hay algo por lo que lo devolverías? | No / Alergia / Un bebé / Problemas de conducta / Otro | closed · open | on |
| Rental | ¿La casa es tuya o alquilás? | Es propia / Alquilo y permiten animales / Alquilo y no permiten / Alquilo, no sé | closed · open | on |
| Where it sleeps | ¿Dónde va a dormir? | Adentro / Afuera (+ optional photo, if photos are on) | closed · open | on |
| Current pets' care | ¿Están castrados y vacunados? *(follow-up under a non-zero pet count)* | Sí / Algunos / No | closed · open | on |
| Castration — how | ¿Cómo lo castrarías? *(follow-up under "Sí" to the castration promise)* | Ya está castrado / Con mi veterinario / En una campaña gratuita | closed · open | on |
| Protection photos | Sacá fotos de las protecciones (balcón, ventanas, rejas) *(under "¿El espacio está protegido?")* | up to 3 photos; rescuer chooses optional or required | — | **off** |
| Cats: street | ¿Saldría a la calle o a los techos? *(cats only)* | No / A veces / Sí | closed · open | **off** |
| Dogs: walks | ¿Quién lo pasea y cuántas veces por día? *(dogs only)* | Yo, 2+ veces / Yo, 1 vez / Un paseador / Nadie, tiene patio | closed · open | **off** |
| Social | Instagram y Facebook (opcional) — "Nos ayuda a conocerte y a saber de él después" | two text fields | — | **off** |

### 4.2 Common vetting topics neither form asks

| Topic | Question (default way) | Options | Ways to ask | Default |
|---|---|---|---|---|
| Visits & follow-up | ¿Aceptás una visita o videollamada para conocer dónde va a vivir, y que te contactemos después para saber cómo está? | Sí / Solo videollamada / No | closed | on |
| When it doesn't adapt | Si rompe cosas, se hace encima o no se lleva con tu otra mascota… | Le tengo paciencia o busco un educador / Pido ayuda al refugio / Lo devuelvo | closed · open | on |
| Allergies | ¿Alguien en la casa tiene alergia a los animales? | No / Sí / No sé | closed | on |
| Day-to-day carer | ¿Quién lo va a cuidar día a día? | Yo / Otro adulto de la casa / Un menor | closed · open | on |
| Vet reference | ¿Tenés veterinario? Nombre o teléfono | text (optional) | — | **off** |
| Dogs: tied / alone outside | ¿Va a estar atado, o solo en un patio o terraza? *(dogs only)* | No / A veces / Sí | closed · open | **off** |
| Motivation | ¿Por qué querés adoptar? · ¿Cómo nos conociste? | two text fields | — | **off** |

The four on-by-default topics in §4.2 are "what would you do" or one-tap
questions, in line with decision 4; the rest are switches. **Jon to confirm the
Default column** — it is the one call in this section not already decided.

**Length check** (rescuer with custom forms on, nothing changed): today 23
screens. Adds 9 screens (moving and previous animal replace their old
questions; current pets' care and castration-how are same-screen follow-ups)
→ **32 screens**, over the ~30 guideline. Proposal: fold **Allergies** into the
household screen as a follow-up, and **Day-to-day carer** into the
"Para vos o regalo" screen when the answer is "Para mí" → **30 screens**.

### 4.3 The gift flow

Every new home question about the recipient's home (rental, where it sleeps,
cats street, dogs walks / tied, allergies) gets recipient wording in a gift
("¿Dónde va a dormir en lo de Laura?") and a "No sé" option, as the existing
home questions do. Visits & follow-up, carer and return reasons are about the
giver and keep their wording.

## 5. Semáforo

| Answer | Colour |
|---|---|
| Moving: Lo devuelvo o lo doy | red |
| Moving: Lo dejo con un familiar | amber |
| Gave one away: Sí | red |
| Previous animal: Se perdió o escapó / Murió en la calle | red |
| Return reasons: any reason | amber |
| Castration promise: No | red (new — the promise has no dot today) |
| Cats: street Sí | red · A veces → amber |
| Where it sleeps: Afuera | amber |
| Rental: Alquilo y no permiten | amber · Alquilo, no sé → amber |
| Visits: No | red · Solo videollamada → none |
| When it doesn't adapt: Lo devuelvo | red |
| Dogs tied / alone outside: Sí | red · A veces → amber |
| Day-to-day carer: Un menor | amber |
| Allergies: Sí | amber |
| Any "No sé", any open answer | no dot |

Red marks a likely dealbreaker, amber something to talk through (unchanged
meaning, `src/domain/answerSignals.ts`). The gift-flow "No sé" never gets a dot.

## 6. Settings (Ajustes → Formulario y contrato)

Each topic is a row in its group, like today's questions:

- **The switch** asks or stops asking it.
- **"Cómo preguntar"** (when the topic has more than one way): a small choice
  under the row, like "¿Hay niños? (simple) / Personas del hogar (detallado)".
- **Photos:** "Pedir fotos" switch under "¿El espacio está protegido?", and
  under it "Obligatorias" (like the phone's "Obligatorio").

The counter ("El adoptante responde N de M preguntas") counts topics, not ways
to ask, and never counts follow-ups.

### 6.0 Which questions offer "Cómo preguntar" (open vs closed)

Applying §3 rule 4 to every question — existing and new:

| Offers open text | Stays closed (reason) |
|---|---|
| **Existing:** ¿El espacio está protegido? · ¿Cuántas horas al día estaría solo? · ¿Tuviste mascotas antes? (old way) · ¿Estás dispuesto/a a castrar? · ¿Tenés pensado mudarte? (old way) · ¿Qué harías en vacaciones? | **Branches the form:** ¿Qué animal buscás? · ¿Es para vos o un regalo? · ¿Dónde vivís? (casa/depto) · ¿Tenés mascotas? (count) · ¿Hay niños? / Personas del hogar |
| **New:** Moving · Previous animal · Gave one away · Return reasons · Rental · Where it sleeps · Current pets' care · Castration how · Cats: street · Dogs: walks · When it doesn't adapt · Day-to-day carer · Dogs: tied | **Yes/no fact:** ¿Tenés patio? · Allergies |
| | **Consent:** Visits & follow-up · Términos |
| | **Identity / count / preference:** name, email, phone, address, age range, ¿Qué edad preferís?, location, selfie |
| | **Single-promise switch:** veterinario · necesidades especiales |
| | **Already free text:** Vet reference · Motivation · Instagram/Facebook · "¿Para quién es?" |

An open answer is stored as text under the same answer key, shown as text on
the form screen with no dot, and stripped of its options on the public form
(the applicant sees a text box with the same question). Switching a question
between ways never rewrites past submissions — each keeps what it asked.

### 6.1 Storage

All of it stays in `adoption_doc_settings.hidden_steps`, compare-and-swap per
key as today, so teammates' edits keep merging question by question:

- a step id → that question is **not** asked (today's meaning);
- `on:<id>` → an **off-by-default** question **is** asked;
- `way:<id>:<way>` → this question is asked that way (`open`, or `old` for moving and previous animal); absent →
  default (closed, new question);
- `photos-required` → protection photos required (only meaningful with `on:protectionPhotos`).

Old rows need no migration: no token means "default", which for every new
on-by-default question means asked, and for every existing question means
unchanged.

### 6.2 Production stays as it is

Today the public form gets no settings at all (`formConfig: null`) whenever the
rescuer hasn't changed anything — even with custom forms on. That now has to
mean two different things:

- **custom forms off** → `formConfig: null` → the form asks exactly today's
  questions (none of this spec's);
- **custom forms on, nothing changed** → `formConfig: { hiddenSteps: [] }` →
  the defaults of this spec.

`resolveDocsForRescuer` returns the defaults when the flag is on and there is no
settings row (or an empty one) instead of `null`. The contract-app treats a
`null` config as "today's form".

## 7. Where answers show up

- **Form screen and the animal's applicant panel:** each answer in "Respuestas
  completas" with its dot, grouped like today; open answers as text; the
  "¿Por qué?" under "Sí, regalé un animal" right beside it; photos as
  thumbnails that open full size (private, like the selfie).
- **Profile:** Instagram/Facebook become social contact entries on the
  applicant's profile — they feed duplicate detection. Nothing else is copied
  to the profile; the vet reference stays on the form (it's a third party).

## 8. Testing

- **Unit:** each new answer's semáforo rule; the settings tokens (sanitiser keeps
  `on:`/`way:`/`photos-required`, drops unknown ones; per-key merge keeps them);
  `formStepsToAsk` for null config vs empty config vs tokens; gift wording and
  "No sé" for the new home questions; mirror test for the new step ids.
- **E2E:**
  - custom forms off → the public form config is `null` and none of the new
    questions are asked;
  - on, nothing changed → the on-by-default questions are asked, the switches aren't;
  - a rescuer turns on protection photos (required) → the applicant can't
    continue without 1 photo; the photo opens for the rescuer and not for a stranger;
  - "Cómo preguntar" → open turns a topic into free text, with no dot on the results;
  - Instagram given → a social contact on the profile.

## 9. Delivery

Three releases, each useful alone:

1. **Closed questions + switches + semáforo + display** (§4 without photos and
   without "Cómo preguntar"), and the guidelines section (§3).
2. **Photos** (protection, where it sleeps).
3. **"Cómo preguntar"** (open/closed, old/new per topic).

## 10. Out of scope

- Questions that carry no signal in Catpuccino's data: whether the household
  agrees, affording costs, losing a job, food brand, "¿y si no tiene el
  carácter que esperabas?".
- Contacting the vet reference automatically.
- Separate cat and dog forms: one form, with species-only questions (§4).
