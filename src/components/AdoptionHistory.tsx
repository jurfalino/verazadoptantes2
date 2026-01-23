'use client';

import { Star } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

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
        <div className="space-y-4 mt-6">
            <h3 className="text-xl font-bold text-gray-800 px-1">{t('adoption.history_title')}</h3>
            {adoptions.map((adoption) => (
                <div key={adoption.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 relative overflow-hidden">
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${adoption.status === 'returned' || adoption.status === 'failed' ? 'bg-red-500' : 'bg-green-500'
                        }`} />

                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h4 className="font-bold text-lg text-gray-900">{adoption.animalName}</h4>
                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full mt-1 ${adoption.status === 'returned' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                                }`}>
                                {adoption.status?.toUpperCase()}
                            </span>
                        </div>
                        {adoption.rating && (
                            <div className="flex items-center bg-yellow-50 px-2 py-1 rounded-lg">
                                <span className="font-bold text-yellow-700 mr-1">{adoption.rating}</span>
                                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            </div>
                        )}
                    </div>

                    {adoption.details && (
                        <p className="text-gray-600 text-sm mt-2 leading-relaxed bg-gray-50 p-3 rounded-lg">
                            {adoption.details}
                        </p>
                    )}

                    <div className="mt-3 text-xs text-gray-400">
                        {adoption.date ? new Date(adoption.date).toLocaleDateString() : t('adoption.date_unknown')}
                    </div>
                </div>
            ))}
        </div>
    );
}
