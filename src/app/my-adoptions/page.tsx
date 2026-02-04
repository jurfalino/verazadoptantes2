'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RatingBadge } from '@/components/RatingBadge';

interface Adoption {
    id: string;
    animalName: string;
    species: string | null;
    adopterId: string | null;
    date: number | null;
    rating: number | null;
}

export default function MyAdoptionsPage() {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const filter = searchParams.get('filter') === 'adopted' ? 'adopted' : 'all';

    const [adoptions, setAdoptions] = useState<Adoption[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAdoptions() {
            try {
                const res = await fetch(`/api/my-adoptions?filter=${filter}`);
                if (res.ok) {
                    const data = await res.json() as Adoption[];
                    setAdoptions(data);
                }
            } catch (e) {
                console.error('Failed to fetch adoptions:', e);
            } finally {
                setLoading(false);
            }
        }
        fetchAdoptions();
    }, [filter]);

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="text-stone-500 hover:text-stone-700 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">{t('dashboard.my_adoptions')}</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="bg-white p-1 rounded-xl border border-stone-200 inline-flex">
                            <Link
                                href="/my-adoptions?filter=all"
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${filter === 'all' ? 'bg-stone-100 text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                            >
                                {t('dashboard.all_animals')}
                            </Link>
                            <Link
                                href="/my-adoptions?filter=adopted"
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${filter === 'adopted' ? 'bg-teal-100 text-teal-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                            >
                                {t('dashboard.adopted_only')}
                            </Link>
                        </div>

                        <Link
                            href="/adopter/create"
                            className="px-5 py-2.5 bg-teal-200 text-teal-900 font-bold rounded-xl hover:bg-teal-300 transition-colors shadow-sm whitespace-nowrap"
                        >
                            {t('dashboard.register_adoption')}
                        </Link>
                    </div>
                </div>

                {adoptions.length === 0 ? (
                    <div className="bg-white rounded-3xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                        </div>
                        <h3 className="text-xl font-bold text-stone-900 mb-2">{t('dashboard.no_adoptions_title')}</h3>
                        <p className="text-stone-500 mb-6">
                            {filter === 'adopted' ? t('dashboard.no_adoptions_desc_adopted') : t('dashboard.no_adoptions_desc_all')}
                        </p>
                    </div>
                ) : (
                    <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-stone-200">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-stone-50 border-b border-stone-200 text-left">
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_animal')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_species')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_adoption_status')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_date')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_rating')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider text-right">{t('dashboard.table_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {adoptions.map((adoption) => (
                                    <tr key={adoption.id} className="hover:bg-stone-50/50 transition-colors group">
                                        <td className="py-4 px-6">
                                            <div className="font-bold text-stone-900">{adoption.animalName}</div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-800 capitalize">
                                                {adoption.species || t('dashboard.unknown_species')}
                                            </span>
                                        </td>
                                        <td className="py-4 px-6">
                                            {adoption.adopterId ? (
                                                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-teal-100 text-teal-800">
                                                    {t('dashboard.status_adopted')}
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-stone-100 text-stone-600">
                                                    {t('dashboard.status_available')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-4 px-6 text-sm text-stone-500 font-medium">
                                            {adoption.date ? new Date(adoption.date).toLocaleDateString() : t('dashboard.na')}
                                        </td>
                                        <td className="py-4 px-6">
                                            {adoption.rating && <RatingBadge rating={adoption.rating} size="sm" />}
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            {adoption.adopterId ? (
                                                <Link
                                                    href={`/adopter/${adoption.adopterId}`}
                                                    className="inline-block px-4 py-2.5 bg-white border border-stone-200 rounded-lg text-sm font-bold text-stone-700 hover:border-teal-300 hover:text-teal-700 transition-colors shadow-sm"
                                                >
                                                    {t('dashboard.view_adopter')}
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-stone-400 italic">{t('dashboard.pending_link')}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
