'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { questionById } from '@/domain/interview/bank';
import { answerHasContent } from '@/domain/interview/facts';
import type { Answer, CandidateSummary, CustomQuestion, QueueItem } from '@/domain/interview/types';
import { verifyInterviewFact } from '@/app/actions/interviews';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { questionText } from './questionText';
import InterviewAnswerInput from './InterviewAnswerInput';

function VerifyHints({ interviewId, item, answer, candidates, flush }: {
    interviewId: string; item: QueueItem; answer: Answer | null; candidates: CandidateSummary[]; flush: () => Promise<boolean>;
}) {
    const { t } = useLanguage();
    const [results, setResults] = useState<Record<string, boolean>>({});
    const [refused, setRefused] = useState<Record<string, boolean>>({});
    const fact = item.verify!.fact;
    const targets = candidates.filter(c => item.verify!.candidateIds.includes(c.adopterId));
    const protectedIds = targets.filter(c => !c.visible[fact]?.length).map(c => c.adopterId);
    const answerKey = JSON.stringify(answer ?? null);

    useEffect(() => {
        setResults({});
        setRefused({});
        if (!answer || !answerHasContent(answer) || !protectedIds.length) return;
        let active = true;
        const timer = setTimeout(async () => {
            if (!(await flush())) return;
            for (const id of protectedIds) {
                try {
                    const r = await verifyInterviewFact(interviewId, item.id, id);
                    if (!active) return;
                    if (r.ok) setResults(prev => ({ ...prev, [id]: r.match }));
                    else setRefused(prev => ({ ...prev, [id]: true }));
                } catch (e) {
                    resolveErrorId(e, 'InterviewFocusPanel.verify');
                    if (active) setRefused(prev => ({ ...prev, [id]: true }));
                }
            }
        }, 1000);
        return () => { active = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the answer or the target set changes
    }, [answerKey, protectedIds.join(','), interviewId, fact]);

    return (
        <div className="mt-3 space-y-1.5" data-testid="interview-verify">
            {targets.map(c => {
                const shown = c.visible[fact];
                if (shown?.length) {
                    return (
                        <p key={c.adopterId} className="text-xs text-stone-700 bg-stone-100 rounded-lg px-3 py-2">
                            {t('interview.verify_on_profile').replace('{name}', c.displayName)} <strong className="font-semibold break-all">{shown.join(', ')}</strong>
                        </p>
                    );
                }
                if (refused[c.adopterId]) return null;
                const r = results[c.adopterId];
                return (
                    <p key={c.adopterId} data-testid={`interview-verify-${c.adopterId}`}
                        className={`text-xs rounded-lg px-3 py-2 ${r === true ? 'bg-teal-50 text-teal-800' : r === false ? 'bg-stone-100 text-stone-700' : 'text-stone-500'}`}>
                        {r === true ? t('interview.verify_match').replace('{name}', c.displayName)
                            : r === false ? t('interview.verify_nomatch').replace('{name}', c.displayName)
                            : t('interview.verify_pending')}
                    </p>
                );
            })}
        </div>
    );
}

export default function InterviewFocusPanel({ interviewId, item, answer, custom, candidates, onAnswer, onNext, onBlurAnswer, flush }: {
    interviewId: string;
    item: QueueItem | null;
    answer: Answer | null;
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    onAnswer: (id: string, a: Answer | null) => void;
    onNext: (fromId: string | null) => void;
    onBlurAnswer: () => void;
    flush: () => Promise<boolean>;
}) {
    const { t } = useLanguage();
    if (!item) {
        return <section className="bg-white rounded-2xl border border-stone-200 p-6 text-sm text-stone-600">{t('interview.finish')} →</section>;
    }
    const def = questionById(item.id);
    const kind = def?.kind ?? 'text';
    return (
        <section className="bg-white rounded-2xl border border-stone-200 p-4 md:p-6" data-testid="interview-focus">
            <p className="text-xs font-semibold text-teal-800 uppercase tracking-wider">{t('interview.now')} · {t(`interview.stage.${item.stage}`)}</p>
            <h2 className="mt-2 text-lg md:text-xl font-semibold text-stone-900 break-words" data-testid="interview-question">{questionText(t, item.id, custom)}</h2>
            {def?.hint && <p className="mt-1 text-sm text-stone-600">{t(`interview.h.${item.id}`)}</p>}
            {item.added && <p className="mt-1 text-xs text-teal-700">{t(item.added.reasonKey)}</p>}
            <div className="mt-4" onBlur={onBlurAnswer}>
                <label className="sr-only">{t('interview.answer_label')}</label>
                <InterviewAnswerInput key={item.id} kind={kind} choices={def?.choices} value={answer} onChange={a => onAnswer(item.id, a)} onSubmit={() => onNext(item.id)} />
            </div>
            {item.verify && <VerifyHints interviewId={interviewId} item={item} answer={answer} candidates={candidates} flush={flush} />}
            <div className="mt-4 flex flex-wrap justify-between gap-2 pt-4 border-t border-teal-100/50">
                <div className="flex gap-2">
                    <button type="button" data-testid="interview-skip" onClick={() => { onAnswer(item.id, { status: 'skipped' }); onNext(item.id); }}
                        className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.skip')}</button>
                    <button type="button" data-testid="interview-no-answer" onClick={() => { onAnswer(item.id, { status: 'no_answer' }); onNext(item.id); }}
                        className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.no_answer')}</button>
                </div>
                <button type="button" data-testid="interview-next" onClick={() => onNext(item.id)}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">{t('interview.next')} →</button>
            </div>
        </section>
    );
}
