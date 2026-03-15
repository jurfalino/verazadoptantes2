# My Animals – Contract vs Form Buttons (UX)

## Current problem

On **My Animals for Adoption** there are two share actions that look similar and can confuse users:

1. **Header:** "Formulario" (ShareFormMenu) – share icon, teal style. Shares the **adoption application form** link (one link per rescuer; adopters fill it and rescuer gets responses).
2. **Per animal card:** "Contrato" (ShareMenu) – same share icon, same teal style. Shares the **adoption contract** link **for that specific animal** (so the adopter can sign the contract for that pet).

**Why it’s confusing:**
- Both use the same icon and similar styling.
- "Contrato" vs "Formulario" don’t explain **what each link is for** or **when** to use which.
- It’s not obvious that one is **per animal** (contract) and one is **global** (form).
- No short explanation on the page (e.g. “Share contract for this animal” vs “Share form so applicants can apply”).

---

## UX recommendations

### 1. **Differentiate by purpose in the label (not just “Contrato” / “Formulario”)**

- **Per-animal button:** Use an action + scope, e.g.  
  **“Share contract”** or **“Share contract for this animal”**  
  So it’s clear: this is the **contract** for **this** pet.
- **Page-level button:** Use an action + what it is, e.g.  
  **“Share application form”** or **“Share adopter form”**  
  So it’s clear: this is the **form** where **applicants** fill their data (and you get responses).

### 2. **Add a one-line explanation (tooltip or subtitle)**

- **Contract button (per animal):**  
  Tooltip or subtitle: *“Send the adoption contract link for this animal so the adopter can sign it.”*
- **Form button (header):**  
  Tooltip or subtitle: *“Send the form link so potential adopters can apply; you’ll see their responses.”*

### 3. **Differentiate visually (optional but helpful)**

- Use a **different icon** for form vs contract, e.g.:
  - Contract: document/contract icon (e.g. 📋 or a “signing” icon).
  - Form: clipboard/form icon (e.g. 📝 or “form with fields”).
- Or keep the same share icon but use a **secondary color** for one (e.g. form = indigo/violet, contract = teal) so the two actions are visually distinct at a glance.

### 4. **Reinforce in the modal**

- **Contract modal title:** e.g. “Share adoption contract for [Animal name]” and one line: “The adopter will use this link to sign the contract for this animal.”
- **Form modal title:** e.g. “Share adoption application form” and one line: “Applicants fill this form; you’ll receive their responses in notifications.”

### 5. **Placement and grouping**

- Keep **Form** in the header (one place, one link for all animals).
- Keep **Contract** on each available-animal card (per-animal link).
- Optionally add a **short line under the header** (e.g. above or below the tabs):  
  *“Share the **application form** so people can apply; on each animal, share the **contract** when you have a chosen adopter.”*  
  So the two concepts are explained once at page level.

---

## Implementation summary

| Where | Change |
|-------|--------|
| **ShareMenu (per animal)** | Label: “Share contract” (or “Share contract for this animal”). Tooltip: “Send the adoption contract link for this animal so the adopter can sign it.” Modal title/description: clarify “contract for this animal”. |
| **ShareFormMenu (header)** | Label: “Share application form” (or “Share adopter form”). Tooltip: “Send the form link so applicants can apply; you’ll see their responses.” Modal title/description: clarify “application form” and “you get responses”. |
| **i18n** | Add keys e.g. `dashboard.share_contract`, `dashboard.share_contract_tooltip`, `dashboard.share_form`, `dashboard.share_form_tooltip`, and use in both locales. |
| **Optional** | Different icon or color for form vs contract; one-line page hint under the header. |

This keeps the same flows but makes the **purpose** of the contract and form buttons obvious from labels, tooltips, and modal copy.

---

## Implementation status

- **Labels:** "Share contract" (per animal) and "Share application form" (header), via `dashboard.share_contract` and `dashboard.share_form` (i18n).
- **Tooltips:** `share_contract_tooltip` and `share_form_tooltip` on the buttons.
- **Modal titles/hints:** `share_contract_modal_title`, `share_contract_modal_hint`, `share_form_modal_title`, `share_form_modal_hint`, `share_form_qr_hint`; footer in contract modal uses the hint.
- **Icons:** Contract button uses a document icon; form button uses a clipboard/list icon so the two actions are visually distinct.
- **i18n:** EN and ES entries added for all new keys; `common.qr_code` added for the QR step in both modals.
