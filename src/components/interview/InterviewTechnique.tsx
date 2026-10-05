'use client';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { STAGES } from '@/domain/interview/types';

const KEY = 'interview.technique.hidden';

/** Per-viewer convenience only; storage can throw in private mode, so default to showing. */
export function techniqueHidden(): boolean {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === '1'; } catch { return false; } // SSR-safe localStorage read
}
function setHidden(v: boolean) {
    try { if (v) window.localStorage.setItem(KEY, '1'); else window.localStorage.removeItem(KEY); } catch { /* storage unavailable: preference just isn't remembered */ }
}

function Stages() {
    const { t } = useLanguage();
    return (
        <ol className="grid gap-3 md:grid-cols-3">
            {STAGES.map((s, i) => (
                <li key={s} className="rounded-xl border border-stone-200 bg-white p-4">
                    <p className="text-xs font-semibold text-teal-800 uppercase tracking-wider">{i + 1}. {t(`interview.technique.${s}.title`)}</p>
                    <p className="text-sm font-medium text-stone-900 mt-1">{t(`interview.technique.${s}.goal`)}</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-stone-700 list-disc pl-5">
                        {[1, 2, 3, 4].map(n => <li key={n}>{t(`interview.technique.${s}.tip${n}`)}</li>)}
                    </ul>
                </li>
            ))}
        </ol>
    );
}

export default function InterviewTechnique({ mode, onContinue, onClose }: { mode: 'screen' | 'sheet'; onContinue?: () => void; onClose?: () => void }) {
    const { t } = useLanguage();
    const [dontShow, setDontShow] = useState(false);

    if (mode === 'sheet') {
        return (
            <div className="fixed inset-x-0 top-16 bottom-0 z-40 bg-stone-900/30 flex items-end md:items-center justify-center p-0 md:p-6" role="dialog" aria-modal="true" aria-label={t('interview.technique_title')} onClick={onClose}>
                <div className="w-full max-w-4xl max-h-full overflow-y-auto bg-stone-50 rounded-t-2xl md:rounded-2xl p-4 md:p-6" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-stone-900">{t('interview.technique_title')}</h2>
                        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.close')}</button>
                    </div>
                    <Stages />
                </div>
            </div>
        );
    }

    return (
        <section className="space-y-4" data-testid="interview-technique">
            <h1 className="text-xl font-bold text-stone-900">{t('interview.technique_title')}</h1>
            <Stages />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} className="h-4 w-4 accent-teal-700" />
                    {t('interview.technique_dont_show')}
                </label>
                <button type="button" data-testid="interview-technique-continue" onClick={() => { setHidden(dontShow); onContinue?.(); }}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">
                    {t('interview.technique_continue')} →
                </button>
            </div>
        </section>
    );
}
