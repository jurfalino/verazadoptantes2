'use client';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import type { Answer, AnswerKind, ContactType } from '@/domain/interview/types';

const INPUT = 'w-full h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm';
const TEXTAREA = 'w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y text-base md:text-sm';
const CONTACT_TYPES: ContactType[] = ['phone', 'email', 'social'];

export default function InterviewAnswerInput({ kind, choices, value, onChange, onSubmit, defaultContactType }: {
    kind: AnswerKind;
    choices?: readonly string[];
    value: Answer | null;
    onChange: (a: Answer | null) => void;
    onSubmit: () => void;
    defaultContactType: ContactType;
}) {
    const { t } = useLanguage();
    // Rows live locally so an empty row (type chosen, nothing typed yet) survives; the parent only sees content.
    const [contactRows, setContactRows] = useState<{ type: ContactType; value: string }[]>(() => value?.contacts?.length ? value.contacts : [{ type: defaultContactType, value: '' }]);
    const [householdRows, setHouseholdRows] = useState<{ name: string; relationship: Relationship | null }[]>(() => value?.household?.length ? value.household : [{ name: '', relationship: null }]);
    const answered = (patch: Partial<Answer>): Answer => ({ status: 'answered', ...patch });

    if (kind === 'text') {
        return (
            <textarea data-testid="interview-answer" className={TEXTAREA} rows={4} placeholder={t('interview.answer_placeholder')}
                value={value?.text ?? ''} onChange={e => onChange(answered({ text: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} />
        );
    }
    if (kind === 'number') {
        return (
            <input data-testid="interview-answer" type="number" inputMode="numeric" min={0} max={1000} className={`${INPUT} max-w-[10rem]`}
                value={value?.number ?? ''} onChange={e => onChange(e.target.value === '' ? null : answered({ number: Number(e.target.value) }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }} />
        );
    }
    if (kind === 'choice') {
        return (
            <div className="flex flex-wrap gap-2" role="radiogroup">
                {(choices ?? []).map(c => (
                    <button key={c} type="button" role="radio" aria-checked={value?.choice === c} data-testid={`interview-choice-${c}`}
                        onClick={() => onChange(answered({ choice: c }))}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${value?.choice === c ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-teal-800 border-teal-200 hover:bg-teal-50'}`}>
                        {t(`interview.choice.${c}`)}
                    </button>
                ))}
            </div>
        );
    }
    if (kind === 'contact') {
        const rows = contactRows;
        const set = (next: typeof rows) => {
            setContactRows(next);
            onChange(next.some(r => r.value.trim()) ? answered({ contacts: next }) : null);
        };
        return (
            <div className="space-y-2">
                {rows.map((r, i) => (
                    <div key={i} className="flex gap-2">
                        <select aria-label={t('interview.answer_label')} className={`${INPUT} max-w-[9rem] px-2`} value={r.type}
                            onChange={e => set(rows.map((x, j) => j === i ? { ...x, type: e.target.value as ContactType } : x))}>
                            {CONTACT_TYPES.map(ct => <option key={ct} value={ct}>{t(`interview.contact_type_${ct}`)}</option>)}
                        </select>
                        <input data-testid={`interview-contact-${i}`} className={INPUT} value={r.value}
                            inputMode={r.type === 'phone' ? 'tel' : r.type === 'email' ? 'email' : 'text'}
                            onChange={e => set(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                        {rows.length > 1 && (
                            <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="px-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.remove')}</button>
                        )}
                    </div>
                ))}
                <button type="button" onClick={() => set([...rows, { type: rows.at(-1)?.type ?? defaultContactType, value: '' }])} className="text-xs font-semibold text-teal-700 hover:underline">{t('interview.prep_add_row')}</button>
            </div>
        );
    }
    // household
    const rows = householdRows;
    const set = (next: typeof rows) => {
        setHouseholdRows(next);
        onChange(next.some(r => r.name.trim()) ? answered({ household: next }) : null);
    };
    return (
        <div className="space-y-2">
            {rows.map((r, i) => (
                <div key={i} className="flex gap-2">
                    <input data-testid={`interview-household-${i}`} aria-label={t('interview.household_name')} placeholder={t('interview.household_name')} className={INPUT} value={r.name}
                        onChange={e => set(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <select aria-label={t('adopter.hh_rel')} className={`${INPUT} max-w-[11rem] px-2`} value={r.relationship ?? ''}
                        onChange={e => set(rows.map((x, j) => j === i ? { ...x, relationship: (e.target.value || null) as Relationship | null } : x))}>
                        <option value="">{t('adopter.hh_rel_choose')}</option>
                        {RELATIONSHIPS.map(rel => <option key={rel} value={rel}>{t(`adopter.hh_rel_${rel}`)}</option>)}
                    </select>
                    {rows.length > 1 && (
                        <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="px-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.remove')}</button>
                    )}
                </div>
            ))}
            <button type="button" onClick={() => set([...rows, { name: '', relationship: null }])} className="text-xs font-semibold text-teal-700 hover:underline">{t('interview.household_add')}</button>
        </div>
    );
}
