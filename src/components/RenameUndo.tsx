'use client';

/**
 * «Deshacer» a rename (households as profiles, Task 3). Anyone signed in can
 * rename a profile; the owner's team (or an admin) can put the name back from
 * the bell, the history, or the email link.
 *
 * - `RenameUndoButton`: the in-app action (bell, /notificaciones, history).
 *   A deliberate click on a button — the server checks who may undo.
 * - `RenameUndoPrompt`: what the email's «Deshacer» opens on the profile
 *   (`?undoRename=<historyId>`). A link never changes anything by itself: the
 *   prompt asks first, and only its button undoes. The page itself requires
 *   sign-in, and the sign-in round trip keeps the query.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { getRenameUndoOption, undoProfileRename } from '@/app/actions';
import type { UndoProfileRenameResult } from '@/app/actions';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

/** The refusals that mean «nothing to undo any more»: said plainly, never as an error. */
const REFUSALS: Record<string, string> = {
    already_undone: 'adopter.rename_undo_already',
    superseded: 'adopter.rename_undo_superseded',
    not_undoable: 'adopter.rename_undo_already',
    not_authorized: 'adopter.rename_undo_not_authorized',
};

/** Run the undo and tell the person what happened. True when the name was put back. */
function useUndo(source: string) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    async function undo(historyId: string): Promise<boolean> {
        setBusy(true);
        let res: UndoProfileRenameResult | null = null;
        try {
            res = await undoProfileRename(historyId);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.rename_undo_failed'), resolveErrorId(e, source));
            setBusy(false);
            return false;
        }
        setBusy(false);
        if (res.ok) {
            toast.success('✓', t('adopter.rename_undo_done').replace('{name}', res.name));
            router.refresh();
            return true;
        }
        const refusal = REFUSALS[res.error];
        if (refusal) {
            toast.info(t('adopter.rename_undo'), t(refusal));
            return false;
        }
        toast.error(t('errors.generic'), res.error === 'busy' ? t('collab.busy') : t('adopter.rename_undo_failed'),
            res.errorId ?? resolveErrorId(new Error(`undoProfileRename: ${res.error}`), source));
        return false;
    }
    return { undo, busy };
}

/** `variant`: 'outlined' (the bell's notice action) or 'link' (a history row, like «Ver perfil ↗»). */
export function RenameUndoButton({ historyId, source, onDone, variant = 'outlined' }: { historyId: string; source: string; onDone?: () => void; variant?: 'outlined' | 'link' }) {
    const { t } = useLanguage();
    const { undo, busy } = useUndo(source);
    return (
        <button type="button" data-testid="rename-undo" disabled={busy}
            onClick={async (e) => { e.stopPropagation(); if (await undo(historyId)) onDone?.(); }}
            className={variant === 'link'
                ? 'inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-700 hover:underline disabled:opacity-60'
                : 'inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-lg text-sm font-semibold border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--brand)] disabled:opacity-60'}>
            <Undo2 className="w-4 h-4" aria-hidden="true" />
            {t('adopter.rename_undo')}
        </button>
    );
}

type PromptState = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ask'; from: string; to: string } | { kind: 'done' };

export default function RenameUndoPrompt({ historyId }: { historyId: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const { undo, busy } = useUndo('RenameUndoPrompt');
    const [state, setState] = useState<PromptState>({ kind: 'loading' });

    useEffect(() => {
        let live = true;
        getRenameUndoOption(historyId)
            .then(o => {
                if (!live) return;
                if (o.status === 'can_undo') { setState({ kind: 'ask', from: o.from, to: o.to }); return; }
                setState({ kind: 'hidden' });
                const refusal = REFUSALS[o.status];
                if (refusal) toast.info(t('adopter.rename_undo'), t(refusal));
                else if (o.status === 'failed') toast.error(t('errors.generic'), t('adopter.rename_undo_failed'), resolveErrorId(new Error('getRenameUndoOption failed'), 'RenameUndoPrompt'));
            })
            .catch(e => {
                if (live) setState({ kind: 'hidden' });
                if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.rename_undo_failed'), resolveErrorId(e, 'RenameUndoPrompt'));
            });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link
    }, [historyId]);

    if (state.kind !== 'ask') return null;
    const shown = (name: string) => name.trim() || t('adopter.nameless');
    return (
        <div data-testid="rename-undo-prompt" role="dialog" aria-labelledby="rename-undo-title"
            className="rounded-xl border p-4 text-sm flex flex-col gap-3 bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--text-primary)]">
            <div className="min-w-0">
                <p id="rename-undo-title" className="font-semibold text-[var(--status-warning-text)]">{t('adopter.rename_undo_title')}</p>
                <p className="text-[13px] text-[var(--text-muted)] break-words">
                    {t('adopter.rename_undo_body').replace('{from}', shown(state.from)).replace('{to}', shown(state.to))}
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="rename-undo-confirm" disabled={busy}
                    onClick={async () => { if (await undo(historyId)) setState({ kind: 'done' }); else setState({ kind: 'hidden' }); }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 px-4 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-600 disabled:opacity-60">
                    <Undo2 className="w-4 h-4" aria-hidden="true" />
                    {t('adopter.rename_undo')}
                </button>
                <button type="button" onClick={() => setState({ kind: 'hidden' })}
                    className="inline-flex min-h-[44px] items-center px-4 rounded-lg text-sm font-semibold text-teal-700 hover:bg-teal-50">
                    {t('adopter.rename_undo_keep')}
                </button>
            </div>
        </div>
    );
}
