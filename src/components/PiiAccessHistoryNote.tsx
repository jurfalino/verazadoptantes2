'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';

/** What happened to the viewer's own access on this profile (H3, domain/piiAccessNotice). */
export interface PiiAccessHistory {
    /** The latest decided request was turned down. */
    denied: boolean;
    /** The approver's note on that denial, if any. */
    note: string | null;
    /** Epoch ms the person in charge took a profile-wide grant back, or null. */
    accessRevokedAt: number | null;
}

/**
 * «Tu solicitud no fue aprobada. Motivo: «…»» and «El responsable quitó tu
 * acceso el {fecha}.» — one look in both places it shows: the contact popover
 * footer and the «Protegido» window's locked branch. The «Motivo:» style is the
 * owner's own request panel (PiiAccessRequestPanel).
 */
export default function PiiAccessHistoryNote({ history }: { history: PiiAccessHistory | null }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    if (!history || (!history.denied && history.accessRevokedAt == null)) return null;
    return (
        <div className="space-y-1" data-testid="pii-access-history">
            {history.denied && (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('adopter.pii_request_denied')}</span>
                    {history.note && (
                        <>
                            {' '}
                            <span className="font-medium">{t('adopter.pii_request_denied_reason')}: </span>
                            <span className="italic">«{history.note}»</span>
                        </>
                    )}
                </p>
            )}
            {history.accessRevokedAt != null && (
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t('adopter.pii_access_revoked_on').replace('{date}', formatShortDate(new Date(history.accessRevokedAt)))}
                </p>
            )}
        </div>
    );
}
