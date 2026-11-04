'use client';

import { useLanguage } from '@/context/LanguageContext';
import { PILL_BOX } from '@/components/RatingBadge';

/**
 * «Menor de edad» — the same pill box as the rating and the alerts, in the «special state» purple.
 * An informational marker only (Jon, 2026-10-28): a minor is rated, recorded
 * and flagged like anyone else. It sits in the rating slot, before the rating
 * (profile header, search cards, «¿Es este perfil?», household lines).
 */
export function MinorTag({ testId = 'minor-tag' }: { testId?: string }) {
    const { t } = useLanguage();
    return (
        <span
            data-testid={testId}
            // The rating and alert pills' box (PILL_BOX): 22px tall wherever it sits, so a row of pills lines up
            // (coordinator ruling, 2026-10-28). Its own purple, with a border in that colour.
            className={`flex-none ${PILL_BOX}`}
            style={{ backgroundColor: 'var(--status-purple-bg)', color: 'var(--status-purple-text)', borderColor: 'var(--status-purple-border)' }}
        >
            {t('adopter.minor_tag')}
        </span>
    );
}
