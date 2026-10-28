'use client';

/**
 * «¿No es la misma persona? Avisar a un administrador» (D50) on the surviving
 * profile, reached from the `adopter_merged` notice (`?dispute=<auditId>`).
 * The server decides whether this viewer may raise it (getMergeDisputeOption:
 * the owner team of either profile of that merge, not whoever merged); anyone
 * else sees nothing. Raising it asks the admins, who undo the merge or keep it
 * — nothing changes here until they do.
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

/** Refusals that mean the prompt is out of date: say what is true now and hide the button. */
const REFUSALS: Record<string, string> = {
    already_undone: 'adopter.merge_dispute_already_undone',
    superseded: 'adopter.merge_dispute_superseded',
    already_decided: 'adopter.merge_dispute_already_decided',
};

export default function MergeDisputePrompt({ auditId }: { auditId: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<State>('loading');
    const [busy, setBusy] = useState(false);

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

    async function raise() {
        setBusy(true);
        try {
            const res = await raiseMergeDispute(auditId);
            if (res.success) {
                setState('sent');
                return;
            }
            const refusal = res.error ? REFUSALS[res.error] : undefined;
            if (refusal) {
                setState('hidden');
                toast.success(t('common.updated') || 'Actualizado', t(refusal));
                return;
            }
            toast.error(t('errors.generic') || 'Error', t('adopter.merge_dispute_failed'),
                res.errorId ?? resolveErrorId(new Error(`raiseMergeDispute: ${res.error}`), 'MergeDisputePrompt'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t('adopter.merge_dispute_failed'), resolveErrorId(e, 'MergeDisputePrompt'));
        } finally {
            setBusy(false);
        }
    }

    if (state === 'loading' || state === 'hidden') return null;

    return (
        // The shared profile banner (audit B7): a question while it can be raised (warning), a neutral state once it
        // has been (info) — nothing is left to do here then.
        <ProfilePromptBanner tone={state === 'can_raise' ? 'warning' : 'info'} icon={state === 'can_raise' ? ShieldQuestion : Info}
            testId="merge-dispute-prompt" title={t('adopter.merge_dispute_title')}
            actions={state === 'can_raise' ? (
                <Button type="button" variant="secondary" size="compact" data-testid="merge-dispute-raise" onClick={raise} loading={busy}>
                    {t('adopter.merge_dispute_raise')}
                </Button>
            ) : undefined}>
            {state === 'can_raise' ? t('adopter.merge_dispute_body')
                : state === 'sent' ? t('adopter.merge_dispute_sent')
                    : t('adopter.merge_dispute_open')}
        </ProfilePromptBanner>
    );
}
