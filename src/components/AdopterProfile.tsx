'use client';

import { AdopterForm } from '@/components/AdopterForm';
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
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags }: AdopterProfileProps) {
    const { t } = useLanguage();

    return (
        <main className="min-h-screen bg-gray-50 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-8">

                {!isNew && adopter && (
                    <AdopterFlagging
                        adopterId={id}
                        adopterName={adopter.name}
                        existingFlags={flags}
                    />
                )}

                <header className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">
                            {isNew ? t('adopter.title_new') : (adopter?.name || t('adopter.title_profile'))}
                        </h1>
                        {!isNew && <p className="text-gray-500 text-sm">{t('adopter.id')}: {id}</p>}
                    </div>
                </header>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <AdopterForm initialData={adopter} />
                </div>

                {!isNew && adopter && (
                    <>
                        {/* Images */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                            <h3 className="text-lg font-bold mb-4 text-gray-800">{t('adopter.images')}</h3>
                            <ImageGallery adopterId={id} initialImages={images} onUpload={saveImage} />
                        </div>

                        {/* Adoptions */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                            <AdoptionHistory adoptions={adoptions} />
                            <div className="mt-6 pt-6 border-t border-gray-100">
                                <AdoptionForm adopterId={id} />
                            </div>
                        </div>

                        {/* History */}
                        {history.length > 0 && (
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                                <h3 className="text-lg font-bold mb-4 text-gray-800">{t('audit.log_title')}</h3>
                                <div className="space-y-6">
                                    {history.map((h) => {
                                        let changes = null;
                                        try {
                                            changes = JSON.parse(h.changes as string);
                                        } catch (e) { }

                                        return (
                                            <div key={h.id} className="text-sm border-l-4 border-gray-200 pl-4 py-1">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">
                                                        {new Date(h.changedAt).toLocaleString()}
                                                    </span>
                                                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                                                        {t('audit.by')} {h.changedBy || 'anonymous'}
                                                    </span>
                                                </div>

                                                <div className="mt-2 space-y-2">
                                                    {changes ? (
                                                        Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                            <div key={key} className="grid grid-cols-[100px_1fr] gap-2 items-start">
                                                                <span className="font-medium text-gray-700 capitalize">{key}:</span>
                                                                <div className="text-gray-600 break-words">
                                                                    <div className="line-through text-red-400 text-xs mb-0.5 bg-red-50 inline-block px-1 rounded">
                                                                        {typeof delta.from === 'string' && delta.from.length > 50
                                                                            ? delta.from.substring(0, 50) + '...'
                                                                            : (delta.from || t('audit.empty_val'))}
                                                                    </div>
                                                                    <div className="text-blue-600 ml-1 inline-block">→</div>
                                                                    <div className="text-green-700 bg-green-50 inline-block px-1 rounded ml-1">
                                                                        {delta.to || t('audit.empty_val')}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <span className="text-gray-400 italic">{t('audit.metadata_update')}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
