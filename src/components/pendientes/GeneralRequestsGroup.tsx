/**
 * «Formularios generales» — the first group of «Pendientes de revisar» (Jon 2026-11-13: a general form is a
 * person to evaluate, not an animal card). Every request waiting is listed (never paginated with the pairs);
 * a row opens that request alone. Same row look as the pairs (PairRow's face): amber icon, name, a warning
 * line, a muted summary, and an «Evaluar» pill.
 */
import type { ApplicantSummary } from '@/app/actions/applicants';
import { animalLine } from '@/components/evaluation/ApplicationStatusLine';
import { timeAgo } from '@/lib/timeAgo';
import { isToDo } from '@/domain/applications';
import { T_MUTED } from '@/components/pendientes/ui';

type T = (key: string) => string;

/** The requests that wait on the team: to evaluate, on a live profile (`isToDo`, as the home counts them), newest first. */
export function requestsToEvaluate(list: readonly ApplicantSummary[]): ApplicantSummary[] {
    return list
        .filter(isToDo)
        .sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0));
}

const FORM_ICON = 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8';

export default function GeneralRequestsGroup({ requests, onOpen, t, locale }: {
    requests: readonly ApplicantSummary[];
    onOpen: (applicationId: string) => void;
    t: T;
    locale: string;
}) {
    if (requests.length === 0) return null;
    const when = (a: ApplicantSummary) => (a.appliedAt ? timeAgo(new Date(a.appliedAt * 1000), locale !== 'en') : '');
    const line = (a: ApplicantSummary) => (a.askedAnimal
        ? `${animalLine(t, 'evaluation.asked_adopted', a.askedAnimal)} · ${when(a)}`
        : t('evaluation.request_line_general_when').replace('{when}', when(a)));
    const prefers = (a: ApplicantSummary) => {
        const parts = [
            a.species && t(`myAnimals.applicants_row_summary_species_${a.species}`),
            a.lifeStage && t(`myAnimals.applicants_row_summary_lifestage_${a.lifeStage}`),
        ].filter((x): x is string => !!x && !x.includes('.'));
        return parts.length ? `${t('myAnimals.applicants_panel_pref_label')}: ${parts.join(' · ')}` : '';
    };
    return (
        <>
            <h3 data-testid="general-requests-heading"
                className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider border-t border-[var(--border-default)] first:border-t-0 text-[var(--status-warning-text)]">
                {t('evaluation.requests_group')}
            </h3>
            {requests.map(a => (
                <button key={a.applicationId} type="button" onClick={() => onOpen(a.applicationId)} data-testid="general-request-row"
                    className="w-full border-t border-[var(--border-default)] first:border-t-0 min-h-[64px] flex items-center gap-3 pl-4 pr-4 py-3 text-left hover:bg-[var(--accent-subtle-bg)] transition-colors">
                    <span className="w-10 h-10 shrink-0 rounded-full border bg-amber-50 border-amber-200 text-amber-700 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FORM_ICON} /></svg>
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-bold truncate text-[var(--text-primary)]">{a.adopterName}</span>
                        <span className="block text-[13px] font-bold text-[var(--status-warning-text)] [overflow-wrap:anywhere]">{line(a)}</span>
                        {prefers(a) && <span className={`block text-[12px] mt-0.5 ${T_MUTED}`}>{prefers(a)}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] font-bold px-2 py-1 rounded-full bg-teal-700 text-white">{t('evaluation.request_action')}</span>
                </button>
            ))}
        </>
    );
}
