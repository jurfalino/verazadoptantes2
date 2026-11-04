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
import { PencilLine, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProfilePromptBanner } from '@/components/ProfilePromptBanner';
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

/**
 * «Deshacer» — the one look everywhere it appears (audit B7): the bell's notice, /notificaciones, a history row
 * and the profile's rename banner all use the matrix Secondary button (compact, 44px).
 */
export function RenameUndoButton({ historyId, source, onDone }: { historyId: string; source: string; onDone?: () => void }) {
    const { t } = useLanguage();
    const { undo, busy } = useUndo(source);
    return (
        <Button type="button" variant="secondary" size="compact" data-testid="rename-undo" loading={busy}
            icon={<Undo2 className="w-4 h-4" aria-hidden="true" />}
            onClick={async (e) => { e.stopPropagation(); if (await undo(historyId)) onDone?.(); }}>
            {t('adopter.rename_undo')}
        </Button>
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
        // The shared profile banner (ProfilePromptBanner); «Deshacer» is the same Secondary as everywhere.
        <ProfilePromptBanner tone="warning" icon={PencilLine} testId="rename-undo-prompt" role="dialog" titleId="rename-undo-title"
            title={t('adopter.rename_undo_title')}
            actions={<>
                <Button type="button" variant="secondary" size="compact" data-testid="rename-undo-confirm" loading={busy}
                    icon={<Undo2 className="w-4 h-4" aria-hidden="true" />}
                    onClick={async () => { if (await undo(historyId)) setState({ kind: 'done' }); else setState({ kind: 'hidden' }); }}>
                    {t('adopter.rename_undo')}
                </Button>
                <Button type="button" variant="secondary" size="compact" onClick={() => setState({ kind: 'hidden' })}>
                    {t('adopter.rename_undo_keep')}
                </Button>
            </>}>
            {t('adopter.rename_undo_body').replace('{from}', shown(state.from)).replace('{to}', shown(state.to))}
        </ProfilePromptBanner>
    );
}
