'use client';

import { useState } from 'react';
import { searchAdopter, SearchResult } from '@/app/actions';
import { RatingBadge } from './RatingBadge';
import { useLanguage } from '@/context/LanguageContext';

export default function SearchSection() {
    const { t } = useLanguage();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        try {
            const data = await searchAdopter(query);
            setResults(data);
        } catch (err) {
            console.error(err);
            alert('Search failed');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setQuery('');
        setResults(null);
    };

    return (
        <div className="w-full">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-emerald-100/60">
                <h2 className="text-2xl font-bold text-emerald-900 mb-5 text-center tracking-tight">{t('search.title')}</h2>
                <form onSubmit={handleSearch} className="space-y-4">
                    <div>
                        <label htmlFor="search" className="sr-only">{t('common.search')}</label>
                        <input
                            type="text"
                            id="search"
                            placeholder={t('search.placeholder')}
                            className="w-full px-4 py-3 rounded-xl bg-white border border-emerald-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-emerald-900 placeholder:text-emerald-800/40 font-medium"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 px-4 bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 hover:shadow-xl transition-all disabled:opacity-70 transform active:scale-95"
                    >
                        {loading ? t('search.searching') : t('search.button')}
                    </button>
                </form>
            </div>

            {results && (
                <div className="mt-8 space-y-4">
                    <div className="flex justify-between items-center px-2">
                        <h3 className="text-lg font-semibold text-emerald-900">
                            {results.length === 0 ? t('search.no_results') : t('search.results').replace('{count}', results.length.toString())}
                        </h3>
                        <button
                            onClick={handleClear}
                            className="text-sm font-medium text-emerald-600 hover:text-emerald-800 underline"
                        >
                            {t('search.clear')}
                        </button>
                    </div>
                    {results.map((res) => (
                        <a key={res.adopter.id} href={`/adopter/${res.adopter.id}`} className="block group">
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-emerald-100/60 group-hover:border-emerald-300 group-hover:shadow-md transition-all">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-lg text-emerald-900 group-hover:text-emerald-700 transition-colors truncate">{res.adopter.name}</div>
                                        <div className="text-sm text-emerald-600/70 truncate mt-1">{res.adopter.contactInfo || 'No contact info'}</div>
                                    </div>
                                    {/* Use RatingBadge for consistent display if status is 1-5 */}
                                    {res.adopter.status && ['1', '2', '3', '4', '5'].includes(res.adopter.status) ? (
                                        <RatingBadge rating={res.adopter.status} size="sm" />
                                    ) : (
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${res.adopter.status === 'blocked' ? 'bg-red-100 text-red-700' :
                                            res.adopter.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-emerald-100 text-emerald-700'
                                            }`}>
                                            {res.adopter.status === 'good' ? 'Good Record' : (res.adopter.status || 'Unknown')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </a>
                    ))}
                    {results.length === 0 && (
                        <div className="bg-emerald-50 rounded-2xl p-6 text-center border border-emerald-100">
                            <p className="text-emerald-800 mb-3">{t('search.no_history').replace('{query}', query)}</p>
                            <a href="/adopter/create" className="inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-800 underline">
                                {t('search.create_new')}
                            </a>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
