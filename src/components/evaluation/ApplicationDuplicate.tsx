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
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import FormResultMatchCard from '@/components/FormResultMatchCard';
import { getApplicationDuplicates } from '@/app/actions/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

type DuplicatesResult = Omit<Extract<Awaited<ReturnType<typeof getApplicationDuplicates>>, { ok: true }>, 'ok'>;

/** The cards, as read. */
export function DuplicateCards({ result, submissionId, applicantSelfieUrl, onDismiss, onLinked }: {
    result: DuplicatesResult;
    submissionId: string;
    applicantSelfieUrl: string | null;
    /** The pair was answered «No, es otra persona»: drop that card. */
    onDismiss: (matchId: string) => void;
    /** «Sí, es la misma persona» went through: the panel re-reads. */
    onLinked: () => void;
}) {
    const { t } = useLanguage();
    if (result.cards.length === 0) return null;
    return (
        <section data-testid="applicant-duplicate" className="space-y-3">
            <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wider">{t('samePerson.question')}</h3>
            {result.cards.map(({ match, profile }) => {
                const { addedByName, isMine, ...cardProfile } = profile;
                const owner = isMine
                    ? t('myAdopters.pending_d_mine_tag')
                    : addedByName
                        ? t('myAdopters.pending_dedup_created_by').replace('{name}', addedByName)
                        : t('myAdopters.pending_dedup_created_by_anonymous');
                return (
                    <div key={match.id} className="space-y-1">
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
                        />
                    </div>
                );
            })}
        </section>
    );
}

type Load = { applicationId: string } & ({ state: 'ok'; result: DuplicatesResult } | { state: 'failed'; errorId: string } | { state: 'hidden' });

export function ApplicationDuplicate({ applicationId, submissionId, applicantSelfieUrl, onLinked }: {
    applicationId: string;
    submissionId: string;
    applicantSelfieUrl: string | null;
    onLinked: () => void;
}) {
    const { t } = useLanguage();
    const [load, setLoad] = useState<Load | null>(null);

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
            onLinked={() => {
                // The form now belongs to that profile: no pair left to answer here.
                setLoad({ applicationId, state: 'hidden' });
                onLinked();
            }}
        />
    );
}
