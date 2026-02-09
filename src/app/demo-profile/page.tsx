'use client';

export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { useRouter } from 'next/navigation';
import { formatShortDate } from '@/lib/dates';

export default function DemoProfilePage() {
    const { t } = useLanguage();
    const router = useRouter();

    // Sample adopter data
    const adopter = {
        name: 'Juan Ejemplo García',
        contactInfo: 'Teléfono: 11-5555-1234\nEmail: juan.ejemplo@email.com\nIG: @juan_ejemplo\nDirección: Av. Corrientes 1234, CABA',
        notes: 'Vive en departamento con balcón. Tiene experiencia con gatos. Trabaja desde casa.',
        familyMembers: 'María García (esposa)\nPedro Ejemplo (hijo, 12 años)',
        status: '4',
        createdAt: new Date('2025-11-15'),
        updatedAt: new Date('2026-01-20'),
    };

    const adoptions = [
        {
            animalName: 'Luna',
            species: 'cat',
            rating: 5,
            status: 'completed',
            date: '2025-12-01',
            comments: 'Excelente adoptante. Envió fotos de seguimiento a la semana y al mes. Luna está muy bien cuidada.',
        },
        {
            animalName: 'Rocky',
            species: 'dog',
            rating: 3,
            status: 'completed',
            date: '2025-08-15',
            comments: 'Adopción completada. Faltó seguimiento a los 3 meses, pero respondió cuando fue contactado.',
        },
    ];

    const flags = {
        verified_identity: true,
        verified_address: false,
        inaccurate: false,
        duplicate: false,
    };

    return (
        <main className="min-h-screen bg-stone-50 py-8 px-4">
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Demo banner */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                    <p className="text-amber-800 text-sm font-medium">
                        👋 {t('home.sample_record') || 'This is an example profile'} — {t('demo.not_real') || 'this is not a real person'}
                    </p>
                </div>

                {/* Profile Header */}
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 ring-2 ring-white shadow-sm">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold text-stone-900">{adopter.name}</h1>
                            <p className="text-sm text-stone-500">
                                📅 Registered: {formatShortDate(adopter.createdAt)}
                            </p>
                        </div>
                        <RatingBadge rating={adopter.status} size="lg" />
                    </div>

                    {/* Flags */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {flags.verified_identity && (
                            <span className="text-xs px-2 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700">✓ {t('flags.verified_identity')}</span>
                        )}
                        {flags.inaccurate && (
                            <span className="text-xs px-2 py-1 rounded-full font-medium bg-rose-100 text-rose-700">⚠ {t('flags.inaccurate')}</span>
                        )}
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-3">
                        <div>
                            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">{t('adopter.contact')}</h3>
                            <pre className="text-sm text-stone-700 whitespace-pre-wrap font-sans bg-stone-50 rounded-lg p-3 border border-stone-100">
                                {adopter.contactInfo}
                            </pre>
                        </div>
                        <div>
                            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">{t('adopter.family_members')}</h3>
                            <pre className="text-sm text-stone-700 whitespace-pre-wrap font-sans bg-stone-50 rounded-lg p-3 border border-stone-100">
                                {adopter.familyMembers}
                            </pre>
                        </div>
                        <div>
                            <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">{t('adopter.notes')}</h3>
                            <pre className="text-sm text-stone-700 whitespace-pre-wrap font-sans bg-stone-50 rounded-lg p-3 border border-stone-100">
                                {adopter.notes}
                            </pre>
                        </div>
                    </div>
                </div>

                {/* Adoption History */}
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                    <h2 className="text-lg font-bold text-stone-900 mb-4">{t('adoption.history_title')}</h2>
                    <div className="space-y-4">
                        {adoptions.map((a, i) => (
                            <div key={i} className="border border-stone-100 rounded-xl p-4 bg-stone-50">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{a.species === 'cat' ? '🐱' : '🐶'}</span>
                                        <span className="font-semibold text-stone-800">{a.animalName}</span>
                                    </div>
                                    <RatingBadge rating={String(a.rating)} size="sm" />
                                </div>
                                <p className="text-xs text-stone-400 mb-2">📅 {a.date}</p>
                                <p className="text-sm text-stone-600">{a.comments}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Stats (sample) */}
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                    <h2 className="text-lg font-bold text-stone-900 mb-4">{t('stats.profile_stats')}</h2>
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                            <p className="text-2xl font-bold text-stone-800">12</p>
                            <p className="text-xs text-stone-500">{t('stats.searches')}</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-stone-800">8</p>
                            <p className="text-xs text-stone-500">{t('stats.views')}</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-stone-800">2</p>
                            <p className="text-xs text-stone-500">{t('stats.adoptions')}</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-stone-800">3</p>
                            <p className="text-xs text-stone-500">{t('stats.requests')}</p>
                        </div>
                    </div>
                </div>

                {/* Back to home */}
                <div className="text-center">
                    <button
                        onClick={() => router.push('/')}
                        className="px-6 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition-all shadow-sm"
                    >
                        ← {t('common.back_to_search') || 'Back to Home'}
                    </button>
                </div>
            </div>
        </main>
    );
}
