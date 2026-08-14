'use client';

import { useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { StarIcon } from '@/components/StarIcon';
import { getRatingColors } from '@/lib/ratingColors';
import { AdopterName } from '@/components/AdopterName';

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
}

interface DuplicateMergeModalProps {
    adopter1: Adopter;
    adopter2: Adopter;
    matchTypes?: string[];
    onMerge: (primaryId: string, secondaryId: string) => Promise<void>;
    onClose: () => void;
}

export default function DuplicateMergeModal({
    adopter1,
    adopter2,
    matchTypes,
    onMerge,
    onClose,
}: DuplicateMergeModalProps) {
    const { t } = useLanguage();
    const [primaryId, setPrimaryId] = useState<string>(adopter1.id);
    const [merging, setMerging] = useState(false);

    const primary = primaryId === adopter1.id ? adopter1 : adopter2;
    const secondary = primaryId === adopter1.id ? adopter2 : adopter1;

    async function handleMerge() {
        const confirmMsg = t('dialogs.confirm_merge')
            .replace('{secondary}', secondary.name)
            .replace('{primary}', primary.name);
        if (!confirm(confirmMsg)) {
            return;
        }
        setMerging(true);
        try {
            await onMerge(primary.id, secondary.id);
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
                                    {getMatchLabel(type, t)}
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
                            <li>{withBoldName(t('admin.dmm_bullet_kept'), primary.name)}</li>
                            <li>{withBoldName(t('admin.dmm_bullet_deleted'), secondary.name)}</li>
                            <li>{t('admin.dmm_bullet_records_move')}</li>
                            <li>{t('admin.dmm_bullet_contact_merged')}</li>
                        </ul>
                    </div>
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
            {adopter.contact && (
                <p className="text-xs text-stone-500 mt-2 line-clamp-2 break-words">{adopter.contact}</p>
            )}
            {adopter.avgRating != null ? (
                <p className="text-xs text-stone-500 mt-1 inline-flex items-center gap-1"><StarIcon className={`w-3 h-3 ${getRatingColors(adopter.avgRating).text}`} />{adopter.avgRating.toFixed(1)}</p>
            ) : (
                <p className="text-xs text-stone-400 italic mt-1">{t('admin.dmm_no_activity')}</p>
            )}
        </button>
    );
}

function getMatchLabel(type: string, t: (k: string) => string): string {
    const labelKeys: Record<string, string> = {
        phone: 'admin.dmm_match_phone',
        email: 'admin.dmm_match_email',
        social: 'admin.dmm_match_social',
        name_full: 'admin.dmm_match_name_full',
        name_word: 'admin.dmm_match_name_word',
        address_word: 'admin.dmm_match_address_word',
        source_url: 'admin.dmm_match_source_url',
    };
    const key = labelKeys[type];
    return key ? t(key) : type;
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
