# Research: customizable adoption forms and contracts

2026-09-28. This is the input to the design of per-user and per-group form and contract customization:
- **Form:** turn predefined steps on or off.
- **Contract:** edit the text of sections 2, 3 and 4.

It has three parts:
1. How the form and contract work in the code today.
2. How real adoption forms and contracts are built, in Latin America, Spain, Brazil and the US.
3. What that means for this feature.

Claims marked **[Inference]** are our reasoning, not something a source states. Counts such as "7/8" come from a small sample of real documents, not from a statistic.

---

## Part 1: How the form and contract work today

### Where things live

- **The public app.** The form, the contract, the terms page and the public showcase all live in `contract-app/`. This is a separate Vite app, deployed to its own Cloudflare Pages project (`adoptions`, `adoptions-staging`) by `.github/workflows/contract-app.yml`.
  - It deploys **independently** of the Next app and has no deploy-skew guard.
  - Every API change must work in both deploy orders.
- **Where the text comes from.** All form and contract text is bundled into that app. None of it comes from the DB. Nothing is customized per user or per group, and nothing is versioned.
- **Keystatic is gone.** It was removed (CHANGELOG ~7552). `content/adoption-contract/index.json` and the legacy `src/app/contract/[id]/page.tsx` are dead copies; the legacy page is already broken because it posts no document. CLAUDE.md is out of date on this.

### The form (`contract-app/src/PetShieldForm.tsx`)

The steps are the hardcoded `DEFAULT_SCHEMA` (lines ~337-505). There are 23 of them, in this order:

| # | id | Downstream use |
|---|---|---|
| 1 | `legal` | Terms consent. **Must stay on** |
| 2-4 | `species`, `lifeStage`, `specialNeeds` | Stored in their own columns. Already dropped for per-animal forms (`ANIMAL_QUESTION_STEPS`) |
| 5 | `intent` | Stored in its own column |
| 6-16 | `children`, `existingPets`, `housingType`, `hasOutdoor`, `isSafe`, `hoursAlone`, `petExperience`, `willingToSterilize`, `vetCommitment`, `movingPlans`, `vacationPlan` | Display only (answers panel, results screen, prefill notes). No scoring or flags read them |
| 17-20 | `identity-name`, `identity-email`, `identity-phone`, `identity-address` | Adopter record, dedup tokens, duplicate candidates. **Must stay on.** The server rejects a submission without name or email |
| 21 | `ageRange` | Display only |
| 22 | `geo` | Latitude and longitude on the submission |
| 23 | `selfie` | Stored in R2, optional |

**How it's tied to a rescuer.**
- The link is `…/form?u=<users.id UUID>[&animal=<id>]&lang=`, built in `src/components/ShareFormMenu.tsx:35` and in the public showcase "Adoptar" button.
- The owner is always one user, never a group.
- `GET /api/form/[userId]` exists but the public app never calls it. It is the natural place to deliver form configuration.

**How submissions are stored.**
- In `form_submissions` (`schema.ts:599-636`). The raw answers go in `answers_json`.
- No step list, version or locale is stored.
- `special_needs` is written as `body.specialNeeds ? 1 : 0`, so **a hidden step becomes a "no"**.
- `buildDetailedDescription` (`src/app/actions/formSubmission.ts:24-54`) then writes "No busca animales con necesidades especiales" into the adoption request. This already happens on every per-animal form.

**Behaviour that breaks once steps can be turned off:**
- **Auto-submit.** Icon-card and segmented steps advance as soon as an option is tapped. On the last step, that tap submits the form.
- **Draft restore.** The draft lives in the global localStorage key `petshield_draft` and is restored **by step index**. It is not scoped to a rescuer or an animal.

**Who reads submissions:**
- `/form-results/[id]`, which checks the owner only, so group-mates are blocked.
- `FormAnswersPanel`, which skips keys that are absent.
- The applicants panel (`applicants.ts`), again owner only.
- Adopter prefill and linking (`formSubmission.ts`).
- Admin orphan retry, dashboard counts, deletion.

### The contract (`contract-app/src/i18n/contractContent.ts`)

This one TS module feeds both the screen (`ContractPage.tsx`) and the PDF (`contractPdf.ts`).
- `es` is authoritative.
- `en` and `pt` are drafts waiting for legal review (`.agents/plans/contract-app-localization.md`).

| Part | Content | Editable in this feature? |
|---|---|---|
| Header + intro | Title; "En la localidad de {locality}, a los {day}…" | No |
| Parties | Adopter's details (typed by the signer); rescuer name | No |
| 1. Datos del animal | Filled from the animal record | No |
| **2. Compromisos del adoptante** | Intro + 5 clauses: Bienestar y trato, Salud, Esterilización, Seguridad (gatos), Uso utilitario | **Yes** |
| **3. Seguimiento y no abandono** | 2 clauses: Seguimiento, Prohibición de cesión | **Yes** |
| **4. Incumplimiento y protección animal** | 2 untitled clauses | **Yes** |
| 5. Consentimiento de datos y registro | Consent to the shared registry. This is legally load-bearing for BuenAdoptante itself | No |
| Signatures | Typed names and ID number | No |

- **Structure.** Sections are `{ title, intro?, clauses: { title?, body }[] }`, and rendering already loops over them.
- **Numbering** is part of the title strings.
- **No placeholders.** Sections 2 to 4 contain none.

**Who the contract belongs to.** The rescuer is resolved from the **animal's `addedBy`**. This holds both for the open link `/{animalId}` and for the locked invitation `/c/{token}`, where the invitation is created by the owner or a group-mate.

**What is stored when someone signs:**
- Only a PDF or PNG generated in the browser, uploaded to the fixed key `contracts/{animalId}/signed-contract.ext`. Signing again overwrites it.
- Its URL goes into the placement's `comments`.
- **No text, version, locale or hash** is stored.

### Groups, users and settings

- **Groups.**
  - Tables: `organizations`, `org_members` (keyed by **email**, `role` 'owner' | 'member'), `org_invites`.
  - A user can belong to many groups.
  - **The role is never enforced.** Any member can rename a group, invite people, or delete it by being the last one to leave.
  - `src/lib/orgMembership.ts` treats the group as the trust boundary.
- **Users.**
  - `user_profiles` is keyed by `user.id`.
  - The precedent for per-user settings is the JSON column `followup_settings`: zod-parsed, NULL means defaults (`src/domain/followups.ts`).
- **Settings page.** `/settings` (`src/app/settings/page.tsx`) is a stack of cards, each with its own Save button. `FollowupSettingsSection.tsx` is the template to copy: flag-gated, a local draft, saves null when the draft equals the defaults, and a "Restaurar por defecto" button.
- **Feature flags.** A flag visible to the public app must be added to `PUBLIC_FLAG_KEYS` and `PUBLIC_FLAG_DEFAULTS` (`src/lib/publicConfig.ts`); the public app reads `/api/config`. Also register it in the admin config page, the admin config API, and the i18n labels for es, en and pt.
- **Migrations** are hand-written. The next one is `drizzle/0069_*.sql`.

### Current test coverage

- **No test renders the public app.**
- `tests/forms.spec.ts` and `tests/contract-link.spec.ts` hit the APIs directly.
- The step logic, PDF generation, the invitation-token path and the applicants panel are all untested.

---

## Part 2: How real adoption forms and contracts work

Sources: 8 forms and 7 contracts read in full (Mexico, Colombia, Spain, Argentina, Chile, Brazil, US, UK), laws and legal commentary, and the documentation of 6 software products. Full links are at the end.

### Forms

**The stable core, present in every form:**
- identity and contact (8/8)
- household members, and whether everyone agrees (8/8)
- current pets (8/8)
- reason for adopting (8/8)
- housing type (7/8)

**Where rescuers disagree,** which is what they would want to toggle:

| Step | How common | Tension |
|---|---|---|
| Landlord / ownership permission | 5/8 | Adopters Welcome removes it; the Ohio study found no change in how often pets were kept |
| Financial readiness / income | 7/8 | Ranges from "monthly income and employer" (CO) to nothing (US) |
| Hours alone | 6/8 | "No full-time workers" rules are listed as a barrier |
| Home-visit / follow-up consent | ~4/8 | Near-universal in Latin America; called "intrusive" by Adopters Welcome |
| Sterilization of current pets | 4-5/8 | Rosario requires it; Adopters Welcome argues against it |
| Vet reference / personal references | 1/8 each in Latin America | Common in US forms, rare in Latin America |
| Photos of the home / ID upload | 2/8 | Mostly cat rescuers, as proof of nets |
| Social media handle | 3/8 | Informal vetting. Relevant to BuenAdoptante's lookups [Inference] |

- **Nets are species-specific.** Window and balcony nets are near-universal among **cat** rescuers (4/5 cat forms; often a hard requirement: "redes en TODAS las ventanas", "no damos gatos para casas"). They belong in a cat-specific step, not a free toggle.
- **Adopters Welcome position** (Humane World for Animals, 2025; ASPCApro; HASS; Weiss et al. 2014):
  - long, intrusive applications drive away low-income and minority adopters;
  - landlord, vet, fence and home-visit checks don't improve how long animals stay in their homes;
  - "call it a questionnaire, not an application".
- **[Inference] Our users are different.** They are Latin American individual rescuers doing lifelong follow-up, which is the opposite of the US high-volume shelter. That argues for letting each rescuer choose, starting from a short default.

### Contracts

**Near-universal clauses:**
- parties
- identification of the animal
- general care
- vet care and vaccination
- a sterilization commitment
- no sale, gift or abandonment
- a duty to notify changes (address, loss, death)
- follow-up
- a right to reclaim on breach (7/7)
- signatures

**Clauses that vary by group:**
- **Sterilization:** deadline (3 months, 6 months, "at maturity") and who pays.
- **Follow-up schedule:** visits every 1 to 2 months for six months, only the first month, or lifelong.
- **When the adopter can't keep the animal:** return it to the rescuer, or keep it until a new home is found. One contract has the adopter paying 3 months of boarding.
- **List of prohibited uses.**
- **Fee or donation.**
- **Liability.**
- **Special conditions**, such as health disclosure.
- **Jurisdiction.**

**[Inference]** Many of these are really numbers or choices, not prose.

**Fit with our sections 2 to 4.** Our editable sections map onto exactly these clauses:
- Section 2 covers care, health, sterilization, cat safety and prohibited uses.
- Section 3 covers follow-up and no-transfer.
- Section 4 covers breach and reclaim.

Sections 1 (the animal) and 5 (data consent) are the part everyone agrees on or that the law requires.

### Legal notes (brief; not legal advice)

- **Argentina.**
  - The contract is treated as a *donación con cargo* (CCyC arts. 1562, 1569, 1570), revocable when a condition is breached, after formal notice.
  - **Ley 14.346** punishes mistreatment and cruelty. The text mentions abandonment only for animals used in experiments.
  - Under **Ley 25.506 art. 5**, whoever relies on a simple e-signature must prove it, so an audit trail matters.
- **Spain.**
  - **Ley 7/2023 art. 58**: only public centres and *registered* entities may do an "adopción". A private individual does a **cesión**, which must be free.
  - A draft regulation (June 2025, approval not confirmed) sets the minimum clauses.
  - Case law: Ferrol 2010, Granada 2008 and 2019. Contracts have been revoked, with compensation, when adopters blocked follow-up.
- **Brazil.**
  - *Doação com encargo* (CC art. 553).
  - Mistreating dogs or cats carries 2 to 5 years in prison (Lei 14.064/2020).
  - A document signed by 2 witnesses, or with a certified e-signature, can be enforced directly.
- **Chile.** Under Ley 21.020, the government template also obliges the *rescuer* (a follow-up visit in month 1) and sends disputes to the Juzgado de Policía Local.
- **US and UK.** "Seize without notice" and "love the dog" clauses are probably unenforceable.

### How existing software handles this

| Product | Form | Contract | Signed record |
|---|---|---|---|
| Shelterluv | Default questions you can edit, plus custom ones | "Four basic policies" plus per-animal disclaimer text | Digital signature, emailed |
| Petstablished / RescueGroups / Adopets | Fully custom builders | Custom contracts (Petstablished) | E-sign |
| Animal Shelter Manager | — | Templates with merge tokens | **A signed document is read-only, and a hash is stored to detect tampering** |

- **[Finding]** No product we found offers a curated set of steps with on/off toggles, or lets a volunteer choose between their group's template and their own. That combination would be new.
- **[Inference]** The strongest precedent to copy is ASM's rule: never re-render a signed contract from the live template.

### Pitfalls

1. **The text changes after signing.** Keep an immutable snapshot of what was signed: template version, locale, a hash, timestamp and signer.
2. **Free-text legal risk.** The real documents we read already contain:
   - ambiguous duties;
   - "seize without notice" clauses;
   - misstatements of the law;
   - clauses that are illegal for that kind of signer, such as a fee in a Spanish private *cesión*.

   **[Inference]** Keep section 5 and the structure locked, mark rescuer-edited sections visibly, and make clear in settings that the rescuer is responsible for their own text.
3. **Form length.** Longer forms lose people. The data comes from generic web forms, used here only as an analogy. The defaults should stay short.
4. **Sensitive data.** Income, health and ID fall under GDPR/LOPDGDD, Ley 25.326 and LGPD. Any future steps that collect them would need their own consent text.

---

## Part 3: What this means for this feature

1. **Turning off a step must mean "not asked", never "answered no".**
   - Submissions should record which steps were shown.
   - A missing yes/no answer should be stored as null.
   - This also fixes the false "No busca animales con necesidades especiales" line on today's per-animal forms.
2. **Locked steps:** `legal`, identity name, email, phone and address. **Locked contract parts:** header, parties, section 1, section 5, signatures.
3. **A signed contract must record exactly what was signed.** Store the template version (or "default"), the locale and a hash, on the server, at signing time.
4. **The form must stop auto-submitting,** and drafts must be scoped to the rescuer and the animal and restored by step id.
5. **Who may edit a group's settings is a product decision.** Nothing enforces group roles today.
6. **Custom contract text is written in one language,** but links carry `lang=es|en|pt`. How to handle that is a product decision.
7. **With no customization saved, everything must stay identical to today.** Lock that promise with unit tests first: no test covers the public app, so those tests are the only safety net.
8. **Later, not in this feature:**
   - new steps (landlord permission, vet reference, home photos, social handle, cat nets);
   - fill-in-the-blank clauses (months to sterilize, follow-up cadence);
   - country-specific versions;
   - group-mates seeing applicants;
   - the contract file that is overwritten when an animal is signed again.

---

## Sources

**Forms:**
- APASDEM (MX): https://www.apasdem.org.mx/wp-content/uploads/2021/01/SOLICITUDDEADOPCEne212021.pdf
- Fundación AnimalSafe (CO): https://www.fundacionanimalsafecolombia.org/wp-content/uploads/2021/04/FORMULARIO-DE-ADOPCION.docx
- Fundació Silvestre (ES): https://fundaciosilvestre.org/formulario-cuestionario-de-adopcion-1
- El Refugio de Lluna (ES): https://www.refugiodelluna.com/formulario-de-adopcion/
- Proyecto Gatitos (AR): https://proyectogatitos.com.ar/formulario
- Felis Catus (AR): https://www.feliscatus.com.ar/pre-adopcion/
- Jotform: https://www.jotform.com/blog/adoption-form-questions/
- Catpuccino: https://adopciones.catpuccino.org/
- Rosario: https://www.rosario.gob.ar/inicio/postularme-como-adoptante-de-perro-yo-gato
- Rescate Felino Chile: https://rescatefelinochile.cl/adopta/
- Patinhas Carentes: https://www.patinhascarentes.org/termo-de-adocao

**Contracts:**
- Callejeritos (MX): https://callejeritos.mx/static/media/contrato_adopcion_nuevo.56c387c4.pdf
- Protectora de Cáceres (ES): https://protectoradecaceres.es/wp-content/uploads/2025/08/Contrato-de-Cesion-de-Animal-Domestico-2024.pdf
- GCBA compromiso de adopción (AR): https://buenosaires.gob.ar/areas/med_ambiente/apra/archivos/compromiso_de_adopcion.pdf
- SUBDERE contrato tipo (CL): https://proactiva.subdere.gov.cl/bitstream/handle/123456789/610/6.%20Contrato-de-Adopci%C3%B3n%20Tipo..pdf?sequence=3&isAllowed=y
- Amigo Não se Compra (BR): https://blog.amigonaosecompra.com.br/wp-content/uploads/2012/07/Termo-de-adocao-e-guarda-responsavel.pdf
- Jus.com.br: https://jus.com.br/peticoes/73732/modelo-de-termo-de-adocao-animal
- Greyhound Rescue (UK): https://www.greyhoundrescue.org.uk/terms-conditions

**Clause guidance:**
- Abogacía Española: https://www.abogacia.es/publicaciones/blogs/blog-de-derecho-de-los-animales/como-elaborar-un-contrato-de-adopcion-de-un-animal/
- Edén Gatuno: https://www.edengatuno.com.ar/blog/posts/contrato-de-adopcin-animal-entre-la-obligacin-legal-y-el-deber-tico-58b686fa2beb/
- Instituto de Protección Animal: https://www.institutodeproteccionanimal.com/es/clausulas-especiales-de-un-contrato-de-adopcion-de-animales/
- IPA case law: https://www.institutodeproteccionanimal.com/es/analisis-de-sentencias-sobre-contratos-de-adopcion-de-animales/

**Law:**
- Ley 14.346: https://www.argentina.gob.ar/normativa/nacional/ley-14346-153011/texto
- Ley 25.506: https://servicios.infoleg.gob.ar/infolegInternet/anexos/70000-74999/70749/texact.htm
- Donación con cargo: https://mheabogados.com/donacion-con-cargo-incumplimiento-del-cargo-revocacion-de-la-donacion/
- Ley 7/2023: https://www.boe.es/buscar/act.php?id=BOE-A-2023-7936
- Draft RD: https://www.dsca.gob.es/sites/default/files/TIP-N-25-049-DCA.pdf
- Ley 17/2021: https://www.boe.es/buscar/doc.php?id=BOE-A-2021-20727
- Brazil, CPC and e-signature: https://cesconbarrieu.com.br/alteracao-no-cpc-confere-forca-executiva-aos-contratos-assinados-eletronicamente/
- Brazil, doação com encargo: https://legale.com.br/blog/contrato-de-doacao-de-animais-aspectos-juridicos-e-praticas-no-direito-civil/
- TJDFT on maus-tratos: https://www.tjdft.jus.br/institucional/imprensa/campanhas-e-produtos/direito-facil/edicao-semanal/maus-tratos-contra-caes-e-gatos
- Ley 18.471 (UY): https://uruguay.justia.com/nacionales/leyes/ley-18471-mar-27-2009/gdoc
- US breach of contract: https://www.animalleague.org/blog/advice/pet-legal-advice/breach-of-contract/ and https://randyturner.com/common-legal-pitfalls-that-rescue-groups-can-avoid

**Open-adoption movement:**
- Adopters Welcome manual 2025: https://humanepro.org/sites/default/files/documents/guides-adopters-welcome-2025-final-digital.pdf
- ASPCApro: https://www.aspcapro.org/resource/effective-tips-boost-adoptions-reduce-barriers-improve-experience
- HASS: https://www.humananimalsupportservices.org/blog/common-barriers-to-adoption-and-how-to-bust-them/
- Adopters Welcome FAQ: https://humanepro.org/page/adopters-welcome-faqs
- Weiss et al. 2014: https://doi.org/10.4236/ojas.2014.45040

**Software:**
- Shelterluv: https://www.shelterluv.com/product/features/ and https://trapandreturn.com/shelterluv-guide/
- Petstablished: https://petstablished.com/
- RescueGroups: https://rescuegroups.org/services/online-forms-iframe-service/
- Adopets: https://shelterbuddy.zendesk.com/hc/en-us/articles/360001190696-Introducing-Adopets
- ASM documents: https://sheltermanager.com/repo/asm3_help/documents.html
