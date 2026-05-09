'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { attachContractToExistingAdopter } from '@/app/actions/duplicates';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';

interface MatchType {
    icon: string;
    es: string;
    en: string;
}

interface ContractResultsMatchCardProps {
    matchId: string;
    notificationId: string;
    profile: {
        id: string;
        name: string;
        contactInfo: string | null;
        status: string | null;
    };
    matchTypes: string[];
    matchTypeLabels: Record<string, MatchType>;
}

export default function ContractResultsMatchCard({
    matchId,
    notificationId,
    profile,
    matchTypes,
    matchTypeLabels,
}: ContractResultsMatchCardProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [linking, setLinking] = useState(false);

    const handleConfirm = async () => {
        setLinking(true);
        try {
            const result = await attachContractToExistingAdopter(notificationId, matchId);
            if (result.success) {
                toast.success(
                    (t('contractResults.link_success') || 'Adopción atribuida a {name}').replace('{name}', result.primaryName || profile.name),
                );
                router.push(result.matchedProfileUrl || `/adopter/${matchId}`);
                router.refresh();
            } else {
                toast.error(t('contractResults.link_error') || 'No se pudo atribuir la adopción', result.error);
                setLinking(false);
                setConfirmOpen(false);
            }
        } catch (error) {
            toast.error(t('contractResults.link_error') || 'No se pudo atribuir la adopción', undefined, extractErrorId(error));
            setLinking(false);
            setConfirmOpen(false);
        }
    };

    return (
        <>
            <div className="block bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-800 line-clamp-2 break-words" title={profile.name}>{profile.name}</p>
                        {profile.contactInfo && (
                            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2 break-words">{profile.contactInfo}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {matchTypes.map((type) => {
                                const label = matchTypeLabels[type];
                                return (
                                    <span
                                        key={type}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                                    >
                                        {label?.icon || '🔗'} {label?.es || type}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Action row — split intents: link adoption (destructive) vs. investigate (navigate) */}
                <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(true)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors flex-1 sm:flex-initial"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        {t('contractResults.same_person') || 'Es la misma persona'}
                    </button>
                    <Link
                        href={`/adopter/${profile.id}`}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-sm font-medium border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"
                    >
                        {t('contractResults.view_profile') || 'Ver perfil'}
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>
                </div>
            </div>

            {/* Confirmation modal */}
            {confirmOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
                    onClick={() => !linking && setConfirmOpen(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-xl max-w-md w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-5 border-b border-stone-100">
                            <h3 className="text-lg font-semibold text-stone-900 break-words">
                                {t('contractResults.confirm_link_title') || 'Atribuir adopción a este perfil'}
                            </h3>
                            <p className="text-sm text-stone-600 mt-2 break-words">
                                {(t('contractResults.confirm_link_body') || 'Esta acción mueve el contrato firmado al perfil de {name}, elimina el perfil temporal recién creado y notifica al creador original.').replace('{name}', profile.name)}
                            </p>
                        </div>
                        <div className="p-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                disabled={linking}
                                className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-50"
                            >
                                {t('contractResults.cancel') || 'Cancelar'}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={linking}
                                className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                            >
                                {linking ? (t('contractResults.linking') || 'Atribuyendo...') : (t('contractResults.confirm_link_action') || 'Confirmar atribución')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
