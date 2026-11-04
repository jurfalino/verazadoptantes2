/**
 * A tap target of at least 44px on a small inline control, without changing
 * how it looks (ux-ui-guidelines §1.5; fix round 2, item 4): an ::after centred
 * on the element, as wide as it and at least 44px tall, takes the taps around
 * it. Same idea as the household row's name link (`after:-inset-y-3`), sized
 * for any height: a 15px link and a 32px pill both get exactly 44px.
 *
 * The element must not clip its ::after (no overflow-hidden on it), and the
 * rows around it need ≥44px pitch so two targets never overlap — the contact
 * rows are 44px on phones for that reason.
 */
export const TAP_TARGET_44 = "relative after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:h-full after:min-h-11 after:content-['']";
