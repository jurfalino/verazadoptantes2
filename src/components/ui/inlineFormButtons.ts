/**
 * «Cancelar» / «Guardar» of an INLINE form — a field or a row edited in place
 * (a contact, the name, a household person). One pair of classes so every
 * inline form on the profile has the same two buttons; dialogs and page CTAs
 * use the button matrix (components/ui/Button.tsx) instead.
 *
 * 44px tall below `sm:` (the tap-target floor, ux-ui-guidelines §1.5), the
 * compact desktop height from `sm:` up.
 */
export const INLINE_CANCEL_BTN =
    'inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 px-3 py-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors disabled:opacity-50';

export const INLINE_SAVE_BTN =
    'inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50';
