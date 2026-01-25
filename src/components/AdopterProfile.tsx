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
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser }: AdopterProfileProps) {
    const { t } = useLanguage();
    const [editingAdoption, setEditingAdoption] = useState<any>(null);

    return (
        <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-8">

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
                            {isNew ? t('adopter.title_new') : (adopter?.name || t('adopter.title_profile'))}
                        </h1>
                        {!isNew && <p className="text-emerald-600/80 font-medium mt-1 text-sm">{t('adopter.id')}: <span className="font-mono text-emerald-500/60">{id}</span></p>}
                    </div>
                </header>

                <AdopterForm initialData={adopter} history={history} />

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
                                initialData={editingAdoption}
                                onCancel={() => setEditingAdoption(null)}
                                onSuccess={() => setEditingAdoption(null)}
                            />
                            <AdoptionHistory
                                adoptions={adoptions}
                                onEdit={(adoption) => {
                                    setEditingAdoption(adoption);
                                    // Scroll to form
                                    const form = document.getElementById('adoption-form');
                                    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }}
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
