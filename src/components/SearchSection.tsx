'use client';

import { useState } from 'react';
import { searchAdopter, SearchResult } from '@/app/actions';
// We'll import these icon components later, or use simple emojis/strings for now if icons packages aren't installed.
// Or we can install lucide-react (standard with shadcn). I'll assume lucide-react is good to have.

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
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Vet an Adopter</h2>
                <form onSubmit={handleSearch} className="space-y-4">
                    <div>
                        <label htmlFor="search" className="sr-only">Search</label>
                        <input
                            type="text"
                            id="search"
                            placeholder="Name, Phone, or Email"
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none text-gray-800 placeholder:text-gray-400"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-70 disabled:scale-100"
                    >
                        {loading ? 'Searching...' : 'Search Records'}
                    </button>
                </form>
            </div>

            {results && (
                <div className="mt-8 space-y-4">
                    <h3 className="text-lg font-semibold text-gray-700 px-2">
                        {results.length === 0 ? 'No records found' : `Found ${results.length} matches`}
                    </h3>
                    {results.map((res) => (
                        <a key={res.adopter.id} href={`/adopter/${res.adopter.id}`} className="block group">
                            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 group-hover:border-blue-200 group-hover:shadow-md transition-all">
                                <div className="font-bold text-gray-900 group-hover:text-blue-600">{res.adopter.name}</div>
                                <div className="text-sm text-gray-500">{res.adopter.phone || 'No phone'}</div>
                                <div className="text-sm text-gray-500">{res.adopter.email || 'No email'}</div>
                                <div className="mt-2 flex gap-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${res.adopter.status === 'blocked' ? 'bg-red-100 text-red-700' :
                                            res.adopter.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-green-100 text-green-700'
                                        }`}>
                                        {res.adopter.status === 'good' ? 'Good Record' : res.adopter.status}
                                    </span>
                                </div>
                            </div>
                        </a>
                    ))}
                    {results.length === 0 && (
                        <div className="bg-blue-50 rounded-xl p-6 text-center">
                            <p className="text-blue-800 mb-3">No history found for "{query}".</p>
                            <a href="/adopter/create" className="inline-block text-sm font-semibold text-blue-600 hover:text-blue-800 underline">
                                Create New Record
                            </a>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
