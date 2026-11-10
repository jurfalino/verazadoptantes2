'use client';

/**
 * «¿No es la misma persona?» (D50) — «Son dos personas distintas» asks the
 * admins to review a merge; they undo it or keep it, and nothing changes here
 * until they do. Split like rename «Deshacer» (src/components/RenameUndo.tsx):
 *
 * - `MergeDisputeButton`: the one button, wherever it appears.
 * - `MergeDisputeHistoryAction`: the button and its line on the newest live
 *   merge's «Perfiles unidos» history row (H2), so the dispute is reachable
 *   without the notice. The page decides on the server who sees it
 *   (mergeDisputeForProfile).
 * - `MergeDisputePrompt` (default): the profile banner the `adopter_merged`
 *   notice opens (`?dispute=<auditId>`); it asks getMergeDisputeOption.
 *
 * Either way the server decides whether this viewer may raise it (the owner
 * team of either profile of that merge, not whoever merged); anyone else sees
 * nothing.
 */

import { useEffect, useState } from 'react';
import { Info, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProfilePromptBanner } from '@/components/ProfilePromptBanner';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { getMergeDisputeOption, raiseMergeDispute } from '@/app/actions/mergeDisputes';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

type State = 'loading' | 'hidden' | 'can_raise' | 'open' | 'sent';
/** What a tap ended in: told the admins, or out of date (said in a toast, the button goes). Null: failed, toasted. */
type RaiseOutcome = 'sent' | 'hidden' | null;

/** Refusals that mean the prompt is out of date: say what is true now and hide the button. */
const REFUSALS: Record<string, string> = {
    already_undone: 'adopter.merge_dispute_already_undone',
    superseded: 'adopter.merge_dispute_superseded',
    already_decided: 'adopter.merge_dispute_already_decided',
};

/**
 * «Son dos personas distintas» — the one look everywhere it appears (the notice's banner and the history row): the
 * matrix Secondary button (compact, 44px). The server checks again who may raise it.
 */
export function MergeDisputeButton({ auditId, source, onRaised }: { auditId: string; source: string; onRaised: (outcome: 'sent' | 'hidden') => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [busy, setBusy] = useState(false);

    async function raise(): Promise<RaiseOutcome> {
        try {
            const res = await raiseMergeDispute(auditId);
            if (res.success) return 'sent';
            const refusal = res.error ? REFUSALS[res.error] : undefined;
            if (refusal) {
                toast.success(t('common.updated') || 'Actualizado', t(refusal));
                return 'hidden';
            }
            toast.error(t('errors.generic') || 'Error', t('adopter.merge_dispute_failed'),
                res.errorId ?? resolveErrorId(new Error(`raiseMergeDispute: ${res.error}`), source));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('adopter.merge_dispute_failed'), resolveErrorId(e, source));
        }
        return null;
    }

    return (
        <Button type="button" variant="secondary" size="compact" data-testid="merge-dispute-raise" loading={busy}
            onClick={async (e) => {
                e.stopPropagation();
                setBusy(true);
                const outcome = await raise();
                setBusy(false);
                if (outcome) onRaised(outcome);
            }}>
            {t('adopter.merge_dispute_raise')}
        </Button>
    );
}

/** The newest live merge's history row (H2): the button and what it does, then what is true once raised. */
export function MergeDisputeHistoryAction({ auditId, initial }: { auditId: string; initial: 'can_raise' | 'open' }) {
    const { t } = useLanguage();
    const [state, setState] = useState<'can_raise' | 'open' | 'sent' | 'hidden'>(initial);
    if (state === 'hidden') return null;
    return (
        <div className="mt-2 space-y-1" data-testid="history-merge-dispute">
            {state === 'can_raise' && (
                <MergeDisputeButton auditId={auditId} source="AdopterProfileV2.history" onRaised={setState} />
            )}
            <p className="text-xs text-teal-800 break-words">
                {state === 'can_raise' ? t('adopter.merge_dispute_body')
                    : state === 'sent' ? t('adopter.merge_dispute_sent')
                        : t('adopter.merge_dispute_open')}
            </p>
        </div>
    );
}

export default function MergeDisputePrompt({ auditId }: { auditId: string }) {
    const { t } = useLanguage();
    const [state, setState] = useState<State>('loading');

    useEffect(() => {
        let live = true;
        getMergeDisputeOption(auditId)
            .then(o => { if (live) setState(o.canRaise ? 'can_raise' : o.status === 'open' ? 'open' : 'hidden'); })
            .catch(e => {
                // The prompt is optional; the profile works without it. Reported, not swallowed.
                if (live) setState('hidden');
                if (!handledAsStale(e)) resolveErrorId(e, 'MergeDisputePrompt');
            });
        return () => { live = false; };
    }, [auditId]);

    if (state === 'loading' || state === 'hidden') return null;

    return (
        // The shared profile banner (audit B7): a question while it can be raised (warning), a neutral state once it
        // has been (info) — nothing is left to do here then.
        <ProfilePromptBanner tone={state === 'can_raise' ? 'warning' : 'info'} icon={state === 'can_raise' ? ShieldQuestion : Info}
            testId="merge-dispute-prompt" title={t('adopter.merge_dispute_title')}
            actions={state === 'can_raise' ? (
                <MergeDisputeButton auditId={auditId} source="MergeDisputePrompt" onRaised={setState} />
            ) : undefined}>
            {state === 'can_raise' ? t('adopter.merge_dispute_body')
                : state === 'sent' ? t('adopter.merge_dispute_sent')
                    : t('adopter.merge_dispute_open')}
        </ProfilePromptBanner>
    );
}
