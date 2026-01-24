'use client';

import { useState } from 'react';
import { searchAdopter, SearchResult } from '@/app/actions';
import { RatingBadge } from './RatingBadge';

export default function SearchSection() {
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

    return (
        <div className="w-full max-w-md mx-auto p-4">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-5 shadow-xl border border-white/20">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Vet an Adopter</h2>
                <form onSubmit={handleSearch} className="space-y-4">
                    <div>
                        <label htmlFor="search" className="sr-only">Search</label>
                        <input
                            type="text"
                            id="search"
                            placeholder="Name, Phone, or Email"
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all outline-none text-gray-800 placeholder:text-gray-400"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-70 disabled:scale-100"
                    >
                        {loading ? 'Searching...' : 'Search Records'}
                    </button>
                </form>
            </div>

            {results && (
                <div className="mt-8 space-y-4">
                    <h3 className="text-lg font-semibold text-emerald-800/80 px-2">
                        {results.length === 0 ? 'No records found' : `Found ${results.length} matches`}
                    </h3>
                    {results.map((res) => (
                        <a key={res.adopter.id} href={`/adopter/${res.adopter.id}`} className="block group">
                            <div className="bg-white rounded-xl p-4 shadow-sm border border-emerald-100/60 group-hover:border-emerald-300 group-hover:shadow-md transition-all">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-emerald-900 group-hover:text-emerald-700 transition-colors truncate">{res.adopter.name}</div>
                                        <div className="text-sm text-emerald-600/70 truncate">{res.adopter.contactInfo || 'No contact info'}</div>
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
                        <div className="bg-emerald-50 rounded-xl p-6 text-center border border-emerald-100">
                            <p className="text-emerald-800 mb-3">No history found for "{query}".</p>
                            <a href="/adopter/create" className="inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-800 underline">
                                Create New Record
                            </a>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
