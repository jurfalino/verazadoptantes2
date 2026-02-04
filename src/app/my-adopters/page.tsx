'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RatingBadge } from '@/components/RatingBadge';

interface Adopter {
    id: string;
    name: string;
    contactInfo: string | null;
    status: string | null;
    createdAt: number | null;
}

export default function MyAdoptersPage() {
    const { t } = useLanguage();
    const [adopters, setAdopters] = useState<Adopter[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAdopters() {
            try {
                const res = await fetch('/api/my-adopters');
                if (res.ok) {
                    const data = await res.json() as Adopter[];
                    setAdopters(data);
                }
            } catch (e) {
                console.error('Failed to fetch adopters:', e);
            } finally {
                setLoading(false);
            }
        }
        fetchAdopters();
    }, []);

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
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="text-stone-500 hover:text-stone-700 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">{t('dashboard.my_adopters')}</h1>
                    </div>
                    <Link
                        href="/adopter/create"
                        className="px-5 py-2.5 bg-teal-200 text-teal-900 font-bold rounded-xl hover:bg-teal-300 transition-colors shadow-sm"
                    >
                        {t('dashboard.add_new_adopter')}
                    </Link>
                </div>

                {adopters.length === 0 ? (
                    <div className="bg-white rounded-3xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                        </div>
                        <h3 className="text-xl font-bold text-stone-900 mb-2">{t('dashboard.no_adopters_title')}</h3>
                        <p className="text-stone-500 mb-6">{t('dashboard.no_adopters_desc')}</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-stone-200">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-stone-50 border-b border-stone-200 text-left">
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_adopter_name')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_status')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider">{t('dashboard.table_date_added')}</th>
                                    <th className="py-4 px-6 text-sm font-bold text-stone-500 uppercase tracking-wider text-right">{t('dashboard.table_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {adopters.map((adopter) => (
                                    <tr key={adopter.id} className="hover:bg-stone-50/50 transition-colors group">
                                        <td className="py-4 px-6">
                                            <div className="font-bold text-stone-900">{adopter.name}</div>
                                            <div className="text-sm text-stone-400">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <RatingBadge rating={adopter.status || '5'} size="sm" />
                                        </td>
                                        <td className="py-4 px-6 text-sm text-stone-500 font-medium">
                                            {adopter.createdAt ? new Date(adopter.createdAt).toLocaleDateString() : t('dashboard.na')}
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <Link
                                                href={`/adopter/${adopter.id}`}
                                                className="inline-block px-4 py-2 bg-white border border-stone-200 rounded-lg text-sm font-bold text-stone-700 hover:border-teal-300 hover:text-teal-700 transition-colors shadow-sm"
                                            >
                                                {t('dashboard.view_profile')}
                                            </Link>
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
