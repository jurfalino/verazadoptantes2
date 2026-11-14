'use client';

/**
 * «Cargar un animal desde un post» — "it's already here", shown right after
 * the post is read. Each notice shows WHICH animal it matched (photo, or who
 * has it), so the rescuer decides on facts, not on a bare warning.
 */

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { buttonClasses } from '@/components/ui/Button';
import { isFemaleAnimal } from '@/domain/animalSex';
import type { AnimalElsewhere, AnimalMatch } from '@/app/actions/animalImport';

const BOX = 'p-3 rounded-xl border space-y-3';
const warn = { background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)' } as const;

function initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map(w => [...w][0] ?? '').join('').toUpperCase();
}

function speciesWord(t: (k: string) => string, species: string | null): string {
    const s = (species || '').toLowerCase();
    return ['cat', 'dog', 'bird'].includes(s) ? t(`species.${s}`) : (species || '');
}

export function MatchRow({ m, meta }: { m: AnimalMatch; meta?: string }) {
    const { t } = useLanguage();
    return (
        <div className="flex items-center gap-3 rounded-xl bg-white border border-stone-200 p-2">
            {m.photoUrl
                ? <img src={m.photoUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                : <span className="w-12 h-12 rounded-lg bg-stone-100 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-900 break-words">{m.name || t('animalImport.unnamed')}</p>
                <p className="text-xs text-stone-500 break-words">{[speciesWord(t, m.species), meta].filter(Boolean).join(' · ')}</p>
            </div>
        </div>
    );
}

export function addedOn(t: (k: string) => string, locale: string, ms: number | null): string | undefined {
    if (!ms) return undefined;
    const date = new Date(ms).toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-AR', { day: 'numeric', month: 'long' });
    return t('animalImport.dup_name_added').replace('{date}', date);
}

/** The same post: loaded by the viewer's team, and/or by other rescuers. */
export function SamePostNotice({ mine, others, onContinue }: {
    mine: AnimalMatch[];
    others: AnimalElsewhere[];
    onContinue: () => void;
}) {
    const { t, locale } = useLanguage();
    if (mine.length > 0) {
        const first = mine[0];
        return (
            <div data-testid="dup-same-post-mine" className={BOX} style={{ ...warn, color: 'var(--status-warning-text)' }}>
                <p className="text-sm font-semibold">{t('animalImport.dup_mine_title')}</p>
                {mine.map(m => <MatchRow key={m.id} m={m} meta={addedOn(t, locale, m.createdAt)} />)}
                <div className="flex flex-wrap gap-2">
                    <Link href={`/my-animals/${encodeURIComponent(first.id)}`} className={buttonClasses({ size: 'compact' })}>
                        {t('animalImport.dup_mine_open').replace('{name}', first.name || t('animalImport.unnamed'))}
                    </Link>
                    <button type="button" data-testid="dup-continue" onClick={onContinue} className={buttonClasses({ variant: 'secondary', size: 'compact' })}>
                        {t('animalImport.dup_mine_continue')}
                    </button>
                </div>
            </div>
        );
    }
    const o = others[0];
    if (!o) return null;
    const title = o.name ? t('animalImport.dup_other_title').replace('{name}', o.name) : t('animalImport.dup_other_title_unnamed');
    return (
        <div data-testid="dup-same-post-other" className={BOX} style={{ ...warn, color: 'var(--status-warning-text)' }}>
            <p className="text-sm font-semibold break-words">{title}</p>
            {o.owner && (
                <div className="flex items-center gap-3 w-full rounded-2xl border border-stone-200 bg-white p-3 text-left">
                    <span className="flex-none w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-extrabold" aria-hidden="true">
                        {initials(o.owner.displayName)}
                    </span>
                    <div className="min-w-0">
                        <p className="text-[15px] font-bold text-stone-900 break-words">{o.owner.displayName}</p>
                        {o.owner.orgName && <p className="text-xs font-semibold text-stone-500 break-words">{t('animalImport.dup_other_group').replace('{org}', o.owner.orgName)}</p>}
                    </div>
                </div>
            )}
            <p className="text-xs">{t('animalImport.dup_other_body')}</p>
            <div className="flex flex-wrap gap-2">
                {o.publicUrl && (
                    <a href={`${o.publicUrl}${o.publicUrl.includes('?') ? '&' : '?'}lang=${locale}`} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: 'compact' })}>
                        {t('animalImport.dup_other_public')}
                    </a>
                )}
                <button type="button" data-testid="dup-continue" onClick={onContinue} className={buttonClasses({ variant: 'secondary', size: 'compact' })}>
                    {t('animalImport.dup_other_continue')}
                </button>
            </div>
        </div>
    );
}

/** «¿Es el mismo Rocco que ya cargaste?» */
export function SameNameNotice({ match, onYes, onNo, busy }: {
    match: AnimalMatch;
    onYes: () => void;
    onNo: () => void;
    busy?: boolean;
}) {
    const { t, locale } = useLanguage();
    const name = match.name || t('animalImport.unnamed');
    const article = t(isFemaleAnimal(match.sex) ? 'animalImport.dup_name_article_f' : 'animalImport.dup_name_article_m');
    return (
        <div data-testid="dup-same-name" className={BOX} style={{ ...warn, color: 'var(--status-warning-text)' }}>
            <p className="text-sm font-semibold break-words">{t('animalImport.dup_name_title').replace('{article}', article).replace('{name}', name)}</p>
            <MatchRow m={match} meta={addedOn(t, locale, match.createdAt)} />
            <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="dup-name-yes" disabled={busy} onClick={onYes} className={buttonClasses({ size: 'compact' })}>
                    {t('animalImport.dup_name_yes')}
                </button>
                <button type="button" data-testid="dup-name-no" disabled={busy} onClick={onNo} className={buttonClasses({ variant: 'secondary', size: 'compact' })}>
                    {t('animalImport.dup_name_no')}
                </button>
            </div>
        </div>
    );
}
