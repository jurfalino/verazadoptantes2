'use client';

/**
 * The post's photos as selectable tiles — the person import's review grid
 * (ImportWizard step 2): the whole tile is the control, a check when chosen,
 * dimmed when not. In a litter a tile also names the OTHER animals using it,
 * since one photo of the three together belongs to each of them.
 */

import { useLanguage } from '@/context/LanguageContext';
import { CheckIcon } from '@/components/ui/Glyph';
import type { PostPhoto } from '@/components/animals/importSave';

export default function PostPhotoGrid({ photos, selected, onToggle, usedBy, testId = 'post-photos' }: {
    photos: PostPhoto[];
    selected: Set<number>;
    onToggle: (i: number) => void;
    usedBy?: Record<number, string[]>;
    testId?: string;
}) {
    const { t } = useLanguage();
    if (photos.length === 0) return null;
    const label = photos.length === 1
        ? t(selected.size ? 'animalImport.photos_one_on' : 'animalImport.photos_one_off')
        : t('animalImport.photos_n').replace('{n}', String(selected.size)).replace('{total}', String(photos.length));
    return (
        <div data-testid={testId} className="mb-3">
            <p className="block text-xs font-semibold text-teal-800 mb-2">{label}</p>
            <div className="grid grid-cols-4 gap-2">
                {photos.map((p, i) => {
                    const on = selected.has(i);
                    const others = usedBy?.[i] ?? [];
                    return (
                        <button
                            key={i}
                            type="button"
                            aria-pressed={on}
                            aria-label={t('animalImport.photo_toggle').replace('{n}', String(i + 1))}
                            data-testid={`${testId}-${i}`}
                            onClick={() => onToggle(i)}
                            className={`relative rounded-lg overflow-hidden border-2 transition-all ${on ? 'border-teal-400 shadow-sm' : 'border-transparent opacity-50 hover:opacity-75'}`}
                        >
                            <img src={p.preview} alt="" className="w-full h-20 object-cover bg-stone-100" />
                            <span aria-hidden="true" className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center ${on ? 'bg-teal-600 text-white' : 'bg-white/80 text-stone-500 border border-stone-300'}`}>
                                {on ? <CheckIcon className="w-3.5 h-3.5" /> : null}
                            </span>
                            {others.length > 0 && (
                                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[11px] font-semibold px-1 py-0.5 truncate">{others.join(', ')}</span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
