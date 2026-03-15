# Adopter Profile Screen – UX Senior Expert Audit

*Analysis and improvement suggestions for `/adopter/[id]` (view/edit profile, adoptions, images, forms).*

---

## 1. Current state summary

The adopter profile screen is a long, single-column page with:

- **Back link** (contextual: My Adopters or Back to Search via `?ref=`)
- **Report inaccuracy** (floating/form)
- **Duplicate detection banners** (when similar profiles exist; dismissible)
- **Stats card** (Views, Requests, Adoptions with period tabs 90d / 1y / all; expandable info)
- **AdopterForm** (main card): avatar, name, ID/country/source/rating, flagging pills, contact (textarea-style), family members, notes; edit mode with Save/Cancel; duplicate search on create
- **Images** (collapsible)
- **Adoptions** (collapsible): add adoption form + adoption history list
- **Forms completed** (collapsible): list of linked form submissions with date and “looking for” summary, link to form results

Data: name, contactInfo, familyMembers, notes, status; avatar from first/profile image; adoptions and images from separate queries. **addressInfo** exists on the Adopter type but is **not displayed or editable** in the UI.

---

## 2. Strengths

| Area | What works |
|------|------------|
| **Identity** | Avatar (photo or initials), name, and metadata (ID, country, source, rating) are clear. Rating badge is clickable and scrolls to adoptions. |
| **Edit affordance** | “Click to edit” on contact/family/notes and explicit Edit button make the edit model clear. |
| **Duplicate handling** | Create flow: while-typing duplicate search and save confirmation modal. View flow: banners with “View” and dismiss. |
| **Sections** | Collapsible sections (Images, Adoptions, Forms) with counts reduce initial scroll; `<details>` is accessible. |
| **Reporting** | Report menu (duplicate, inaccuracy, deletion) is grouped and described. |
| **Forms** | Linked forms with date and species/life stage summary; link to form results when notification exists. |

---

## 3. Issues and recommendations

### 3.1 Information architecture and hierarchy

| Issue | Recommendation |
|-------|-----------------|
| **Single long scroll** | No persistent “summary” or anchor nav. Rescuers often need either “quick facts” or “add adoption” without scrolling. | Add a **sticky or in-page nav** (e.g. jump links: Contact, Adoptions, Images, Forms) and/or a **compact summary bar** (name, rating, adoption count) that stays visible or is repeated. |
| **Contact is one blob** | contactInfo is a free-text area. If it contains phone, email, address, they’re not scannable or actionable (e.g. click-to-call). | Prefer **structured contact** (phone, email, address as separate fields) with optional display as blocks; if keeping one field, consider **parse-and-display** (e.g. detect phone/email and link them). |
| **addressInfo missing** | Schema has `addressInfo` but it’s not shown or edited. | **Surface address** in the main card (view + edit), e.g. “Address” under Contact, so rescuers can see and correct it. |

### 3.2 Visual hierarchy and consistency

| Issue | Recommendation |
|-------|-----------------|
| **Stats card vs rest** | Stats use a custom “stats-card” / “stats-tile” style; AdopterForm and CollapsibleSection use teal/stone and rounded-2xl. Feels like two different systems. | Align stats card with the rest: same border/radius/shadow as AdopterForm or CollapsibleSection (e.g. white bg, rounded-2xl, border border-stone-200), and use the same heading scale (e.g. text-sm font-semibold for section titles). |
| **Duplicate banners** | Amber boxes are noticeable but many banners in a row can feel noisy. | Keep one banner per duplicate; consider **grouping** (“3 possible duplicates”) with an expand to list, or **max visible** (e.g. 2) + “View all” to reduce overwhelm. |
| **Forms section when empty** | “Forms completed” is open when count > 0 and closed when 0; empty state is a short line of text. | When empty, consider a **short CTA**: “Forms linked to this profile will appear here” and optionally “Link a form” if you add that action. |

### 3.3 Actions and primary tasks

| Issue | Recommendation |
|-------|-----------------|
| **Add adoption is buried** | “Add adoption” lives inside the Adoptions collapsible. For frequent use, it requires opening the section and finding the form. | **Surface “Add adoption”** at the top (e.g. in the summary bar or as a sticky/secondary CTA) or make the Adoptions section default-open and put “Add adoption” as the first visible action. |
| **Edit vs overflow** | Edit is a button; Report is in overflow (⋯). Some users may look for “Edit” in the same menu. | Keep Edit prominent; ensure overflow is clearly “More actions” or “Report / other” so the mental model (Edit = change profile, Report = flag issues) is clear. Consider **tooltips** on icon buttons. |
| **Save/Cancel placement** | Save and Cancel are top-right. On long forms this can be off-screen. | For edit mode, consider a **sticky or floating Save/Cancel bar** on scroll (e.g. at bottom or top of viewport) so they’re always visible. |

### 3.4 Content and empty states

| Issue | Recommendation |
|-------|-----------------|
| **Empty contact/family/notes** | Dashed placeholder with “No notes” etc. and click to edit is good. | Ensure placeholders are **translated** and that empty state copy is consistent (e.g. “Add contact information” vs “No contact”). |
| **Forms list** | When a form has no notificationId, the card is not clickable and only shows date/summary. | Make it clear that **“View responses” is only for linked notifications**; for unlinked submissions show “Link to form results” or similar so the state is explicit. |
| **Adoptions empty** | AdoptionHistory likely has an empty state; AdoptionForm is the “add” entry. | Ensure empty state says something like “No adoptions recorded yet” and that “Add adoption” is the obvious next step. |

### 3.5 Mobile and touch

| Issue | Recommendation |
|-------|-----------------|
| **Period selector** | Stats have both **tabs** (90d / 1y / all) and a **select** (duplicated). On small screens this is redundant and uses space. | Use **one** control: tabs on larger screens, `<select>` on narrow (e.g. md:flex hidden for tabs, block for select on small). |
| **Touch targets** | Icon buttons (⋯, dismiss ✕, stats (i)) should be at least ~44px. | Audit tap areas; add `min-h-[44px] min-w-[44px]` or padding so all interactive elements are thumb-friendly. |
| **Sticky actions** | No sticky bar. When adding an adoption or editing, primary action can scroll away. | Consider a **sticky “Save” / “Add adoption”** or “Back to top” on long pages for mobile. |

### 3.6 Accessibility and feedback

| Issue | Recommendation |
|-------|-----------------|
| **Stats (i) icon** | Expandable description is good; the “i” may not be recognized as “info”. | Use a proper **tooltip** or `aria-describedby` and ensure the expand is keyboard-accessible; label the button (e.g. “Views – info”). |
| **Collapsible sections** | `<details>` is good for a11y. | Ensure **focus management** when opening (e.g. focus first link/button inside) and that section titles have consistent heading level (e.g. h2 for page, h3 for sections). |
| **Save feedback** | After save, user may not see confirmation if they’re scrolled. | **Toast** on successful save (“Profile updated”) and optionally scroll to top or keep edit bar visible briefly. |
| **Loading** | Save button shows loading state; other actions (e.g. dismiss duplicate) have no loading. | Use **loading or disabled state** for any action that triggers a request (e.g. “Use this profile” in duplicate flow). |

### 3.7 Consistency with app patterns

| Issue | Recommendation |
|-------|-----------------|
| **Back link** | Uses `<a href>`. Next.js app could use `<Link>`. | Use **`<Link>`** for client-side navigation and consistent prefetch. |
| **Form results** | Form results page uses “Complete answers” in boxes with stone borders; profile uses teal. | Not wrong, but **document** when to use teal (profile/identity) vs stone (data blocks) so future screens stay consistent. |
| **i18n** | Many `t('key') \|\| 'Fallback'`; some hardcoded (e.g. “Perro”, “Cachorro” in forms section). | **Replace hardcoded** species/lifeStage labels in AdopterProfile forms list with `t()` and ensure all new strings have keys in en/es. |

---

## 4. Prioritized recommendations

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P1** | Show and edit **addressInfo** in the profile card (with contactInfo). | Low | High – data exists but is invisible. |
| **P1** | **Sticky or in-view Save/Cancel** when in edit mode (or at least ensure they’re visible without scrolling to top). | Low | High – reduces failed saves and confusion. |
| **P2** | **Unify stats card** visual style with AdopterForm/CollapsibleSection (same border, radius, heading size). | Low | Medium – consistent look and feel. |
| **P2** | **One period control** on stats (tabs or select by breakpoint, not both). | Low | Medium – less clutter, clearer on mobile. |
| **P2** | **Surface “Add adoption”** (e.g. secondary CTA near top or default-open Adoptions with “Add adoption” first). | Low | High – primary task is easier. |
| **P2** | **Structured contact** (phone, email, address) or at least linkify phone/email in the contact blob. | Medium | High – scannable and actionable. |
| **P3** | **Jump links / anchor nav** (Contact, Adoptions, Images, Forms) for long profiles. | Medium | Medium – faster navigation. |
| **P3** | **Toast on successful save** and ensure back/edit state is clear. | Low | Medium – feedback and trust. |
| **P3** | **Replace hardcoded** strings in Forms section with i18n; improve empty states (Forms, Adoptions). | Low | Medium – consistency and clarity. |
| **P4** | **Group or cap** duplicate banners; “View all” if many. | Low | Low – less noise. |
| **P4** | **Tooltips** on icon buttons (⋯, (i)); ensure 44px touch targets. | Low | Medium – a11y and mobile. |

---

## 5. Summary

The adopter profile is **functional and well-structured** (identity, contact, notes, adoptions, images, forms). The main UX gaps are: **addressInfo not shown**, **primary actions (Save, Add adoption) can be off-screen**, **stats and duplicate UI feel visually separate**, and **contact could be more scannable/actionable**. Addressing P1 and P2 items will bring the most benefit; P3/P4 polish consistency and accessibility.
