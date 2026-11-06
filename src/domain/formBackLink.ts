/**
 * Where the form screen's back link goes, and what it says (spec 2026-11-05;
 * docs/ux-ui-guidelines.md §2.2: back-nav names its source). Entry links add
 * `?from=adopters | adopter:<id> | animal:<id>`; the page passes the names it
 * confirmed server-side for this form. Anything else — no source, a notification,
 * a malformed id, a name the page couldn't confirm — goes back to Mis adoptantes,
 * so `from` can never build an arbitrary link or label.
 */
export interface FormBackLink {
    href: string;
    label: { key: string; name?: string };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOME: FormBackLink = { href: '/my-adopters', label: { key: 'formResults.back_to_adopters' } };

export function formBackLink(from: string | null, names: { adopter?: string | null; animal?: string | null }): FormBackLink {
    if (!from) return HOME;
    const [kind, id] = from.split(':', 2);
    if (kind === 'adopters' && id === undefined) return HOME;
    if (!id || !ID.test(id)) return HOME;
    if (kind === 'adopter' && names.adopter) return { href: `/adopter/${id}`, label: { key: 'formResults.back_to_name', name: names.adopter } };
    if (kind === 'animal' && names.animal) return { href: `/my-animals/${id}`, label: { key: 'formResults.back_to_name', name: names.animal } };
    return HOME;
}
