'use client';

/**
 * «¿Para qué animal?» inside «Compartir formulario» (Jon 2026-11-13: option B
 * + the list with search). Built from parts the rescuer already knows:
 * rows like «Proponer un animal» (photo or species placeholder, name, one line
 * under it), the search box and species buttons of /my-animals. Newest first.
 * The search also matches colour and species, so an animal can be found
 * without remembering its name. «Ninguno en particular» is always first.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { timeAgo } from '@/lib/timeAgo';
import { filterShareAnimals, shareSpeciesKey, shareSpeciesPresent, type ShareAnimal, type ShareSpecies } from '@/domain/shareFormAnimals';
import { SHARE_PICKER_SEARCH_MIN } from '@/config/constants';

const FORM_ICON = 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8';

/** The animal's photo, or the species placeholder the rest of the app uses. */
export function ShareAnimalThumb({ animal }: { animal: Pick<ShareAnimal, 'photo' | 'species'> | null }) {
    if (!animal) {
        return (
            <span className="w-10 h-10 shrink-0 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FORM_ICON} /></svg>
            </span>
        );
    }
    const k = shareSpeciesKey(animal.species);
    return (
        <span className="w-10 h-10 shrink-0 rounded-lg bg-stone-200 overflow-hidden flex items-center justify-center">
            {animal.photo
                ? <img src={animal.photo} alt="" className="w-full h-full object-cover" />
                : <img src={`/placeholders/${k === 'other' ? 'paw' : k}.png`} alt="" className="w-7 h-7 object-contain opacity-60" />}
        </span>
    );
}

export default function ShareAnimalPicker({ animals, pickedId, onPick, onBack }: {
    animals: readonly ShareAnimal[];
    pickedId: string | null;
    onPick: (animal: ShareAnimal | null) => void;
    onBack: () => void;
}) {
    const { t, locale } = useLanguage();
    const [query, setQuery] = useState('');
    const [species, setSpecies] = useState<ShareSpecies | 'all'>('all');

    const speciesLabel = (k: ShareSpecies) => (k === 'other' ? t('share.pick_species_other') : t(`species.${k}`));
    const present = useMemo(() => shareSpeciesPresent(animals), [animals]);
    const searchable = animals.length >= SHARE_PICKER_SEARCH_MIN;
    const filtering = query.trim() !== '' || species !== 'all';
    const shown = filterShareAnimals(animals, { query, species }, speciesLabel);

    const line = (a: ShareAnimal) => {
        const tail = a.candidates === 1 ? t('evaluation.candidates_one')
            : a.candidates > 1 ? t('evaluation.candidates_many').replace('{n}', String(a.candidates))
                : a.addedAtMs ? timeAgo(new Date(a.addedAtMs), locale !== 'en') : '';
        return [speciesLabel(shareSpeciesKey(a.species)), a.color?.trim(), tail].filter(Boolean).join(' · ');
    };

    const row = (key: string, testId: string, picked: boolean, onClick: () => void, thumb: ReactNode, title: string, sub: string) => (
        <li key={key}>
            <button type="button" onClick={onClick} data-testid={testId} aria-pressed={picked}
                className="w-full text-left flex items-center gap-3 min-h-11 py-2 group">
                {thumb}
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-stone-900 group-hover:text-teal-700 [overflow-wrap:anywhere]">{title}</span>
                    <span className="block text-xs text-stone-500 truncate">{sub}</span>
                </span>
                {picked && (
                    <svg className="w-5 h-5 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                )}
            </button>
        </li>
    );

    return (
        <div data-testid="share-animal-picker">
            <div className="p-5 pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onBack} aria-label={t('share.pick_back')} data-testid="share-animal-picker-back"
                        className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-600 transition-colors shrink-0">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="min-w-0">
                        <h3 className="font-semibold text-stone-900 text-sm">{t('share.pick_label')}</h3>
                        <p className="text-xs text-stone-500 mt-0.5">
                            {animals.length === 1 ? t('share.pick_count_one') : t('share.pick_count_many').replace('{n}', String(animals.length))}
                        </p>
                    </div>
                </div>
                {searchable && (
                    <div className="mt-3 space-y-3">
                        <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <input
                                type="search"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={t('share.pick_search')}
                                aria-label={t('share.pick_search')}
                                data-testid="share-animal-search"
                                className="w-full h-11 pl-10 pr-4 rounded-xl border border-stone-200 bg-white text-stone-900 placeholder-stone-400 text-base font-medium focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all"
                            />
                        </div>
                        {present.length > 1 && (
                            <div className="flex gap-1.5 flex-wrap">
                                {(['all', ...present] as const).map(k => (
                                    <button key={k} type="button" onClick={() => setSpecies(k)} aria-pressed={species === k}
                                        data-testid={`share-animal-species-${k}`}
                                        className={`min-h-11 px-3 rounded-lg text-xs font-semibold transition-all ${species === k
                                            ? 'bg-stone-800 text-white shadow-sm'
                                            : 'bg-white border border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-700'}`}>
                                        {k === 'all' ? t('dashboard.filter_all') : speciesLabel(k)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <div className="px-5 py-1 max-h-[60vh] overflow-y-auto">
                <ul className="divide-y divide-stone-200">
                    {!filtering && row('none', 'share-animal-none', pickedId === null, () => onPick(null),
                        <ShareAnimalThumb animal={null} />, t('share.pick_none'), t('share.pick_none_desc'))}
                    {shown.map(a => row(a.id, `share-animal-${a.id}`, pickedId === a.id, () => onPick(a),
                        <ShareAnimalThumb animal={a} />, a.name?.trim() || t('homeModules.unnamed_animal'), line(a)))}
                </ul>
                {filtering && shown.length === 0 && (
                    <p className="text-sm text-stone-600 py-4 text-center" data-testid="share-animal-no-match">
                        {query.trim() ? t('share.pick_no_match').replace('{q}', query.trim()) : t('share.pick_no_match_filter')}
                    </p>
                )}
            </div>
        </div>
    );
}
