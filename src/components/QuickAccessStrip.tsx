'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface QuickCounts {
    animals: number;
    adoptions: number;
    adopters: number;
    animalsEnabled: boolean;
}

export default function QuickAccessStrip() {
    const { t } = useLanguage();
    const { data: session } = useSession();
    const [counts, setCounts] = useState<QuickCounts | null>(null);

    useEffect(() => {
        if (!session?.user) return;
        
        let isMounted = true;
        fetch('/api/quick-counts')
            .then(res => res.json() as Promise<QuickCounts>)
            .then(data => {
                if (isMounted && data) {
                    setCounts(data as QuickCounts);
                }
            })
            .catch(err => console.error('Failed to fetch quick counts', err));
            
        return () => { isMounted = false; };
    }, [session]);

    if (!session?.user) return null;

    // Default to enabled early-render state before fetch unless explicitly disabled
    const showAnimals = counts ? counts.animalsEnabled : false; 
    
    // Once counts load, animate in
    const isLoaded = counts !== null;

    return (
        <div className={`mt-6 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex gap-3 sm:gap-4 flex-nowrap sm:flex-wrap min-w-max sm:min-w-0">
                
                {/* My Animals */}
                {showAnimals && (
                    <Link 
                        href="/my-animals"
                        className={`flex items-center gap-2 px-4 py-2 bg-white rounded-full border shadow-sm transition-all text-sm font-semibold shrink-0 group ${
                            (counts?.animals ?? 0) > 0 
                                ? 'border-teal-200 hover:border-teal-300 hover:shadow-md' 
                                : 'border-stone-200 hover:border-stone-300 hover:shadow-md'
                        }`}
                    >
                        <span className="text-base group-hover:scale-110 transition-transform">🐾</span>
                        <span className="text-stone-700">{t('dashboard.my_animals') || 'My Animals'}</span>
                        {counts?.animals !== undefined && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                counts.animals > 0 ? 'bg-teal-100 text-teal-800' : 'bg-stone-100 text-stone-500'
                            }`}>
                                {counts.animals}
                            </span>
                        )}
                    </Link>
                )}

                {/* My Adoptions */}
                <Link 
                    href="/my-adoptions"
                    className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-stone-200 hover:border-stone-300 shadow-sm hover:shadow-md transition-all text-sm font-semibold text-stone-700 shrink-0 group"
                >
                    <span className="text-base group-hover:scale-110 transition-transform">📋</span>
                    <span>{t('dashboard.my_adoptions') || 'My Adoptions'}</span>
                    {counts?.adoptions !== undefined && (
                        <span className="px-2 py-0.5 bg-stone-100 rounded-full text-xs font-bold text-stone-600">
                            {counts.adoptions}
                        </span>
                    )}
                </Link>

                {/* My Adopters */}
                <Link 
                    href="/my-adopters"
                    className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-stone-200 hover:border-stone-300 shadow-sm hover:shadow-md transition-all text-sm font-semibold text-stone-700 shrink-0 group"
                >
                    <span className="text-base group-hover:scale-110 transition-transform">👥</span>
                    <span>{t('dashboard.my_adopters') || 'My Adopters'}</span>
                    {counts?.adopters !== undefined && (
                        <span className="px-2 py-0.5 bg-stone-100 rounded-full text-xs font-bold text-stone-600">
                            {counts.adopters}
                        </span>
                    )}
                </Link>

            </div>
        </div>
    );
}
