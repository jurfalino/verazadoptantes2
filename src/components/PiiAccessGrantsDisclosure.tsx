'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { revokePiiAccessGrant } from '@/app/actions/piiAccess';
import type { AdopterPiiContext } from '@/lib/piiAccess';

/**
 * Owner / editor / admin "who has access" disclosure. Lists everyone holding an
 * approved full-contact grant (each individually revocable) and shows the
 * search-match grants as an aggregate count — those aren't listed or revocable,
 * since the viewer can simply re-search to re-earn them (Resolution #2).
 */
export default function PiiAccessGrantsDisclosure({ grants }: { grants: AdopterPiiContext['accessGrants'] }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [allContact, setAllContact] = useState(grants.allContact);
    const [open, setOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    if (allContact.length === 0 && grants.searchMatchCount === 0) return null;

    async function revoke(grantId: string) {
        setBusyId(grantId);
        try {
            const res = await revokePiiAccessGrant(grantId);
            if (res.ok) {
                setAllContact(prev => prev.filter(g => g.grantId !== grantId));
                toast.success('✓', t('adopter.pii_grants_revoked_toast'));
            } else {
                toast.error(t('errors.generic'), res.error || t('adopter.pii_request_error'));
            }
        } catch {
            toast.error(t('errors.generic'), t('adopter.pii_request_error'));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 text-sm"
            >
                <span className="font-semibold text-stone-700 flex items-center gap-2">
                    <span aria-hidden>🔓</span>
                    {t('adopter.pii_grants_title')}
                    <span className="font-normal text-stone-500">({allContact.length})</span>
                </span>
                <span className="text-stone-400 text-xs" aria-hidden>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="mt-3 space-y-2">
                    {allContact.length > 0 ? (
                        <ul className="space-y-1.5">
                            {allContact.map(g => (
                                <li key={g.grantId} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-stone-700 truncate">{g.granteeName}</span>
                                    <button
                                        type="button"
                                        onClick={() => revoke(g.grantId)}
                                        disabled={busyId === g.grantId}
                                        className="shrink-0 text-xs font-semibold text-rose-600 hover:opacity-70 transition-opacity disabled:opacity-50"
                                    >
                                        {t('adopter.pii_grants_revoke')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-stone-400 italic">{t('adopter.pii_grants_none_full')}</p>
                    )}
                    {grants.searchMatchCount > 0 && (
                        <p className="text-xs text-stone-500 border-t border-stone-100 pt-2">
                            {t('adopter.pii_grants_search_count').replace('{n}', String(grants.searchMatchCount))}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
