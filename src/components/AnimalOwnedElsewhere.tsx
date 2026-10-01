'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { illustrationForSpecies, tagLabel } from '@/domain/animalAccess';
import { TaggedPet } from '@/components/notFound/illustrations';

interface Props {
    animal: { name: string | null; species: string | null };
    owner: { displayName: string; orgName?: string } | null;
    publicUrl: string | null;
}

function initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map(w => [...w][0] ?? '').join('').toUpperCase();
}

export default function AnimalOwnedElsewhere({ animal, owner, publicUrl }: Props) {
    const { t } = useLanguage();
    const name = animal.name?.trim() || '';
    const shownName = name || t('ownedElsewhere.unnamed');
    const primary = 'min-h-11 flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold bg-teal-700 text-white shadow-sm transition-all duration-200 hover:-translate-y-px';
    const secondary = 'min-h-11 flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold bg-teal-50 text-teal-700 border border-teal-200 transition-all duration-200';

    return (
        <main data-testid="owned-elsewhere" className="min-h-[calc(100vh-4rem)] bg-stone-50 px-4 py-16 flex flex-col items-center text-center gap-4">
            <TaggedPet kind={illustrationForSpecies(animal.species)} label={tagLabel(name)} />
            <h1 className="text-xl font-extrabold tracking-tight text-stone-900 break-words max-w-sm">
                {t('ownedElsewhere.title').replace('{name}', shownName)}
            </h1>
            <p className="text-sm font-medium text-stone-500 max-w-xs">{t('ownedElsewhere.body')}</p>

            {owner && (
                <div data-testid="owned-elsewhere-owner" className="flex items-center gap-3 w-full max-w-xs rounded-2xl border border-stone-200 bg-white p-4 text-left">
                    <span className="flex-none w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-extrabold" aria-hidden="true">
                        {initials(owner.displayName)}
                    </span>
                    <div className="min-w-0">
                        <p className="text-[15px] font-bold text-stone-900 break-words">{owner.displayName}</p>
                        {owner.orgName && (
                            <p className="text-xs font-semibold text-stone-500 flex items-center gap-1 break-words">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                </svg>
                                {t('ownedElsewhere.group').replace('{org}', owner.orgName)}
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
                {publicUrl && (
                    <a href={publicUrl} target="_blank" rel="noopener noreferrer" className={primary} data-testid="owned-elsewhere-public-link">
                        {name ? t('ownedElsewhere.public_link').replace('{name}', name) : t('ownedElsewhere.public_link_unnamed')}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
                        </svg>
                    </a>
                )}
                <Link href="/my-animals" className={publicUrl ? secondary : primary}>{t('ownedElsewhere.back')}</Link>
            </div>
        </main>
    );
}
