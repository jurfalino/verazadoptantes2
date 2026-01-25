'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { deleteAdoption } from '@/app/actions';
import { useRouter } from 'next/navigation';

interface Adoption {
    id: string;
    animalName: string | null;
    status: string | null;
    rating: number | null;
    details: string | null;
    date: Date | null;
    addedBy: string | null;
}

export default function AdoptionHistory({ adoptions, onEdit, adopterId, currentUser }: { adoptions: Adoption[], onEdit: (adoption: Adoption) => void, adopterId: string, currentUser: string }) {
    const { t } = useLanguage();
    const router = useRouter();
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDelete = async (adoptionId: string) => {
        if (!confirm('Are you sure you want to delete this adoption record? This action cannot be undone.')) return;

        setDeletingId(adoptionId);
        try {
            await deleteAdoption(adoptionId, adopterId);
            // Router refresh is handled in AdopterProfile or parent, but we can do it here too just in case
            router.refresh();
        } catch (error) {
            console.error('Failed to delete adoption:', error);
            alert('Failed to delete adoption.');
        } finally {
            setDeletingId(null);
        }
    };

    if (adoptions.length === 0) return null;

    return (
        <div className="space-y-4 pb-6">
            {adoptions.map((adoption) => (
                <div key={adoption.id} className="bg-white rounded-xl p-5 shadow-sm border border-emerald-100 relative overflow-hidden transition-all hover:shadow-md group">
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${adoption.status === 'returned' || adoption.status === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'
                        }`} />

                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-base text-emerald-950">{adoption.animalName}</h4>
                                {(adoption as any).species && (
                                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                        {(adoption as any).species}
                                    </span>
                                )}
                            </div>
                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full mt-1 ${adoption.status === 'returned' || adoption.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                {adoption.status?.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            {adoption.rating && (
                                <RatingBadge rating={adoption.rating} size="sm" />
                            )}

                            {/* Action Buttons - Only visible to owner (or guest for legacy) */}
                            {(adoption.addedBy === currentUser || ((!adoption.addedBy || adoption.addedBy === 'anonymous') && currentUser === 'Anon: Guest')) && (
                                <div className="flex gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => onEdit(adoption)}
                                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                                        title={t('common.edit')}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                    <button
                                        onClick={() => handleDelete(adoption.id)}
                                        disabled={deletingId === adoption.id}
                                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors disabled:opacity-50"
                                        title={t('common.delete')}
                                    >
                                        {deletingId === adoption.id ? (
                                            <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {adoption.details && (
                        <p className="text-emerald-800/80 text-sm mt-3 leading-relaxed bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50">
                            {adoption.details}
                        </p>
                    )}

                    <div className="mt-3 flex items-center justify-between text-xs font-medium">
                        <span className="text-emerald-500">
                            {adoption.date ? new Date(adoption.date).toLocaleDateString() : t('adoption.date_unknown')}
                        </span>
                        {adoption.addedBy && (
                            <span className="text-emerald-400 bg-emerald-50/50 px-2 py-0.5 rounded-full border border-emerald-100/30">
                                {t('common.added_by')} {adoption.addedBy.replace('User: ', '')}
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
