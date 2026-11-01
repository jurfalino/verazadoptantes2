/**
 * The profile page's household data, as the client receives it (households
 * as profiles, Task 8). Types only plus the empty value — read on the server
 * by src/lib/profileHouseholds.ts; client components import this module.
 */
import type { HouseholdView } from '@/lib/households';
import type { GiftRecipientView } from '@/lib/householdPeople';
import { NO_HOUSEMATE_ALERT, type HousemateAlertSummary } from '@/domain/households';

export { NO_HOUSEMATE_ALERT, type HousemateAlertSummary };

export type ProfileHouseholds = {
    views: HouseholdView[];
    /** Gift forms' recipients still without a profile («Destinatario del regalo (según el formulario)»). */
    giftForms: GiftRecipientView[];
    /** The giver's team or an admin: «Crear perfil de {nombre}». */
    canCreateGift: boolean;
    /**
     * The header's housemate alerts («Conviviente con calificación 2.0»,
     * «Conviviente con alertas»), decided on the server from the households
     * in `views` themselves (each member's rating and period alerts →
     * housemateAlertSummary, the rule every card uses), so the header and the
     * section never disagree. Only the two answers are added — and only for
     * a signed-in viewer, as on search.
     */
    housemateAlert: HousemateAlertSummary;
};

export const EMPTY_PROFILE_HOUSEHOLDS: ProfileHouseholds = { views: [], giftForms: [], canCreateGift: false, housemateAlert: NO_HOUSEMATE_ALERT };
