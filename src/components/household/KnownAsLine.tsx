'use client';

/**
 * «Conocido/a como: Pedro Paez» under a profile's name — the names a rename
 * kept, still found by search. A junk one (someone typed nonsense, then
 * renamed) can be taken out by the profile's team, an admin or a moderator
 * only (the server's rule for rename aliases, removeContactEntry): a small ×
 * per name, with a confirm, removes every rename alias behind that name.
 * Nobody else sees the control (and never in «Ver como desconocido»).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { removeContactEntry } from '@/app/actions';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { fill } from '@/lib/householdCopy';

export function KnownAsLine({ adopterId, entries, canRemove }: {
    adopterId: string;
    entries: Array<{ name: string; ids: string[] }>;
    canRemove: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [target, setTarget] = useState<{ name: string; ids: string[] } | null>(null);
    const [busy, setBusy] = useState(false);
    if (entries.length === 0) return null;

    async function remove() {
        if (!target) return;
        setBusy(true);
        try {
            for (const entryId of target.ids) {
                const res = await removeContactEntry({ adopterId, entryId });
                if (!res.ok) {
                    const errorId = 'errorId' in res && typeof res.errorId === 'string' ? res.errorId : resolveErrorId(new Error(`removeContactEntry (rename alias): ${res.error}`), 'KnownAsLine');
                    toast.error(t('errors.generic'), res.error === 'busy' ? t('collab.busy') : t('adopter.known_as_remove_failed'), errorId);
                    return;
                }
            }
            setTarget(null);
            router.refresh();
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.known_as_remove_failed'), resolveErrorId(e, 'KnownAsLine'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
        <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--text-muted)' }} data-testid="profile-known-as">
            {t('adopter.known_as')}{' '}
            {entries.map((e, i) => (
                <span key={e.name} className="inline-flex items-center align-middle">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{e.name}</span>
                    {canRemove && e.ids.length > 0 && (
                        <button type="button" onClick={() => setTarget(e)} data-testid="profile-known-as-remove"
                            aria-label={fill(t('adopter.known_as_remove'), { name: e.name })} title={fill(t('adopter.known_as_remove'), { name: e.name })}
                            className="inline-flex min-w-[44px] min-h-[44px] -my-3 items-center justify-center rounded text-stone-500 hover:text-red-600 hover:bg-red-50">
                            <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                    )}
                    {i < entries.length - 1 && <span>,&nbsp;</span>}
                </span>
            ))}
        </p>
            <ConfirmDialog
                open={!!target}
                busy={busy}
                title={fill(t('adopter.known_as_remove_title'), { name: target?.name ?? '' })}
                message={fill(t('adopter.known_as_remove_body'), { name: target?.name ?? '' })}
                onConfirm={() => { void remove(); }}
                onCancel={() => setTarget(null)}
            />
        </>
    );
}
