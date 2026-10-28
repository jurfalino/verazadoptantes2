/**
 * «Cancelar» / «Guardar» of an INLINE form — a field or a row edited in place
 * (a contact, the name, a household person). One pair so every inline form on
 * the profile has the same two buttons.
 *
 * They ARE the button matrix (components/ui/Button.tsx, design-style-guide
 * §2.1) at its Compact size: Secondary «Cancelar» (tinted, with a border that
 * stays visible in Azul Noche — the old stone-100 fill vanished there) and
 * Primary «Guardar»; 12px radius, weight 700 (audit B18). 44px tall below
 * `sm:` (the tap-target floor, ux-ui-guidelines §1.5), the compact height from
 * `sm:` up. Dialogs use components/ui/Modal's footer.
 */
import { buttonClasses } from '@/components/ui/Button';

export const INLINE_CANCEL_BTN = `${buttonClasses({ variant: 'secondary', size: 'compact' })} sm:min-h-0`;

export const INLINE_SAVE_BTN = `${buttonClasses({ variant: 'primary', size: 'compact' })} sm:min-h-0`;

/**
 * A field of an inline form (contact composer, a household person's name /
 * relationship / age). 16px on phones (iOS doesn't zoom), 44px tall below
 * `sm:`; its border and focus colour have [data-theme] remaps (globals.css,
 * audit B18), so the frame reads in Azul Noche too. 12px radius (`rounded-xl`):
 * the style guide's §2.3 and the global input/textarea/select rule in
 * globals.css (fix round 2, item 11).
 */
export const INLINE_FIELD =
    'w-full min-h-[44px] sm:min-h-0 px-3 py-1.5 border border-stone-300 rounded-xl bg-white text-base sm:text-sm text-stone-900 outline-none focus:border-teal-500 transition-colors';
