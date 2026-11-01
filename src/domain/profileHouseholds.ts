/**
 * The profile page's household data, as the client receives it (households
 * as profiles, Task 8). Types only plus the empty value — read on the server
 * by src/lib/profileHouseholds.ts; client components import this module.
 */
import type { HouseholdView } from '@/lib/households';
import type { GiftRecipientView } from '@/lib/householdPeople';

export type ProfileHouseholds = {
    views: HouseholdView[];
    /** Gift forms' recipients still without a profile («Destinatario del regalo (según el formulario)»). */
    giftForms: GiftRecipientView[];
    /** The giver's team or an admin: «Crear perfil de {nombre}». */
    canCreateGift: boolean;
    /**
     * The header's housemate alerts («Conviviente con calificación 2.0»,
     * «Conviviente con alertas»), decided on the server from the same line a
     * search card reads (householdLinesFor → housemateLowRating /
     * housemateHasAlerts). Only the two answers reach the browser — never the
     * housemates' names — and only for a signed-in viewer, as on search.
     */
    housemateAlert: HousemateAlertSummary;
};

export type HousemateAlertSummary = { lowRating: number | null; hasAlerts: boolean };
export const NO_HOUSEMATE_ALERT: HousemateAlertSummary = { lowRating: null, hasAlerts: false };

export const EMPTY_PROFILE_HOUSEHOLDS: ProfileHouseholds = { views: [], giftForms: [], canCreateGift: false, housemateAlert: { lowRating: null, hasAlerts: false } };
