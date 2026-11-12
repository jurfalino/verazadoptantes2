'use client';

/**
 * The possible duplicate inside the evaluation (spec 2026-11-10, Jon: «must be
 * the side-by-side compare»): when the profile this form created is in an
 * open «¿Es la misma persona?» pair, the panel shows the SAME card
 * /form-results shows — the other profile's header, MatchCompare's
 * «Formulario» / «Perfil existente» blocks with ✓ / ≈ / ≠ and the padlock, and
 * «Sí, es la misma persona» / «No, es otra persona» — preceded by who loaded
 * the other profile («Tuyo» / «Cargado por …»), as «Pendientes de revisar»
 * names it. An answer here is the one answer for everyone (2.58.50).
 *
 * Read lazily per shown applicant; nothing while loading or when there is no
 * pair. A failed read says so with its code.
 *
 * The answer is required before giving an animal (Jon 2026-11-12): «No sé» is
 * offered too, and `onBlockingChange` tells the panel how many pairs still
 * wait for an answer (src/domain/samePersonGate.ts) — null while reading.
 */
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import FormResultMatchCard from '@/components/FormResultMatchCard';
import { getApplicationDuplicates } from '@/app/actions/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { blockingPairCount, pairBlocksGiving } from '@/domain/samePersonGate';

type DuplicatesResult = Omit<Extract<Awaited<ReturnType<typeof getApplicationDuplicates>>, { ok: true }>, 'ok'>;

/** The cards, as read. */
export function DuplicateCards({ result, submissionId, applicantSelfieUrl, onDismiss, onLinked, onUnsureChange }: {
    result: DuplicatesResult;
    submissionId: string;
    applicantSelfieUrl: string | null;
    /** The pair was answered «No, es otra persona»: drop that card. */
    onDismiss: (matchId: string) => void;
    /** «Sí, es la misma persona» went through: the panel re-reads. */
    onLinked: () => void;
    /** «No sé» answered or withdrawn on a pair. */
    onUnsureChange?: (matchId: string, answered: boolean) => void;
}) {
    const { t } = useLanguage();
    if (result.cards.length === 0) return null;
    return (
        <section id="applicant-duplicate" data-testid="applicant-duplicate" className="space-y-3 scroll-mt-4">
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider">{t('samePerson.question')}</h3>
            {result.cards.map(({ match, profile }) => {
                const { addedByName, isMine, ...cardProfile } = profile;
                const owner = isMine
                    ? t('myAdopters.pending_d_mine_tag')
                    : addedByName
                        ? t('myAdopters.pending_dedup_created_by').replace('{name}', addedByName)
                        : t('myAdopters.pending_dedup_created_by_anonymous');
                // «Ir a la pregunta» lands on the first card still waiting for an answer (UX review).
                const waiting = pairBlocksGiving({ viewerMayAnswer: match.canAnswer, unsureBy: match.unsureBy ?? null }, result.canLink);
                return (
                    <div key={match.id} className="space-y-1 scroll-mt-4 focus:outline-none" tabIndex={-1}
                        data-same-person-waiting={waiting ? 'true' : undefined}>
                        <p className="text-xs text-stone-500 [overflow-wrap:anywhere]" data-testid="applicant-duplicate-owner">{owner}</p>
                        <FormResultMatchCard
                            applicant={result.applicant}
                            profile={cardProfile}
                            applicantSelfieUrl={applicantSelfieUrl}
                            matchTypes={match.matchTypes ?? []}
                            score={match.score}
                            submissionId={submissionId}
                            canLink={result.canLink}
                            willMerge={result.willMerge}
                            candidateId={match.candidateId}
                            canAnswer={match.canAnswer}
                            onDismiss={() => onDismiss(match.id)}
                            onLinked={onLinked}
                            unsure={{ offer: true, by: match.unsureBy ?? null, byName: match.unsureByName ?? null, otherSide: match.otherSide, ownerName: addedByName }}
                            onUnsureChange={(answered) => onUnsureChange?.(match.id, answered)}
                        />
                    </div>
                );
            })}
        </section>
    );
}

type Load = { applicationId: string } & ({ state: 'ok'; result: DuplicatesResult } | { state: 'failed'; errorId: string } | { state: 'hidden' });

export function ApplicationDuplicate({ applicationId, submissionId, applicantSelfieUrl, onLinked, onBlockingChange }: {
    applicationId: string;
    submissionId: string;
    applicantSelfieUrl: string | null;
    onLinked: () => void;
    /** How many pairs still wait for an answer before an animal is given; null while reading. */
    onBlockingChange?: (blocking: number | null) => void;
}) {
    const { t } = useLanguage();
    const [load, setLoad] = useState<Load | null>(null);

    // The lock the panel's footer follows. A failed read locks nothing here: the server still refuses.
    const current = load && load.applicationId === applicationId ? load : null;
    const blocking = !current ? null
        : current.state !== 'ok' ? 0
        : blockingPairCount(current.result.cards.map(c => ({ viewerMayAnswer: c.match.canAnswer, unsureBy: c.match.unsureBy ?? null })), current.result.canLink);
    const reportRef = useRef(onBlockingChange);
    reportRef.current = onBlockingChange;
    useEffect(() => { reportRef.current?.(blocking); }, [blocking]);

    useEffect(() => {
        let current = true; // paging away drops a late answer for the previous applicant
        getApplicationDuplicates(applicationId)
            .then((res) => {
                if (!current) return;
                if (res.ok) {
                    const { ok: _ok, ...result } = res;
                    setLoad({ applicationId, state: 'ok', result });
                } else {
                    setLoad({ applicationId, state: 'failed', errorId: res.errorId ?? resolveErrorId(new Error(`getApplicationDuplicates: ${res.error}`), 'ApplicationDuplicate') });
                }
            })
            .catch((e) => {
                if (!current) return;
                // A stale tab: the «new version» notice is the only message.
                setLoad(handledAsStale(e) ? { applicationId, state: 'hidden' } : { applicationId, state: 'failed', errorId: resolveErrorId(e, 'ApplicationDuplicate') });
            });
        return () => { current = false; };
    }, [applicationId]);

    if (!load || load.applicationId !== applicationId || load.state === 'hidden') return null;
    if (load.state === 'failed') {
        return (
            <p className="text-sm text-stone-600" data-testid="applicant-duplicate-failed">
                {t('evaluation.action_failed')} <span className="text-xs text-stone-500">({t('homeModules.error_code')}: {load.errorId})</span>
            </p>
        );
    }
    const { result } = load;
    return (
        <DuplicateCards
            result={result}
            submissionId={submissionId}
            applicantSelfieUrl={applicantSelfieUrl}
            onDismiss={(matchId) => setLoad({ applicationId, state: 'ok', result: { ...result, cards: result.cards.filter(c => c.match.id !== matchId) } })}
            onUnsureChange={(matchId, answered) => setLoad({
                applicationId, state: 'ok',
                result: { ...result, cards: result.cards.map(c => (c.match.id === matchId ? { ...c, match: { ...c.match, unsureBy: answered ? 'me' : null, unsureByName: null } } : c)) },
            })}
            onLinked={() => {
                // The form now belongs to that profile: no pair left to answer here.
                setLoad({ applicationId, state: 'hidden' });
                onLinked();
            }}
        />
    );
}
