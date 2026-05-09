'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface Adopter {
    id: string;
    name: string;
    contact?: string | null;
    status?: string | null;
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
                className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-stone-200">
                    <h3 className="text-xl font-semibold text-stone-900">Merge Adopter Profiles</h3>
                    <p className="text-sm text-stone-500 mt-1">
                        Select which profile to keep as the <strong>primary</strong>. All records from the secondary will be moved to the primary.
                    </p>
                </div>

                <div className="p-6 space-y-4">
                    {/* Match info */}
                    {matchTypes && matchTypes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            <span className="text-xs text-stone-500 font-medium">Match:</span>
                            {matchTypes.map(type => (
                                <span key={type} className={`text-xs px-2 py-0.5 rounded-full font-medium ${getMatchBadgeStyle(type)}`}>
                                    {getMatchLabel(type)}
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
                        />
                        <ProfileCard
                            adopter={adopter2}
                            isSelected={primaryId === adopter2.id}
                            role={primaryId === adopter2.id ? 'primary' : 'secondary'}
                            onSelect={() => setPrimaryId(adopter2.id)}
                        />
                    </div>

                    {/* Warning */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                        <p className="font-semibold text-amber-800 mb-1">⚠️ What will happen:</p>
                        <ul className="text-amber-700 space-y-1 list-disc list-inside">
                            <li><strong>&quot;{primary.name}&quot;</strong> will be kept (primary)</li>
                            <li><strong>&quot;{secondary.name}&quot;</strong> will be soft-deleted</li>
                            <li>All adoptions, images, flags, and history will move to the primary</li>
                            <li>Contact info and notes will be merged</li>
                        </ul>
                    </div>
                </div>

                <div className="p-6 border-t border-stone-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleMerge}
                        disabled={merging}
                        className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                        {merging ? 'Merging...' : 'Merge Profiles'}
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
}: {
    adopter: Adopter;
    isSelected: boolean;
    role: 'primary' | 'secondary';
    onSelect: () => void;
}) {
    return (
        <button
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
                    {role === 'primary' ? '✓ Keep' : 'Delete'}
                </span>
            </div>
            <p className="font-semibold text-stone-900 text-sm line-clamp-2 break-words" title={adopter.name}>{adopter.name}</p>
            <p className="text-xs text-stone-500 font-mono mt-1 truncate">{adopter.id}</p>
            {adopter.contact && (
                <p className="text-xs text-stone-500 mt-2 line-clamp-2 break-words">{adopter.contact}</p>
            )}
            {adopter.status && (
                <p className="text-xs text-stone-500 mt-1">Rating: {adopter.status}</p>
            )}
        </button>
    );
}

function getMatchLabel(type: string): string {
    const labels: Record<string, string> = {
        phone: '📞 Phone',
        email: '✉️ Email',
        social: '🌐 Social',
        name_full: '📛 Full Name',
        name_word: '📝 Name Words',
        address_word: '🏠 Address',
        source_url: '🔗 Source URL',
    };
    return labels[type] || type;
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
