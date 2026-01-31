'use client';

import { useState } from 'react';
import { searchAdopter, SearchResult } from '@/app/actions';
import { RatingBadge } from './RatingBadge';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function SearchSection() {
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [loading, setLoading] = useState(false);

    const handleCreateNew = (e: React.MouseEvent) => {
        e.preventDefault();
        // Check both session and anon cookie (anon cookie handling in client is via document.cookie usually, but layout handles session hydration)
        // Since we wrapped SessionProvider, session should be active for anon users if the backend returns it?
        // Actually, our RootLayout manual check `isAuthenticated` doesn't automatically sync with `useSession` if next-auth doesn't know about anon cookie.
        // However, UserMenu uses `isAnon` prop.
        // Let's check if session.user exists. If not, check "anon_user" cookie manually or just use a helper.
        // For simplicity, if !session?.user && !document.cookie.includes('anon_user'), open login.

        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
        } else {
            try {
                router.push('/adopter/create');
                // Fallback if router fails
                setTimeout(() => {
                    if (!window.location.pathname.includes('/adopter/')) {
                        window.location.href = '/adopter/create';
                    }
                }, 500);
            } catch (e) {
                window.location.href = '/adopter/create';
            }
        }
    };

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
    return (
        <div className="w-full">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200">
                <h2 className="text-2xl font-bold text-stone-900 mb-5 text-center tracking-tight">{t('search.title')}</h2>
                <form onSubmit={handleSearch} className="space-y-4">
                    <div className="relative">
                        <label htmlFor="search" className="sr-only">{t('common.search')}</label>
                        <input
                            type="text"
                            id="search"
                            placeholder={t('search.placeholder')}
                            className="w-full px-5 py-4 pr-12 rounded-2xl bg-stone-50 border border-stone-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 transition-all outline-none text-stone-900 placeholder:text-stone-400 font-medium"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors p-1"
                                aria-label={t('search.clear')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        )}
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 px-6 bg-teal-200 text-teal-900 font-bold rounded-2xl shadow-sm hover:bg-teal-300 hover:shadow-md transition-all disabled:opacity-70 transform active:scale-[0.98] text-lg"
                    >
                        {loading ? t('search.searching') : t('search.button')}
                    </button>
                </form>
            </div>

            {results && (
                <div className="mt-8 space-y-4">
                    {results.length > 0 && (
                        <div className="flex justify-between items-center px-2">
                            <h3 className="text-lg font-semibold text-stone-800">
                                {t('search.results').replace('{count}', results.length.toString())}
                            </h3>
                            <button
                                onClick={handleCreateNew}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-teal-800 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                {t('search.create_new')}
                            </button>
                        </div>
                    )}
                    {results.map((res) => (
                        <a key={res.adopter.id} href={`/adopter/${res.adopter.id}`} className="block group">
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200 group-hover:border-teal-300 group-hover:shadow-md transition-all">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-lg text-stone-900 group-hover:text-teal-700 transition-colors truncate">{res.adopter.name}</div>
                                        <div className="text-sm text-stone-500 truncate mt-1">{res.adopter.contactInfo || 'No contact info'}</div>
                                        {res.matchContext && (
                                            <div className="mt-2 text-xs font-semibold text-teal-800 bg-teal-50 px-2 py-1 rounded inline-block border border-teal-100">
                                                <span className="opacity-70">ⓘ </span>
                                                {res.matchContext}
                                            </div>
                                        )}
                                    </div>
                                    {/* Use RatingBadge for consistent display if status is 1-5 */}
                                    {res.adopter.status && ['1', '2', '3', '4', '5'].includes(res.adopter.status) ? (
                                        <RatingBadge rating={res.adopter.status} size="sm" />
                                    ) : (
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${res.adopter.status === 'blocked' ? 'bg-rose-100 text-rose-800' :
                                            res.adopter.status === 'warning' ? 'bg-amber-100 text-amber-800' :
                                                'bg-teal-100 text-teal-800'
                                            }`}>
                                            {res.adopter.status === 'good' ? 'Good Record' : (res.adopter.status || 'Unknown')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </a>
                    ))}
                    {results.length === 0 && (
                        <div className="bg-stone-50 rounded-2xl p-8 text-center border border-stone-200">
                            <p className="text-stone-600 mb-4 text-lg">{t('search.no_history').replace('{query}', query)}</p>
                            <button onClick={handleCreateNew} className="inline-block px-5 py-2.5 bg-white border border-stone-200 rounded-xl text-stone-800 font-bold hover:border-stone-300 hover:bg-stone-50 transition-all shadow-sm">
                                {t('search.create_new')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

