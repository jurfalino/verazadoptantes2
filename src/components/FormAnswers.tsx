'use client';

/**
 * The answers of a rescue's own adoption form, sent through the API
 * (activity.formContent): any JSON shape, shown as question → answer. Plain
 * text only (React escapes everything); nesting becomes indented groups.
 */
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const MAX_DEPTH = 6;

function Value({ value, depth }: { value: unknown; depth: number }) {
    const { t } = useLanguage();
    if (value === null || value === undefined || value === '') return <span className="text-stone-400">—</span>;
    if (typeof value === 'boolean') return <>{value ? t('adopter.form_api_yes') : t('adopter.form_api_no')}</>;
    if (typeof value !== 'object') return <>{String(value)}</>;
    if (depth >= MAX_DEPTH) return <span className="break-all">{JSON.stringify(value)}</span>;
    if (Array.isArray(value)) {
        if (value.every(v => v === null || typeof v !== 'object')) {
            return <>{value.map(v => (typeof v === 'boolean' ? (v ? t('adopter.form_api_yes') : t('adopter.form_api_no')) : String(v ?? '—'))).join(', ')}</>;
        }
        return (
            <div className="space-y-1">
                {value.map((v, i) => (
                    <div key={i} className="pl-2 border-l-2 border-stone-200"><Value value={v} depth={depth + 1} /></div>
                ))}
            </div>
        );
    }
    return <Answers data={value as Record<string, unknown>} depth={depth + 1} />;
}

function Answers({ data, depth }: { data: Record<string, unknown>; depth: number }) {
    return (
        <dl className="space-y-2">
            {Object.entries(data).map(([q, a]) => (
                <div key={q} className="min-w-0">
                    <dt className="text-xs font-semibold text-stone-500 break-words">{q}</dt>
                    <dd className="text-xs text-stone-700 break-words whitespace-pre-line">
                        <Value value={a} depth={depth} />
                    </dd>
                </div>
            ))}
        </dl>
    );
}

export default function FormAnswers({ formContent }: { formContent: Record<string, unknown> }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-2.5" data-testid="activity-form-answers">
            <button
                type="button"
                aria-expanded={open}
                onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
                className="flex w-full items-center gap-2 p-2 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors text-left"
            >
                <svg className="w-4 h-4 text-teal-700 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                <span className="text-sm font-medium text-teal-700">{open ? t('adopter.form_api_hide') : t('adopter.form_api_answers')}</span>
                <svg className={`w-3.5 h-3.5 ml-auto text-teal-700 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {open && (
                <div className="mt-2 p-3 rounded-lg bg-stone-50 border border-stone-100" onClick={e => e.stopPropagation()}>
                    <p className="text-[11px] text-stone-400 mb-2">{t('adopter.form_api_source')}</p>
                    <Answers data={formContent} depth={0} />
                </div>
            )}
        </div>
    );
}
