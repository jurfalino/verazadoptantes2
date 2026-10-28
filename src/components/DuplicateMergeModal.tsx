'use client';

import { useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { AdopterName } from '@/components/AdopterName';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { matchTypeLabel } from '@/lib/matchTypeLabels';
import { RatingBadge } from '@/components/RatingBadge';

/**
 * Render an i18n template that contains a single `{name}` placeholder,
 * wrapping the substituted name in <strong>. Used by the bullets in the
 * "what will happen" section. Avoids dangerouslySetInnerHTML — the name
 * comes from a user-controlled field (adopter.name) and could contain
 * angle brackets.
 */
function withBoldName(template: string, name: string): ReactNode {
    const parts = template.split('{name}');
    if (parts.length !== 2) return template.replace('{name}', name);
    return (
        <>
            {parts[0]}
            <strong>{name}</strong>
            {parts[1]}
        </>
    );
}

interface Adopter {
    id: string;
    name: string;
    contact?: string | null;
    /** Computed average from activity records (computeAvgRating). The legacy
     *  `adopter.status` field is deprecated — see memory
     *  project-adopter-status-deprecated. Null when the adopter has no
     *  rated activity yet. */
    avgRating?: number | null;
    /** Who registered it ("Name (email)"), when the caller knows (admin panel). */
    createdBy?: string | null;
}

interface DuplicateMergeModalProps {
    adopter1: Adopter;
    adopter2: Adopter;
    matchTypes?: string[];
    onMerge: (primaryId: string, secondaryId: string, opts?: { notifyOwners?: boolean }) => Promise<void>;
    onClose: () => void;
    /** Admin merge: offer to notify whoever registered the profiles (checked by default). */
    notifyOption?: boolean;
}

export default function DuplicateMergeModal({
    adopter1,
    adopter2,
    matchTypes,
    onMerge,
    onClose,
    notifyOption = false,
}: DuplicateMergeModalProps) {
    const { t } = useLanguage();
    const [primaryId, setPrimaryId] = useState<string>(adopter1.id);
    const [merging, setMerging] = useState(false);
    const [notifyOwners, setNotifyOwners] = useState(true);

    const primary = primaryId === adopter1.id ? adopter1 : adopter2;
    const secondary = primaryId === adopter1.id ? adopter2 : adopter1;

    async function handleMerge() {
        // No confirm() dialog: this modal IS the confirmation (both profiles,
        // the "what will happen" warning, an explicit destructive button), and
        // the merge is undoable from the panel's post-merge banner.
        setMerging(true);
        try {
            await onMerge(primary.id, secondary.id, notifyOption ? { notifyOwners } : undefined);
        } finally {
            setMerging(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90svh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-stone-200">
                    <h3 className="text-xl font-semibold text-stone-900">{t('admin.dmm_title')}</h3>
                    <p className="text-sm text-stone-500 mt-1">{t('admin.dmm_subtitle')}</p>
                </div>

                <div className="p-6 space-y-4">
                    {/* Match info */}
                    {matchTypes && matchTypes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            <span className="text-xs text-stone-500 font-medium">{t('admin.dmm_match_label')}</span>
                            {matchTypes.map(type => (
                                <span key={type} className={`text-xs px-2 py-0.5 rounded-full font-medium ${getMatchBadgeStyle(type)}`}>
                                    {matchTypeLabel(type, t)}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Profile selection */}
                    <div className="grid grid-cols-2 gap-4">
                        <ProfileCard
                            adopter={adopter1}
                            isSelected={primaryId === adopter1.id}
                            role={primaryId === adopter1.id ? 'primary' : 'secondary'}
                            onSelect={() => setPrimaryId(adopter1.id)}
                            t={t}
                        />
                        <ProfileCard
                            adopter={adopter2}
                            isSelected={primaryId === adopter2.id}
                            role={primaryId === adopter2.id ? 'primary' : 'secondary'}
                            onSelect={() => setPrimaryId(adopter2.id)}
                            t={t}
                        />
                    </div>

                    {/* Warning */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                        <p className="font-semibold text-amber-800 mb-1">{t('admin.dmm_what_happens')}</p>
                        <ul className="text-amber-700 space-y-1 list-disc list-inside">
                            <li>{withBoldName(t('admin.dmm_bullet_kept'), adopterDisplayName(primary, t('adopter.nameless')))}</li>
                            <li>{withBoldName(t('admin.dmm_bullet_deleted'), adopterDisplayName(secondary, t('adopter.nameless')))}</li>
                            <li>{t('admin.dmm_bullet_records_move')}</li>
                            <li>{t('admin.dmm_bullet_contact_merged')}</li>
                            <li>{t('admin.dmm_bullet_history')}</li>
                        </ul>
                    </div>

                    {notifyOption && (
                        <label className="flex items-start gap-3 text-sm text-stone-700 cursor-pointer" data-testid="dmm-notify">
                            <input type="checkbox" checked={notifyOwners} onChange={e => setNotifyOwners(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500" />
                            <span>
                                <span className="font-medium">{t('admin.dmm_notify_owners')}</span>
                                <span className="block text-xs text-stone-500 mt-0.5">{t('admin.dmm_notify_owners_hint')}</span>
                            </span>
                        </label>
                    )}
                </div>

                <div className="p-6 border-t border-stone-200 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                    >
                        {t('admin.dmm_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleMerge}
                        disabled={merging}
                        className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                        {merging ? t('admin.dmm_merging') : t('admin.dmm_merge_button')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ProfileCard({
    adopter,
    isSelected,
    role,
    onSelect,
    t,
}: {
    adopter: Adopter;
    isSelected: boolean;
    role: 'primary' | 'secondary';
    onSelect: () => void;
    t: (k: string) => string;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`text-left p-4 rounded-xl border-2 transition-all ${isSelected
                ? 'border-teal-500 bg-teal-50/50'
                : 'border-stone-200 hover:border-stone-300'
                }`}
        >
            <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${role === 'primary'
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-stone-100 text-stone-500'
                    }`}>
                    {role === 'primary' ? t('admin.dmm_role_keep') : t('admin.dmm_role_delete')}
                </span>
            </div>
            <AdopterName adopter={adopter} className="font-semibold text-stone-900 text-sm line-clamp-2 break-words block" title />
            <p className="text-xs text-stone-500 font-mono mt-1 truncate">{adopter.id}</p>
            {adopter.createdBy && (
                <p className="text-xs text-stone-600 mt-1 break-words">{t('admin.dmm_created_by')} <span className="font-medium">{adopter.createdBy}</span></p>
            )}
            {adopter.contact && (
                <p className="text-xs text-stone-500 mt-2 line-clamp-2 break-words">{adopter.contact}</p>
            )}
            <div className="mt-1"><RatingBadge rating={adopter.avgRating} /></div>
        </button>
    );
}

function getMatchBadgeStyle(type: string): string {
    const styles: Record<string, string> = {
        phone: 'bg-blue-100 text-blue-700',
        email: 'bg-purple-100 text-purple-700',
        social: 'bg-cyan-100 text-cyan-700',
        name_full: 'bg-amber-100 text-amber-700',
        name_word: 'bg-orange-100 text-orange-700',
        address_word: 'bg-green-100 text-green-700',
        source_url: 'bg-rose-100 text-rose-700',
    };
    return styles[type] || 'bg-stone-100 text-stone-700';
}
