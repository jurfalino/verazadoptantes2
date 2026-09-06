'use client';

import { useLanguage } from '@/context/LanguageContext';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { formatShortDate } from '@/lib/dates';
import { formatAge } from '@/lib/ageUtils';
import ShareFormMenu from '@/components/ShareFormMenu';
import AnimalShareSheet from '@/components/AnimalShareSheet';
import ShowcaseUrlChips from '@/components/ShowcaseUrlChips';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';

interface AnimalImage {
    id: string;
    url: string;
    caption: string | null;
}

import type { ApplicantSummary as Applicant } from '@/app/actions/applicants';

interface Animal {
    id: string;
    animalName: string;
    species: string | null;
    details: string | null;
    comments: string | null;
    adopterId: string | null;
    adopterName: string | null;
    /** Distinguishes a foster placement ('foster') from a plain available
        animal ('available') or a permanent adoption ('adoption'). */
    recordType: string | null;
    date: number | null;
    age: string | null;
    estimatedBirthDate: number | null;
    neutered: number | null;
    sex: string | null;
    color: string | null;
    images: AnimalImage[];
    /** v2.14.10-21: form-submission applicants targeted at this animal. */
    applicants?: Applicant[];
}

export default function MyAnimalsPage() {
    const { t, locale } = useLanguage();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const toast = useShowToast();
    const view = searchParams.get('view') || 'available';
    const userId = session?.user?.id || '';

    const [animals, setAnimals] = useState<Animal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [speciesFilter, setSpeciesFilter] = useState<string>('all');

    useEffect(() => {
        async function fetchAnimals() {
            setLoading(true);
            try {
                const res = await fetch(`/api/my-animals?view=${view}`);
                if (res.status === 403) {
                    setError('This feature is not enabled yet.');
                    return;
                }
                if (res.ok) {
                    const data = await res.json() as Animal[];
                    // Deduplicate by id to prevent React key warnings
                    const unique = Array.from(new Map(data.map(a => [a.id, a])).values());
                    setAnimals(unique);
                } else {
                    const body = await res.json().catch(() => ({})) as { error?: string; errorId?: string };
                    toast.error(t('errors.generic') || 'Error', body.error || 'Failed to load animals.', body.errorId);
                }
            } catch (e) {
                toast.error(t('errors.generic') || 'Error', 'Failed to load animals.', extractErrorId(e));
            } finally {
                setLoading(false);
            }
        }
        fetchAnimals();
        // Reset filters when switching tabs
        setSearchQuery('');
        setSpeciesFilter('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    // Derive unique species from data
    const speciesList = Array.from(new Set(animals.map(a => (a.species || 'unknown').toLowerCase()))).sort();

    // Client-side filtering
    const filteredAnimals = animals.filter(a => {
        // Species filter
        if (speciesFilter !== 'all' && (a.species || 'unknown').toLowerCase() !== speciesFilter) return false;
        // Text search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const name = (a.animalName || '').toLowerCase();
            const details = (a.details || '').toLowerCase();
            const adopter = (a.adopterName || '').toLowerCase();
            if (!name.includes(q) && !details.includes(q) && !adopter.includes(q)) return false;
        }
        return true;
    });

    const speciesEmoji: Record<string, string> = { cat: '🐱', dog: '🐶', bird: '🐦' };

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading')}</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm max-w-md">
                    <div className="text-3xl mb-3">🔒</div>
                    <h3 className="text-lg font-semibold text-stone-900 mb-2">Feature Not Available</h3>
                    <p className="text-stone-500 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="text-stone-500 hover:text-stone-700 transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">
                            🐾 {t('dashboard.my_animals') || 'My Animals for Adoption'}
                        </h1>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <ShowcaseUrlChips />
                        {userId && <ShareFormMenu userId={userId} />}
                        <Link
                            href="/my-animals/new"
                            className="px-5 py-2.5 bg-teal-700 text-white font-semibold rounded-xl hover:bg-teal-600 transition-colors shadow-lg shadow-teal-700/20 whitespace-nowrap"
                        >
                            + {t('dashboard.add_animal') || 'Add Animal'}
                        </Link>
                    </div>
                </div>

                {/* Hint: form vs contract (visible on all devices) */}
                <div
                    className="mb-4 flex gap-3 rounded-xl px-4 py-3 max-w-2xl"
                    role="status"
                    style={{ backgroundColor: 'var(--surface-muted)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                >
                    <span className="flex-shrink-0 text-base opacity-70" aria-hidden>💡</span>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {String(t('dashboard.share_buttons_hint') || '').trim() || 'Share the form with people interested in adopting; when they complete it the system will notify you. On each animal, share the contract when you have an adopter.'}
                    </p>
                </div>

                {/* View Tabs */}
                <div className="bg-white p-1.5 rounded-xl border border-stone-200 inline-flex flex-wrap gap-1 mb-4">
                    <Link
                        href="/my-animals?view=available"
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'available'
                            ? 'bg-stone-800 text-white shadow-sm'
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                            }`}
                    >
                        🏠 {t('dashboard.available') || 'Available'} ({view === 'available' ? animals.length : '...'})
                    </Link>
                    <Link
                        href="/my-animals?view=adopted"
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'adopted'
                            ? 'bg-stone-800 text-white shadow-sm'
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                            }`}
                    >
                        ✅ {t('dashboard.already_adopted') || 'Already Adopted'} ({view === 'adopted' ? animals.length : '...'})
                    </Link>
                </div>

                {/* Search & Filters */}
                {animals.length > 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 mb-6">
                        {/* Text search */}
                        <div className="relative flex-1">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder={t('common.search') || 'Search...'}
                                className="w-full h-10 pl-10 pr-4 rounded-xl border border-stone-200 bg-white text-stone-900 placeholder-stone-400 text-sm font-medium focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            )}
                        </div>

                        {/* Species filter pills */}
                        <div className="flex gap-1.5 flex-wrap">
                            <button
                                onClick={() => setSpeciesFilter('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${speciesFilter === 'all'
                                    ? 'bg-stone-800 text-white shadow-sm'
                                    : 'bg-white border border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-700'}`}
                            >
                                {t('dashboard.filter_all') || 'All'}
                            </button>
                            {speciesList.map(species => (
                                <button
                                    key={species}
                                    onClick={() => setSpeciesFilter(species === speciesFilter ? 'all' : species)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${speciesFilter === species
                                        ? 'bg-stone-800 text-white shadow-sm'
                                        : 'bg-white border border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-700'}`}
                                >
                                    {speciesEmoji[species] || '🐾'} {t(`species.${species}`) || species}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results count when filtered */}
                {(searchQuery || speciesFilter !== 'all') && (
                    <p className="text-xs text-stone-500 mb-4">
                        {filteredAnimals.length} / {animals.length} {t('common.photos') || 'records'}
                    </p>
                )}

                {filteredAnimals.length === 0 ? (
                    <div className="bg-white rounded-3xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-500">
                            <span className="text-3xl">🐾</span>
                        </div>
                        <h3 className="text-xl font-semibold text-stone-900 mb-2">
                            {view === 'available'
                                ? (t('dashboard.no_animals_title') || 'No animals listed yet')
                                : (t('dashboard.no_adopted_animals') || 'No animals adopted yet')
                            }
                        </h3>
                        <p className="text-stone-500 mb-6">
                            {view === 'available'
                                ? (t('dashboard.no_animals_desc') || 'Add animals you want to give for adoption and share the adoption contract with potential adopters.')
                                : (t('dashboard.no_adopted_desc') || 'Animals that have been adopted by someone will appear here.')
                            }
                        </p>
                        {view === 'available' && (
                            <Link
                                href="/my-animals/new"
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white font-semibold rounded-xl hover:bg-teal-600 transition-colors shadow-lg shadow-teal-700/20"
                            >
                                + {t('dashboard.add_animal') || 'Add Your First Animal'}
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredAnimals.map((animal) => {
                            // A fostered ("Tránsito") animal carries an adopterId
                            // (the foster home) but recordType='foster'. It lives
                            // in the Available tab, so the card can't treat
                            // adopterId alone as "adopted" — branch on recordType.
                            const isFoster = animal.recordType === 'foster';
                            return (
                            <div
                                key={animal.id}
                                className="bg-white rounded-xl shadow-sm border border-stone-200 hover:shadow-md hover:border-teal-200 transition-all relative"
                            >
                                {/* v2.55.15: the card is signals + navigation — the whole
                                    surface opens the animal's page, where every action lives. */}
                                <Link href={`/my-animals/${animal.id}`} className="block" data-testid={`animal-card-${animal.id}`}>
                                    <div className="aspect-video bg-stone-100 relative overflow-hidden rounded-t-xl">
                                        {animal.images && animal.images.length > 0 ? (
                                            <img
                                                src={animal.images[0].url}
                                                alt={animal.animalName || 'Animal'}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-stone-50">
                                                <img
                                                    src={animal.species === 'dog' ? '/placeholders/dog.png' : animal.species === 'cat' ? '/placeholders/cat.png' : '/placeholders/paw.png'}
                                                    alt={animal.species || 'Animal'}
                                                    className="w-full h-full object-contain p-8 opacity-40"
                                                />
                                            </div>
                                        )}
                                        {/* Species badge */}
                                        {animal.species && (
                                            <span className="absolute top-2 left-2 px-2 py-0.5 bg-white/90 backdrop-blur-sm rounded-full text-xs font-semibold text-stone-700 capitalize">
                                                {animal.species === 'cat' ? '🐱' : animal.species === 'dog' ? '🐶' : '🐾'} {animal.species}
                                            </span>
                                        )}
                                        {/* Photo count */}
                                        {animal.images && animal.images.length > 1 && (
                                            <span className="absolute top-2 right-2 px-2 py-0.5 bg-black/50 backdrop-blur-sm rounded-full text-xs font-medium text-white">
                                                📷 {animal.images.length}
                                            </span>
                                        )}
                                    </div>
                                </Link>

                                {/* Content */}
                                <div className="p-4">
                                    <Link href={`/my-animals/${animal.id}`} className="block">
                                        <h3 className="font-semibold text-stone-900 text-lg mb-1 hover:text-teal-700 transition-colors cursor-pointer">
                                            {animal.animalName || t('adoption.unnamed') || 'Unnamed'}
                                        </h3>
                                    </Link>

                                    {animal.details && (
                                        <p className="text-sm text-stone-500 mb-2 line-clamp-2">{animal.details}</p>
                                    )}

                                    {/* Animal detail pills */}
                                    {(animal.estimatedBirthDate || animal.age || animal.sex || animal.neutered != null || animal.color) && (
                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                            {animal.sex && (
                                                <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                                                    {animal.sex === 'male' || animal.sex === 'macho' ? '♂ ' + (locale !== 'en' ? 'Macho' : 'Male')
                                                        : animal.sex === 'female' || animal.sex === 'hembra' ? '♀ ' + (locale !== 'en' ? 'Hembra' : 'Female')
                                                        : animal.sex}
                                                </span>
                                            )}
                                            {(animal.estimatedBirthDate || animal.age) && (
                                                <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                                                    🎂 {animal.estimatedBirthDate
                                                        ? formatAge(animal.estimatedBirthDate, locale as 'es' | 'en')
                                                        : animal.age}
                                                </span>
                                            )}
                                            {animal.neutered === 1 && (
                                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                                    ✓ {t('adoption.neutered') || 'Neutered'}
                                                </span>
                                            )}
                                            {animal.neutered === 0 && (
                                                <span className="px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full text-xs font-medium">
                                                    ✗ {t('adoption.neutered_no_label') || 'Not neutered'}
                                                </span>
                                            )}
                                            {animal.color && (
                                                <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                                                    🎨 {animal.color}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Adopter info (for adopted view) */}
                                    {animal.adopterId && !isFoster && (
                                        <div className="flex items-center gap-2 mb-3 p-2 bg-teal-50 rounded-lg">
                                            <span className="text-sm">✅</span>
                                            <Link
                                                href={`/adopter/${animal.adopterId}`}
                                                className="text-sm font-medium text-teal-700 hover:underline"
                                            >
                                                {t('dashboard.adopted_by') || 'Adopted by'} {adopterDisplayName({ name: animal.adopterName }, t('adopter.nameless'))}
                                            </Link>
                                        </div>
                                    )}

                                    {/* Foster ("Tránsito") info — animal is in a
                                        temporary home, still the rescuer's to place. */}
                                    {isFoster && animal.adopterId && (
                                        <div className="flex items-center gap-2 mb-3 p-2 bg-indigo-100 rounded-lg">
                                            <span className="text-sm">🤝</span>
                                            <Link
                                                href={`/adopter/${animal.adopterId}`}
                                                className="text-sm font-medium text-indigo-800 hover:underline"
                                            >
                                                {t('dashboard.in_foster_with') || 'In foster with'} {adopterDisplayName({ name: animal.adopterName }, t('adopter.nameless'))}
                                            </Link>
                                        </div>
                                    )}

                                    {/* Contract screenshot link */}
                                    {animal.comments && (() => {
                                        try {
                                            const parsed = JSON.parse(animal.comments);
                                            if (parsed.contractScreenshot) {
                                                return (
                                                    <a
                                                        href={parsed.contractScreenshot}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 mb-3 p-2 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                                                        onClick={e => e.stopPropagation()}
                                                    >
                                                        <span className="text-sm">📋</span>
                                                        <span className="text-sm font-medium text-teal-700">{t('dashboard.view_signed_contract') || 'View Signed Contract'}</span>
                                                        <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                    </a>
                                                );
                                            }
                                        } catch { /* not JSON, ignore */ }
                                        return null;
                                    })()}

                                    {/* v2.55.15: cards are signals + ONE quick action. The
                                        applicants disclosure, adopt/foster transitions and
                                        per-card contract flows moved to the animal's page —
                                        here only a count that deep-links to that section. */}
                                    <div className="pt-3 border-t border-stone-100 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs text-stone-500 flex-1 min-w-0">
                                                {animal.date && (
                                                    <span>📅 {formatShortDate(animal.date)}</span>
                                                )}
                                            </div>
                                            {!animal.adopterId && animal.applicants && animal.applicants.length > 0 && (
                                                <Link
                                                    href={`/my-animals/${animal.id}#applicants`}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors whitespace-nowrap"
                                                    data-testid={`applicants-count-${animal.id}`}
                                                >
                                                    {animal.applicants.length} {animal.applicants.length === 1
                                                        ? (t('animalProfile.applicant_one') || 'interesada')
                                                        : (t('animalProfile.applicant_many') || 'interesadas')}
                                                </Link>
                                            )}
                                            {userId && (
                                                <AnimalShareSheet
                                                    userId={userId}
                                                    animalId={animal.id}
                                                    animalName={animal.animalName || 'Animal'}
                                                    adopted={!!animal.adopterId && !isFoster}
                                                    compact
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
