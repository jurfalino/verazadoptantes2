'use client';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { STAGES, type Answer, type CustomQuestion, type QueueItem, type Stage } from '@/domain/interview/types';
import { questionText } from './questionText';
import { StateIcon } from './icons';

function preview(a: Answer | undefined, t: (k: string) => string): string {
    if (!a) return '';
    if (a.status === 'skipped') return t('interview.skipped');
    if (a.status === 'no_answer') return t('interview.not_answered');
    if (a.text) return a.text;
    if (a.choice) return t(`interview.choice.${a.choice}`);
    if (typeof a.number === 'number') return String(a.number);
    if (a.contacts?.length) return a.contacts.map(c => c.value).filter(Boolean).join(', ');
    if (a.household?.length) return a.household.map(h => h.name).filter(Boolean).join(', ');
    return '';
}

export default function InterviewRail({ queue, answers, custom, currentId, onSelect, onAddCustom }: {
    queue: QueueItem[];
    answers: Record<string, Answer>;
    custom: CustomQuestion[];
    currentId: string | null;
    onSelect: (id: string) => void;
    onAddCustom: (text: string, stage: Stage) => void;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const done = queue.filter(i => i.state !== 'upcoming').length;
    const currentStage = queue.find(i => i.id === currentId)?.stage ?? 'rapport';

    return (
        <>
            <button type="button" data-testid="interview-rail-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
                className="md:hidden mb-3 w-full px-4 py-2 text-sm font-semibold text-teal-800 bg-white border border-teal-200 rounded-lg">
                {t('interview.questions_drawer').replace('{done}', String(done)).replace('{total}', String(queue.length))}
            </button>
            <aside data-testid="interview-rail" aria-label={t('interview.title')}
                className={`${open ? 'fixed inset-x-0 top-16 bottom-0 z-30 overflow-y-auto p-4' : 'hidden'} bg-stone-50 md:block md:static md:p-0 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:sticky md:top-20`}>
                {STAGES.map(stage => {
                    const items = queue.filter(i => i.stage === stage);
                    if (!items.length) return null;
                    return (
                        <div key={stage} className="mb-4">
                            <h3 className="text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">{t(`interview.stage.${stage}`)}</h3>
                            <ul className="space-y-0.5">
                                {items.map(i => {
                                    const isCurrent = i.id === currentId;
                                    return (
                                        <li key={i.id}>
                                            <button type="button" data-testid={`interview-rail-item-${i.id}`} aria-current={isCurrent ? 'step' : undefined}
                                                onClick={() => { onSelect(i.id); setOpen(false); }}
                                                className={`w-full text-left flex gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${isCurrent ? 'bg-teal-700 text-white' : i.state === 'upcoming' ? 'text-stone-500 hover:bg-white' : 'text-stone-800 hover:bg-white'}`}>
                                                <StateIcon state={isCurrent ? 'current' : i.state} added={!!i.added} />
                                                <span className="min-w-0">
                                                    <span className="block break-words">{questionText(t, i.id, custom)}</span>
                                                    {i.state !== 'upcoming' && !isCurrent && <span className="block text-xs text-stone-500 truncate">{preview(answers[i.id], t)}</span>}
                                                    {i.added && i.state === 'upcoming' && !isCurrent && <span className="block text-xs text-teal-700">{t(i.added.reasonKey)}</span>}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
                <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim()) { onAddCustom(draft, currentStage); setDraft(''); setOpen(false); } }}>
                    <input aria-label={t('interview.add_question')} placeholder={t('interview.add_question_placeholder')} value={draft} onChange={e => setDraft(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-teal-200 bg-white text-base md:text-sm outline-none focus:border-teal-500" />
                    <button type="submit" className="px-3 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">{t('interview.add_question_save')}</button>
                </form>
            </aside>
        </>
    );
}
