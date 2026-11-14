/**
 * Whether a dialog is open: every Modal and the applicant panel carry `aria-modal="true"`. The chat bubble
 * steps aside meanwhile, so it never sits over a dialog's main button (UX review S2: «Sumar a un animal»,
 * «Enviar contrato»).
 */
export const MODAL_SELECTOR = '[aria-modal="true"]';

export function modalOpen(root: { querySelector: (selector: string) => unknown }): boolean {
    return root.querySelector(MODAL_SELECTOR) != null;
}
