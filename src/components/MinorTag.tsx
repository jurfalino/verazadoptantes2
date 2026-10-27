'use client';

import { useLanguage } from '@/context/LanguageContext';

/**
 * «Menor de edad» — the profile header's pill, in the «special state» purple.
 * A minor carries no rating, alerts or records, so wherever a person's rating
 * would show, a minor shows this instead (profile header, search cards,
 * «¿Es este perfil?», household lines).
 */
export function MinorTag({ testId = 'minor-tag' }: { testId?: string }) {
    const { t } = useLanguage();
    return (
        <span
            data-testid={testId}
            className="flex-none inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ backgroundColor: 'var(--status-purple-bg)', color: 'var(--status-purple-text)' }}
        >
            {t('adopter.minor_tag')}
        </span>
    );
}
