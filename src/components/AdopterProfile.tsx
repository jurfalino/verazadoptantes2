'use client';

import { useState } from 'react';

import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionForm from '@/components/AdoptionForm';
import { ImageGallery } from '@/components/ImageGallery';
import { AdopterFlagging } from '@/components/AdopterFlagging';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage } from '@/app/actions';

interface AdopterProfileProps {
    id: string;
    isNew: boolean;
    adopter: any;
    history: any[];
    adoptions: any[];
    images: any[];
    flags: any[];
    currentUser: string;
    availableAnimals: any[];
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals }: AdopterProfileProps) {
    const { t } = useLanguage();

    return (
        <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-8">

                {/* Back Navigation */}
                <div className="mb-2">
                    <a href="/" className="inline-flex items-center gap-2 text-sm text-emerald-600/70 hover:text-emerald-800 transition-colors font-medium group">
                        <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        {t('nav.back_to_search') || 'Back to Search'}
                    </a>
                </div>

                {!isNew && adopter && (
                    <AdopterFlagging
                        adopterId={id}
                        adopterName={adopter.name}
                        existingFlags={flags}
                    />
                )}

                <header className="flex flex-wrap justify-between items-end px-2 gap-4">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-extrabold text-emerald-950 tracking-tight">
                            {t('adopter.title_profile')}
                        </h1>
                        {!isNew && <p className="text-emerald-600/80 font-medium mt-1 text-sm">{t('adopter.id')}: <span className="font-mono text-emerald-500/60">{id}</span></p>}
                    </div>
                </header>

                <AdopterForm initialData={adopter} history={history} currentUser={currentUser} />

                {!isNew && adopter && (
                    <>
                        {/* Images - Collapsible */}
                        <CollapsibleSection title={t('adopter.images')} count={images.length} defaultOpen={true}>
                            <ImageGallery
                                adopterId={id}
                                initialImages={images}
                                onUpload={async (adopterId, url, caption) => {
                                    await saveImage(adopterId, url, caption);
                                }}
                                currentUser={currentUser}
                            />
                        </CollapsibleSection>

                        {/* Adoptions - Collapsible */}
                        <CollapsibleSection title={t('adoption.title')} count={adoptions.length} defaultOpen={true}>
                            <AdoptionForm
                                adopterId={id}
                                availableAnimals={availableAnimals}
                                currentUser={currentUser}
                            />
                            <AdoptionHistory
                                adoptions={adoptions}
                                onEdit={() => { }}
                                adopterId={id}
                                currentUser={currentUser}
                            />
                        </CollapsibleSection>
                    </>
                )}
            </div>
        </main>
    );
}
