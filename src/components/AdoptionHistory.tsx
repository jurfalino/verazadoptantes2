'use client';

import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';

interface Adoption {
    id: string;
    animalName: string | null;
    status: string | null;
    rating: number | null;
    details: string | null;
    date: Date | null;
}

export default function AdoptionHistory({ adoptions }: { adoptions: Adoption[] }) {
    const { t } = useLanguage();
    if (adoptions.length === 0) return null;

    return (
        <div className="space-y-4 pb-6">
            {adoptions.map((adoption) => (
                <div key={adoption.id} className="bg-white rounded-xl p-5 shadow-sm border border-emerald-100 relative overflow-hidden transition-all hover:shadow-md">
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
                        {adoption.rating && (
                            <RatingBadge rating={adoption.rating} size="sm" />
                        )}
                    </div>

                    {adoption.details && (
                        <p className="text-emerald-800/80 text-sm mt-3 leading-relaxed bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50">
                            {adoption.details}
                        </p>
                    )}

                    <div className="mt-3 text-xs text-emerald-500 font-medium">
                        {adoption.date ? new Date(adoption.date).toLocaleDateString() : t('adoption.date_unknown')}
                    </div>
                </div>
            ))}
        </div>
    );
}
