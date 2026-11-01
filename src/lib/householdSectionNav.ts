/**
 * Getting to the profile's «Familiares / Convivientes» section — where every
 * housemate chip leads (the profile header's, /my-adopters' rows'). Browser
 * code only; it takes the document / window so it can be tested without one.
 */
import { HOUSEHOLD_SECTION_HEADING_ID, HOUSEHOLD_SECTION_HREF, HOUSEHOLD_SECTION_ID } from '@/domain/profileHouseholds';

/**
 * Scrolls to the section (its scroll-mt clears the sticky nav) and, unless
 * `focus: false`, moves focus to its heading (tabIndex -1) without a second
 * scroll — so a keyboard or screen-reader user arrives too (review fix 7).
 * False when the section isn't on the page (a link then does its own jump).
 */
export function goToHouseholdSection(doc: Pick<Document, 'getElementById'>, opts: { smooth: boolean; focus?: boolean }): boolean {
    const section = doc.getElementById(HOUSEHOLD_SECTION_ID);
    if (!section) return false;
    section.scrollIntoView({ behavior: opts.smooth ? 'smooth' : 'auto', block: 'start' });
    if (opts.focus !== false) doc.getElementById(HOUSEHOLD_SECTION_HEADING_ID)?.focus({ preventScroll: true });
    return true;
}

/** Retries while the page above the section settles (photos, cards streaming in). */
const ARRIVAL_RETRIES_MS = [0, 300, 800, 1500];
const STOP_EVENTS = ['wheel', 'touchstart', 'keydown'] as const;

type ArrivalWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'> & {
    location: Pick<Location, 'hash'>;
    document: Pick<Document, 'getElementById'>;
};

/**
 * Arriving at a profile with #profile-household-section (a /my-adopters
 * housemate chip): the route streams in behind its loading screen, so the
 * browser's own jump to the anchor misses. Goes there once mounted and again
 * while the sections above settle — until the person scrolls, touches or
 * types — and moves focus to the heading once, the first time the section is
 * found. Returns the cleanup for a mount effect.
 */
export function followHouseholdSectionHash(win: ArrivalWindow): () => void {
    if (win.location.hash !== HOUSEHOLD_SECTION_HREF) return () => {};
    let stopped = false;
    let focused = false;
    const stop = () => { stopped = true; };
    for (const ev of STOP_EVENTS) win.addEventListener(ev, stop, { once: true, passive: true });
    const go = () => {
        if (stopped) return;
        if (goToHouseholdSection(win.document, { smooth: false, focus: !focused })) focused = true;
    };
    const timers = ARRIVAL_RETRIES_MS.map(ms => win.setTimeout(go, ms));
    return () => {
        timers.forEach(id => win.clearTimeout(id));
        for (const ev of STOP_EVENTS) win.removeEventListener(ev, stop);
    };
}
