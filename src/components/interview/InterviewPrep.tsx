'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { previewInterviewCandidates } from '@/app/actions/interviews';
import type { CandidateSummary, PrepFacts } from '@/domain/interview/types';
import CandidateCard from './CandidateCard';

const LABEL = 'block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider';
const INPUT = 'w-full h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm';

function RowList({ label, values, onChange, testId, inputMode }: {
    label: string; values: string[]; onChange: (v: string[]) => void; testId: string; inputMode?: 'tel' | 'email' | 'text';
}) {
    const { t } = useLanguage();
    const rows = values.length ? values : [''];
    return (
        <div>
            <label className={LABEL}>{label}</label>
            <div className="space-y-2">
                {rows.map((v, i) => (
                    <input key={i} data-testid={`${testId}-${i}`} className={INPUT} value={v} inputMode={inputMode}
                        onChange={e => { const next = [...rows]; next[i] = e.target.value; onChange(next); }} />
                ))}
            </div>
            <button type="button" onClick={() => onChange([...rows, ''])} className="mt-1 text-xs font-semibold text-teal-700 hover:underline">{t('interview.prep_add_row')}</button>
        </div>
    );
}

export default function InterviewPrep({ prep, onPrepChange, leadCandidateId, onLeadChange, onStart, starting }: {
    prep: PrepFacts;
    onPrepChange: (p: PrepFacts) => void;
    leadCandidateId: string | null;
    onLeadChange: (id: string | null) => void;
    onStart: () => void;
    starting: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const canStart = prep.name.trim().length >= 2 && !starting;

    useEffect(() => {
        if (prep.name.trim().length < 2) { setCandidates([]); return; }
        let active = true;
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const clean = { ...prep, phones: prep.phones.filter(Boolean), emails: prep.emails.filter(Boolean), socials: prep.socials.filter(Boolean) };
                const r = await previewInterviewCandidates(clean);
                if (active && r.ok) setCandidates(r.candidates);
            } catch (e) {
                if (!handledAsStale(e)) toast.error(t('interview.load_failed'), userFacingMessage(e, t('interview.load_failed')), resolveErrorId(e, 'InterviewPrep.preview'));
            } finally {
                if (active) setSearching(false);
            }
        }, 500);
        return () => { active = false; clearTimeout(timer); };
    }, [prep, t, toast]);

    return (
        <section className="grid gap-6 md:grid-cols-[1fr_20rem]">
            <div className="bg-white rounded-2xl border border-stone-200 p-4 md:p-6 space-y-4">
                <div>
                    <h1 className="text-xl font-bold text-stone-900">{t('interview.prep_title')}</h1>
                    <p className="text-sm text-stone-600 mt-1">{t('interview.prep_intro')}</p>
                </div>
                <div>
                    <label className={LABEL} htmlFor="interview-prep-name">{t('interview.prep_name')}</label>
                    <input id="interview-prep-name" data-testid="interview-prep-name" className={INPUT} value={prep.name}
                        onChange={e => onPrepChange({ ...prep, name: e.target.value })} autoFocus />
                </div>
                <RowList label={t('interview.prep_phones')} values={prep.phones} onChange={phones => onPrepChange({ ...prep, phones })} testId="interview-prep-phone" inputMode="tel" />
                <RowList label={t('interview.prep_socials')} values={prep.socials} onChange={socials => onPrepChange({ ...prep, socials })} testId="interview-prep-social" />
                <RowList label={t('interview.prep_emails')} values={prep.emails} onChange={emails => onPrepChange({ ...prep, emails })} testId="interview-prep-email" inputMode="email" />
                <div>
                    <label className={LABEL} htmlFor="interview-prep-address">{t('interview.prep_address')}</label>
                    <input id="interview-prep-address" className={INPUT} value={prep.address} onChange={e => onPrepChange({ ...prep, address: e.target.value })} />
                </div>
                <div className="flex justify-end pt-2">
                    <button type="button" data-testid="interview-start" disabled={!canStart} onClick={onStart}
                        className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all">
                        {t('interview.prep_start')} →
                    </button>
                </div>
            </div>
            <aside className="space-y-2" aria-live="polite">
                <h2 className={LABEL}>{t('interview.prep_candidates')}</h2>
                {searching && <p className="text-sm text-stone-500">{t('interview.prep_searching')}</p>}
                {!searching && prep.name.trim().length >= 2 && candidates.length === 0 && <p className="text-sm text-stone-500">{t('interview.prep_no_matches')}</p>}
                {candidates.map(c => (
                    <CandidateCard key={c.adopterId} c={c} selected={leadCandidateId === c.adopterId}
                        onSelect={() => onLeadChange(leadCandidateId === c.adopterId ? null : c.adopterId)}
                        selectLabel={leadCandidateId === c.adopterId ? t('interview.prep_lead_selected') : t('interview.prep_lead')} />
                ))}
            </aside>
        </section>
    );
}
