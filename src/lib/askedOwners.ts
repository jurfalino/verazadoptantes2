import { joinNames } from '@/lib/householdCopy';

type T = (key: string) => string;

/**
 * Who a «no es la misma persona» was sent to (consistency rule, 2026-11-06), said the
 * same way on every screen: the owners' names joined in the viewer's language, or
 * «los administradores» when neither profile has an owner.
 */
export function askedOwnersText(t: T, ownerLabels: readonly string[]): string {
    return ownerLabels.length ? joinNames(t, ownerLabels) : t('adopter.asked_admins');
}
