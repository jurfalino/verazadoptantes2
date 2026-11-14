'use client';

/**
 * Shared from the phone (Jon 2026-11-14): the share sheet always lands on
 * /import (public/sw.js). Before the person import starts — and before it
 * empties the shared photos out of the service-worker cache — ask what the
 * post is: «Un animal en adopción» goes to «Agregar animal» with the same
 * shared link, text and photos; «Una persona» continues as today.
 *
 * Not asked for a shared contact card (always a person), nor when the person
 * import was chosen on purpose (`kind=person`, e.g. «Cargarlo como persona»).
 */

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { CloseIcon } from '@/components/ui/Glyph';
import { zarazTrack } from '@/lib/zaraz';
import { shouldAskShareKind } from '@/domain/shareKind';

export default function ShareKindGate({ children }: { children: ReactNode }) {
    const sp = useSearchParams();
    const router = useRouter();
    const { t } = useLanguage();
    const [person, setPerson] = useState(false);
    if (person || !shouldAskShareKind(sp)) return <>{children}</>;

    const link = sp.get('shared_url') || sp.get('url') || '';
    const toAnimal = () => {
        const q = new URLSearchParams();
        if (link) q.set('shared_url', link);
        const text = sp.get('shared_text') || sp.get('text');
        if (text) q.set('shared_text', text);
        if (sp.get('shared_images') === 'true') q.set('shared_images', 'true');
        if (sp.get('shared_images_lost') === 'true') q.set('shared_images_lost', 'true');
        zarazTrack('share_kind_chosen', { kind: 'animal' });
        router.replace(`/my-animals/new?${q.toString()}`);
    };
    const toPerson = () => { zarazTrack('share_kind_chosen', { kind: 'person' }); setPerson(true); };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="share-kind-title" data-testid="share-kind">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm">
                <div className="p-5 pb-3 border-b border-stone-100">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 id="share-kind-title" className="font-semibold text-stone-900 text-base">{t('animalImport.share_title')}</h3>
                            {link && (
                                <p className="text-xs text-stone-500 mt-1 truncate" title={link}>{link.replace(/^https?:\/\/(www\.)?/, '')}</p>
                            )}
                        </div>
                        <button type="button" aria-label={t('common.close')} onClick={() => router.push('/')}
                            className="w-11 h-11 -mr-2 -mt-2 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                <div className="p-3 space-y-1">
                    <button type="button" data-testid="share-kind-animal" onClick={toAnimal}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors">
                        <span className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0 text-teal-700">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><circle cx="6" cy="9" r="2" /><circle cx="10" cy="5" r="2" /><circle cx="14" cy="5" r="2" /><circle cx="18" cy="9" r="2" /><path d="M12 11c-3 0-6 4-6 7 0 1.5 1.2 2 2.5 2 1.4 0 2.2-.8 3.5-.8s2.1.8 3.5.8c1.3 0 2.5-.5 2.5-2 0-3-3-7-6-7z" /></svg>
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold text-stone-900">{t('animalImport.share_animal')}</span>
                            <span className="block text-xs text-stone-500">{t('animalImport.share_animal_hint')}</span>
                        </span>
                    </button>
                    <button type="button" data-testid="share-kind-person" onClick={toPerson}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors">
                        <span className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center flex-shrink-0 text-stone-700">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold text-stone-900">{t('animalImport.share_person')}</span>
                            <span className="block text-xs text-stone-500">{t('animalImport.share_person_hint')}</span>
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
