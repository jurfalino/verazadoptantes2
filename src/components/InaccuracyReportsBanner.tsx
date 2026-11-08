'use client';

/**
 * H4: the open «Reportar inexactitud» reports, on the profile — their home; the
 * `inaccuracy_reported` notice is only a shortcut here. «Reportaron información
 * incorrecta (n)», one line per report («{name} · {date}: «{details}»», as the
 * notice names and quotes it), and «Ya lo corregí», which closes them all.
 *
 * The page passes reports only to the notice's audience (owner, their team,
 * admins, moderators — canSeeInaccuracyReports); the server checks again.
 * A flag («action may be needed»), never an alert: the neutral tone, a flag
 * icon, and never the «Inexacto» label (admin-only, Jon 2026-11-01).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Flag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProfilePromptBanner } from '@/components/ProfilePromptBanner';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { markInaccuracyReportsFixed } from '@/app/actions/inaccuracyReports';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import type { PendingInaccuracyReport } from '@/lib/inaccuracyReports';

export function InaccuracyReportsBanner({ adopterId, reports }: { adopterId: string; reports: PendingInaccuracyReport[] }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [closed, setClosed] = useState(false);

    if (closed || reports.length === 0) return null;

    async function markFixed() {
        setBusy(true);
        try {
            const res = await markInaccuracyReportsFixed(adopterId);
            if (res.ok) {
                setClosed(true);
                router.refresh();
                return;
            }
            toast.error(t('errors.generic'), t('adopter.inaccuracy_reports_fix_failed'), res.errorId);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.inaccuracy_reports_fix_failed'), resolveErrorId(e, 'InaccuracyReportsBanner'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ProfilePromptBanner tone="info" icon={Flag} testId="inaccuracy-reports" role="region" titleId="inaccuracy-reports-title"
            title={t('adopter.inaccuracy_reports_title').replace('{n}', String(reports.length))}
            actions={
                <Button type="button" variant="secondary" size="compact" data-testid="inaccuracy-reports-fixed" loading={busy}
                    icon={<Check className="w-4 h-4" aria-hidden="true" />} onClick={() => { void markFixed(); }}>
                    {t('adopter.inaccuracy_reports_fixed')}
                </Button>
            }>
            <ul className="space-y-1">
                {reports.map(r => {
                    const who = [r.reporterName, r.createdAt !== null ? formatShortDate(r.createdAt) : ''].filter(Boolean).join(' · ');
                    return (
                        <li key={r.id} data-testid="inaccuracy-report-line">
                            {who}{r.details ? <>{who ? ': ' : ''}«{r.details}»</> : null}
                        </li>
                    );
                })}
            </ul>
        </ProfilePromptBanner>
    );
}
