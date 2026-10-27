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
};

export const EMPTY_PROFILE_HOUSEHOLDS: ProfileHouseholds = { views: [], giftForms: [], canCreateGift: false };
