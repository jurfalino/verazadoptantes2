'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolvePiiAccessRequest } from '@/app/actions/piiAccess';
import type { PiiAccessRequestView } from '@/lib/piiAccess';
import { AdopterName } from '@/components/AdopterName';

interface PiiAccessRequestPanelProps {
    requests: PiiAccessRequestView[];
    /** Show the adopter name (as a profile link) per row — used on the admin dashboard. */
    showAdopter?: boolean;
}

/**
 * Approver panel — lists pending PII access requests with approve / deny.
 * On the profile it shows one adopter's requests; on the admin dashboard
 * (`showAdopter`) it spans all adopters. Denying expands an inline optional
 * note field for the requester.
 */
export default function PiiAccessRequestPanel({ requests, showAdopter = false }: PiiAccessRequestPanelProps) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [items, setItems] = useState<PiiAccessRequestView[]>(requests);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [denyingId, setDenyingId] = useState<string | null>(null);
    const [denyNote, setDenyNote] = useState('');

    if (items.length === 0) return null;

    async function resolve(id: string, decision: 'approved' | 'denied', note?: string) {
        setBusyId(id);
        try {
            const res = await resolvePiiAccessRequest(id, decision, note);
            if (res.ok) {
                setItems(prev => prev.filter(r => r.id !== id));
                setDenyingId(null);
                setDenyNote('');
                toast.success('✓', decision === 'approved'
                    ? t('adopter.pii_approved_toast')
                    : t('adopter.pii_denied_toast'));
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
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                <span aria-hidden>🔒</span>
                {t('adopter.pii_panel_title')} <span className="font-normal">({items.length})</span>
            </h3>
            <ul className="space-y-3">
                {items.map(r => (
                    <li key={r.id} className="rounded-lg bg-white border border-amber-200 p-3 text-sm space-y-2">
                        {showAdopter && (
                            <a href={`/adopter/${r.adopterId}`} className="block font-semibold text-teal-700 hover:underline">
                                <AdopterName adopter={{ name: r.adopterName }} />
                            </a>
                        )}
                        <div className="text-stone-800">
                            <span className="font-semibold">{r.requesterName}</span>{' '}
                            <span className="text-stone-500">{t('adopter.pii_panel_requests_access')}</span>
                        </div>
                        <div className="text-stone-600">
                            <span className="font-medium">{t('adopter.pii_panel_justification')}: </span>
                            {r.justification?.trim()
                                ? <span className="italic">{r.justification}</span>
                                : <span className="italic text-stone-400">{t('adopter.pii_panel_no_reason')}</span>}
                        </div>
                        {r.activityId && (
                            <div className="text-xs text-amber-700">{t('adopter.pii_panel_activity_linked')}</div>
                        )}
                        {denyingId === r.id ? (
                            <div className="space-y-2 pt-1">
                                <textarea
                                    rows={2}
                                    value={denyNote}
                                    onChange={e => setDenyNote(e.target.value)}
                                    maxLength={1000}
                                    placeholder={t('adopter.pii_panel_deny_note')}
                                    className="w-full rounded-lg border border-stone-300 bg-white text-stone-800 text-sm p-2 outline-none focus:border-teal-500 resize-y"
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => resolve(r.id, 'denied', denyNote.trim() || undefined)}
                                        disabled={busyId === r.id}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                                    >
                                        {t('adopter.pii_panel_deny_confirm')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setDenyingId(null); setDenyNote(''); }}
                                        disabled={busyId === r.id}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-stone-300 text-stone-700 hover:opacity-70 transition-opacity disabled:opacity-50"
                                    >
                                        {t('adopter.pii_modal_cancel')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => resolve(r.id, 'approved')}
                                    disabled={busyId === r.id}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                                >
                                    {t('adopter.pii_panel_approve')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setDenyingId(r.id); setDenyNote(''); }}
                                    disabled={busyId === r.id}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-stone-300 text-stone-700 hover:opacity-70 transition-opacity disabled:opacity-50"
                                >
                                    {t('adopter.pii_panel_deny')}
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
