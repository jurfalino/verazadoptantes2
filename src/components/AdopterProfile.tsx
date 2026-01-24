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
        <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-8">

                {!isNew && adopter && (
                    <AdopterFlagging
                        adopterId={id}
                        adopterName={adopter.name}
                        existingFlags={flags}
                    />
                )}

                <header className="flex justify-between items-center px-2">
                    <div>
                        <h1 className="text-4xl font-extrabold text-emerald-950 tracking-tight">
                            {isNew ? t('adopter.title_new') : (adopter?.name || t('adopter.title_profile'))}
                        </h1>
                        {!isNew && <p className="text-emerald-600/80 font-medium mt-1 text-sm">{t('adopter.id')}: <span className="font-mono text-emerald-500/60">{id}</span></p>}
                    </div>
                </header>

                <div className="bg-white rounded-2xl shadow-sm border border-emerald-100/60 overflow-hidden transform transition-all hover:shadow-md duration-300">
                    <AdopterForm initialData={adopter} />
                </div>

                {!isNew && adopter && (
                    <>
                        {/* Images */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/60 p-8">
                            <h3 className="text-xl font-bold mb-6 text-emerald-900 tracking-tight">{t('adopter.images')}</h3>
                            <ImageGallery
                                adopterId={id}
                                initialImages={images}
                                onUpload={async (id, url, caption) => {
                                    await saveImage(id, url, caption);
                                }}
                            />
                        </div>

                        {/* Adoptions */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/60 p-8">
                            <AdoptionHistory adoptions={adoptions} />
                            <div className="mt-8 pt-8 border-t border-slate-100">
                                <AdoptionForm adopterId={id} />
                            </div>
                        </div>

                        {/* History - Collapsible */}
                        {history.length > 0 && (
                            <details className="bg-white rounded-2xl shadow-sm border border-emerald-100/60 overflow-hidden group">
                                <summary className="p-8 cursor-pointer list-none flex justify-between items-center hover:bg-emerald-50/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-xl font-bold text-emerald-900 tracking-tight">{t('audit.log_title')}</h3>
                                        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                                            {history.length}
                                        </span>
                                    </div>
                                    <svg className="w-5 h-5 text-emerald-400 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </summary>

                                <div className="px-8 pb-8 space-y-6 border-t border-emerald-100/50 pt-6">
                                    {history.map((h) => {
                                        let changes = null;
                                        try {
                                            changes = JSON.parse(h.changes as string);
                                        } catch (e) { }

                                        return (
                                            <div key={h.id} className="text-sm border-l-4 border-emerald-200 pl-4 py-1">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">
                                                        {new Date(h.changedAt).toLocaleString()}
                                                    </span>
                                                    <span className="text-xs px-2.5 py-0.5 bg-emerald-100 rounded-full text-emerald-700 font-medium">
                                                        {t('audit.by')} {h.changedBy || 'anonymous'}
                                                    </span>
                                                </div>

                                                <div className="mt-2 space-y-2">
                                                    {changes ? (
                                                        Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                            <div key={key} className="grid grid-cols-[100px_1fr] gap-3 items-start">
                                                                <span className="font-bold text-emerald-800 capitalize">{key}:</span>
                                                                <div className="text-emerald-700 break-words font-medium">
                                                                    <div className="line-through text-rose-400 text-xs mb-0.5 bg-rose-50 inline-block px-1.5 rounded decoration-2">
                                                                        {typeof delta.from === 'string' && delta.from.length > 50
                                                                            ? delta.from.substring(0, 50) + '...'
                                                                            : (delta.from || t('audit.empty_val'))}
                                                                    </div>
                                                                    <div className="text-emerald-400 ml-2 inline-block font-bold">→</div>
                                                                    <div className="text-emerald-900 bg-emerald-100 inline-block px-1.5 rounded ml-2 shadow-sm border border-emerald-200/50">
                                                                        {delta.to || t('audit.empty_val')}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <span className="text-emerald-400 italic">{t('audit.metadata_update')}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </details>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
