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

    const orgMates = grants.orgMates ?? [];
    const searchMatch = grants.searchMatch ?? [];
    // v2.19.25: count chip + render gate include org-mates too — they're
    // listed alongside the explicit `allContact` grants as another category
    // of "people who can see this record's PII".
    const totalCount = allContact.length + orgMates.length;
    if (totalCount === 0 && searchMatch.length === 0) return null;

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
                    <span className="font-normal text-stone-500">({totalCount})</span>
                </span>
                <span className="text-stone-400 text-xs" aria-hidden>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="mt-3 space-y-2">
                    {allContact.length > 0 && (
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
                    )}
                    {/* v2.19.25: org-mates of the record's owner. Implicit
                        access (no request flow), so no revoke affordance —
                        managing it is an org-membership change at the org-
                        admin level, not a per-adopter action. Visually
                        deemphasised vs. explicit grants. */}
                    {orgMates.length > 0 && (
                        <div className={allContact.length > 0 ? 'pt-2 border-t border-stone-100' : ''}>
                            <p className="text-xs font-semibold text-stone-500 mb-1.5">
                                {t('adopter.pii_grants_orgmates_title')}
                            </p>
                            <ul className="space-y-1.5">
                                {orgMates.map(m => (
                                    <li key={m.granteeEmail} className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-stone-700 truncate">{m.granteeName}</span>
                                        <span className="shrink-0 flex flex-wrap items-center justify-end gap-1">
                                            {m.orgs.map(o => (
                                                <span
                                                    key={o.id}
                                                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-100"
                                                    title={o.name}
                                                >
                                                    {o.name}
                                                </span>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {allContact.length === 0 && orgMates.length === 0 && (
                        <p className="text-sm text-stone-400 italic">{t('adopter.pii_grants_none_full')}</p>
                    )}
                    {/* v2.19.26: search-match grants per grantee. The
                        aggregate "1 dato desbloqueado" line was useless when
                        the owner wanted to know WHO matched something — the
                        whole point of the disclosure is accountability. Each
                        row names the grantee and (if >1) how many entries
                        they've matched. Still not revocable: a grantee can
                        re-earn the grant simply by searching again
                        (Resolution #2), so a per-row revoke would be
                        theatre. */}
                    {searchMatch.length > 0 && (
                        <div className={(allContact.length > 0 || orgMates.length > 0) ? 'pt-2 border-t border-stone-100' : ''}>
                            <p className="text-xs font-semibold text-stone-500 mb-1.5">
                                {t('adopter.pii_grants_search_title')}
                            </p>
                            <ul className="space-y-1.5">
                                {searchMatch.map(m => (
                                    <li key={m.granteeEmail} className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-stone-700 truncate">{m.granteeName}</span>
                                        <span className="shrink-0 text-xs text-stone-500" title={t('adopter.pii_grants_search_count_tooltip').replace('{n}', String(m.count))}>
                                            {m.count > 1
                                                ? t('adopter.pii_grants_search_count_n').replace('{n}', String(m.count))
                                                : t('adopter.pii_grants_search_count_1')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
