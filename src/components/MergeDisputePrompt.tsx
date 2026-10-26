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
import { ShieldQuestion } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { getMergeDisputeOption, raiseMergeDispute } from '@/app/actions/mergeDisputes';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

type State = 'loading' | 'hidden' | 'can_raise' | 'open' | 'sent';

/** Refusals that mean the prompt is out of date: say what is true now and hide the button. */
const REFUSALS: Record<string, string> = {
    already_undone: 'adopter.merge_dispute_already_undone',
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
        <div data-testid="merge-dispute-prompt" role="status"
            className="rounded-xl border p-3 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--text-primary)]">
            <div className="flex items-start gap-2 min-w-0">
                <ShieldQuestion className="w-5 h-5 shrink-0 text-[var(--status-warning-text)]" aria-hidden="true" />
                <div className="min-w-0">
                    <p className="font-semibold text-[var(--status-warning-text)]">{t('adopter.merge_dispute_title')}</p>
                    <p className="text-[13px] text-[var(--text-muted)]">
                        {state === 'can_raise' ? t('adopter.merge_dispute_body')
                            : state === 'sent' ? t('adopter.merge_dispute_sent')
                                : t('adopter.merge_dispute_open')}
                    </p>
                </div>
            </div>
            {state === 'can_raise' && (
                <button type="button" data-testid="merge-dispute-raise" onClick={raise} disabled={busy}
                    className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-[14px] font-bold shrink-0 border border-[var(--status-warning-border)] text-[var(--status-warning-text)] bg-[var(--surface-card)] hover:bg-[var(--accent-subtle-bg)] disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy ? (t('common.processing') || 'Procesando...') : t('adopter.merge_dispute_raise')}
                </button>
            )}
        </div>
    );
}
