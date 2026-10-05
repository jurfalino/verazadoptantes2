'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { buildQueue, nextUpcomingId } from '@/domain/interview/queue';
import { QUESTION_BANK } from '@/domain/interview/bank';
import { answerHasContent, deriveKnownFacts, identifierSignature } from '@/domain/interview/facts';
import { EMPTY_PREP, STAGES, type Answer, type CandidateSummary, type CustomQuestion, type InterviewContext, type PrepFacts, type Stage } from '@/domain/interview/types';
import { discardInterviewDraft, getInterview, refreshInterviewCandidates, startInterview } from '@/app/actions/interviews';
import type { DraftSummary, InterviewView } from '@/app/actions/interviewTypes';
import { useInterviewAutosave } from './useInterviewAutosave';
import InterviewPrep from './InterviewPrep';
import InterviewTechnique, { techniqueHidden } from './InterviewTechnique';
import InterviewRail from './InterviewRail';
import InterviewFocusPanel from './InterviewFocusPanel';
import InterviewReview from './InterviewReview';

type Phase = 'loading' | 'prep' | 'technique' | 'interview' | 'review';

export default function InterviewApp({ initialDrafts, fromAdopterId, resumeId }: {
    initialDrafts: DraftSummary[];
    fromAdopterId: string | null;
    resumeId: string | null;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [phase, setPhase] = useState<Phase>(fromAdopterId || resumeId ? 'loading' : 'prep');
    const [drafts, setDrafts] = useState(initialDrafts);
    const [interviewId, setInterviewId] = useState<string | null>(null);
    const [prep, setPrep] = useState<PrepFacts>(EMPTY_PREP);
    const [leadCandidateId, setLead] = useState<string | null>(null);
    const [confirmedAdopterId, setConfirmed] = useState<string | null>(null);
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [newCandidateIds, setNewCandidateIds] = useState<string[]>([]);
    const [answers, setAnswers] = useState<Record<string, Answer>>({});
    const [visited, setVisited] = useState<string[]>([]);
    const [custom, setCustom] = useState<CustomQuestion[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [showTechnique, setShowTechnique] = useState(false);

    const fail = useCallback((e: unknown, title: string, source: string) => {
        if (!handledAsStale(e)) toast.error(title, userFacingMessage(e, title), resolveErrorId(e, source));
    }, [toast]);

    const applyView = useCallback((id: string, v: InterviewView) => {
        setInterviewId(id);
        setPrep(v.prep);
        setLead(v.leadCandidateId);
        setConfirmed(v.confirmedAdopterId);
        setCandidates(v.candidates);
        setAnswers(v.answers);
        setVisited(v.visited);
        setCustom(v.custom);
        setPhase(Object.keys(v.answers).length || techniqueHidden() ? 'interview' : 'technique');
    }, []);

    // Entry: from a profile, or resuming a draft.
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (resumeId) {
                    const r = await getInterview(resumeId);
                    if (!active) return;
                    if (r.ok) applyView(resumeId, r.view); else { toast.error(t('interview.load_failed'), undefined, r.errorId); setPhase('prep'); }
                } else if (fromAdopterId) {
                    const r = await startInterview({ adopterId: fromAdopterId });
                    if (!active) return;
                    if (r.ok) applyView(r.interviewId, r.view); else { toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.load_failed'), undefined, r.errorId); setPhase('prep'); }
                }
            } catch (e) {
                fail(e, t('interview.load_failed'), 'InterviewApp.entry');
                if (active) setPhase('prep');
            }
        })();
        return () => { active = false; };
    }, [resumeId, fromAdopterId, applyView, fail, t, toast]);

    const ctx: InterviewContext = useMemo(() => ({
        prep, answers, visited, custom, candidates, ...(confirmedAdopterId ? { confirmedAdopterId } : {}),
    }), [prep, answers, visited, custom, candidates, confirmedAdopterId]);
    const queue = useMemo(() => buildQueue(ctx), [ctx]);
    const known = useMemo(() => deriveKnownFacts(ctx, QUESTION_BANK), [ctx]);
    const current = (currentId && queue.some(i => i.id === currentId)) ? currentId : nextUpcomingId(queue);

    const { status, flush } = useInterviewAutosave({
        interviewId,
        payload: { answers, visited, custom, leadCandidateId },
        enabled: phase === 'interview' || phase === 'review',
    });

    // New identifier → save, then let the server re-match from the stored draft.
    const signature = identifierSignature(known);
    const lastSignature = useRef<string | null>(null);
    useEffect(() => {
        if (!interviewId || phase !== 'interview') return;
        if (lastSignature.current === null) { lastSignature.current = signature; return; }
        if (lastSignature.current === signature) return;
        let active = true;
        // Debounced: a phone typed digit by digit must not re-match (and record) every partial number.
        const timer = setTimeout(async () => {
            lastSignature.current = signature;
            try {
                if (!(await flush())) return;
                const r = await refreshInterviewCandidates(interviewId);
                if (!active || !r.ok) return;
                setCandidates(prev => {
                    const before = new Set(prev.map(c => c.adopterId));
                    const added = r.candidates.filter(c => !before.has(c.adopterId)).map(c => c.adopterId);
                    if (added.length) setNewCandidateIds(ids => [...ids, ...added]);
                    return r.candidates;
                });
            } catch (e) {
                fail(e, t('interview.load_failed'), 'InterviewApp.refreshCandidates');
            }
        }, 1000);
        return () => { active = false; clearTimeout(timer); };
    }, [signature, interviewId, phase, flush, fail, t]);

    const recordAnswer = useCallback((id: string, a: Answer | null) => {
        const keep = a && (a.status !== 'answered' || answerHasContent(a));
        setAnswers(prev => {
            const next = { ...prev };
            if (keep) next[id] = a!; else delete next[id];
            return next;
        });
        setVisited(prev => keep ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter(v => v !== id));
    }, []);

    // Save on Next / Skip / No answer / blur / switching question (spec §3.4).
    // Runs AFTER the render that scheduled the new payload, so it flushes the latest answer.
    const [flushTick, setFlushTick] = useState(0);
    const requestFlush = useCallback(() => setFlushTick(n => n + 1), []);
    useEffect(() => { if (flushTick > 0) void flush(); }, [flushTick, flush]);

    const goNext = useCallback((fromId: string | null) => {
        setCurrentId(nextUpcomingId(queue, fromId));
        requestFlush();
    }, [queue, requestFlush]);
    const selectQuestion = useCallback((id: string) => { setCurrentId(id); requestFlush(); }, [requestFlush]);

    const addCustom = useCallback((text: string, stage: Stage) => {
        const n = custom.reduce((m, c) => Math.max(m, Number(c.id.split(':')[1]) || 0), 0) + 1;
        const q = { id: `custom:${n}`, stage, text: text.trim() };
        setCustom(prev => [...prev, q]);
        setCurrentId(q.id);
    }, [custom]);

    async function begin() {
        setStarting(true);
        try {
            const clean = { ...prep, phones: prep.phones.filter(Boolean), emails: prep.emails.filter(Boolean), socials: prep.socials.filter(Boolean) };
            const r = await startInterview({ prep: clean, leadCandidateId });
            if (!r.ok) { toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.save_failed'), undefined, r.errorId); return; }
            applyView(r.interviewId, r.view);
        } catch (e) {
            fail(e, t('interview.save_failed'), 'InterviewApp.start');
        } finally {
            setStarting(false);
        }
    }

    async function discard(id: string) {
        try {
            const r = await discardInterviewDraft(id);
            if (r.ok) setDrafts(ds => ds.filter(d => d.id !== id));
            else toast.error(t('interview.save_failed'), undefined, r.errorId);
        } catch (e) {
            fail(e, t('interview.save_failed'), 'InterviewApp.discard');
        }
    }

    if (phase === 'loading') {
        return <div className="max-w-6xl mx-auto px-4 text-sm text-stone-500" role="status">{t('interview.saving')}</div>;
    }

    return (
        <div className="max-w-6xl mx-auto px-4">
            {phase === 'prep' && (
                <>
                    {drafts.length > 0 && (
                        <section className="mb-6 bg-white rounded-2xl border border-stone-200 p-4" data-testid="interview-drafts">
                            <h2 className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider">{t('interview.drafts_title')}</h2>
                            <ul className="divide-y divide-stone-100">
                                {drafts.map(d => (
                                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                                        <span className="text-sm text-stone-800 min-w-0 break-words">{d.name}</span>
                                        <span className="flex gap-2 flex-shrink-0">
                                            <button type="button" onClick={() => router.push(`/interview?resume=${d.id}`)} className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">{t('interview.draft_continue')}</button>
                                            <button type="button" onClick={() => discard(d.id)} className="px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.draft_discard')}</button>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <InterviewPrep prep={prep} onPrepChange={setPrep} leadCandidateId={leadCandidateId} onLeadChange={setLead} onStart={begin} starting={starting} />
                </>
            )}

            {phase === 'technique' && <InterviewTechnique mode="screen" onContinue={() => setPhase('interview')} />}

            {phase === 'interview' && (
                <>
                    <header className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-stone-900 break-words">{t('interview.title')} · {prep.name}</h1>
                            <p className="text-xs text-stone-600" data-testid="interview-candidate-status">
                                {confirmedAdopterId
                                    ? t('interview.candidate_confirmed').replace('{name}', candidates.find(c => c.adopterId === confirmedAdopterId)?.displayName ?? '')
                                    : candidates.length === 1 ? t('interview.candidate_one') : t('interview.candidates_count').replace('{n}', String(candidates.length))}
                                {newCandidateIds.length > 0 && <span className="ml-2 font-semibold text-teal-700 motion-safe:animate-pulse">{t('interview.new_candidate')}</span>}
                                <span className="ml-2 text-stone-500" aria-live="polite" data-testid="interview-save-status">
                                    {status === 'saving' ? t('interview.saving') : status === 'saved' ? t('interview.saved') : status === 'offline' ? t('interview.offline') : ''}
                                </span>
                            </p>
                        </div>
                        <ol className="flex items-center gap-1 text-xs font-semibold order-last w-full md:order-none md:w-auto" aria-label={t('interview.title')}>
                            {STAGES.map((st, i) => {
                                const active = queue.find(q => q.id === current)?.stage === st;
                                return (
                                    <li key={st} className="flex items-center gap-1">
                                        {i > 0 && <span className="w-4 h-px bg-stone-300" aria-hidden />}
                                        <span aria-current={active ? 'step' : undefined}
                                            className={`px-2 py-0.5 rounded-full ${active ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-600'}`}>
                                            {t(`interview.stage.${st}`)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setShowTechnique(true)} className="px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.technique_button')}</button>
                            <button type="button" data-testid="interview-finish" onClick={async () => { await flush(); setPhase('review'); }}
                                className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">{t('interview.finish')}</button>
                        </div>
                    </header>
                    <div className="md:grid md:grid-cols-[18rem_1fr] md:gap-6">
                        <InterviewRail queue={queue} answers={answers} custom={custom} currentId={current} onSelect={selectQuestion} onAddCustom={addCustom} />
                        <InterviewFocusPanel
                            interviewId={interviewId!}
                            item={queue.find(i => i.id === current) ?? null}
                            answer={current ? answers[current] ?? null : null}
                            custom={custom}
                            candidates={candidates}
                            onAnswer={recordAnswer}
                            onNext={goNext}
                            onBlurAnswer={requestFlush}
                            flush={flush}
                        />
                    </div>
                    {showTechnique && <InterviewTechnique mode="sheet" onClose={() => setShowTechnique(false)} />}
                </>
            )}

            {phase === 'review' && interviewId && (
                <InterviewReview
                    interviewId={interviewId}
                    known={known}
                    candidates={candidates}
                    confirmedAdopterId={confirmedAdopterId}
                    leadCandidateId={leadCandidateId}
                    flush={flush}
                    onBack={() => setPhase('interview')}
                    onSaved={(adopterId) => { toast.success(t('interview.saved_toast')); router.push(`/adopter/${adopterId}`); }}
                />
            )}
        </div>
    );
}
