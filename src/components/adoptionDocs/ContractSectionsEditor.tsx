'use client';

/**
 * «Contrato» tab. Section 1 (the animal's data) and section 5 (data consent)
 * are fixed and shown muted; sections 2–4 are editable, pre-filled with the
 * standard Spanish text.
 *
 * Per section it also shows what collaborative editing needs (state lives in
 * the page): «Actualizada por …» after a teammate's text was pulled in, the
 * conflict banner + side-by-side compare when a teammate saved the same
 * section meanwhile, and the language note once the text differs from the
 * standard one (the contract is shown in Spanish to every reader then).
 */

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { SECTION_KEYS, type ContractSections, type RichDoc, type SectionKey } from '@/domain/adoptionDocs';
import { STANDARD_SECTIONS_ES, STANDARD_RICH_DOCS } from '@/domain/standardContractText';
import { storedSection } from '@/domain/adoptionDocsCollab';
import RichTextEditor from './RichTextEditor';
import RichDocPreview, { StandardSectionPreview } from './RichDocPreview';

export type SectionConflictView = { by: string; doc: RichDoc | null };

type Props = {
    sections: ContractSections;
    onChange: (s: ContractSections) => void;
    /** Bumped by the page after a save changes a section's content (e.g. an emptied one back to standard). */
    remounts?: Partial<Record<SectionKey, number>>;
    /** A teammate saved this section while it was being edited. */
    conflicts?: Partial<Record<SectionKey, SectionConflictView>>;
    /** A teammate's text was pulled in on the last save. */
    updatedBy?: Partial<Record<SectionKey, string>>;
    saving?: boolean;
    onKeepMine?: (k: SectionKey) => void;
    onKeepTheirs?: (k: SectionKey) => void;
};

export default function ContractSectionsEditor({
    sections, onChange, remounts, conflicts = {}, updatedBy = {}, saving = false, onKeepMine, onKeepTheirs,
}: Props) {
    const { t } = useLanguage();
    // Bumped per section by "Restaurar texto original" to remount its editor
    // (RichTextEditor reads `value` only at mount).
    const [resets, setResets] = useState<Record<SectionKey, number>>({ '2': 0, '3': 0, '4': 0 });
    const [compare, setCompare] = useState<Partial<Record<SectionKey, boolean>>>({});

    const edit = (k: SectionKey, doc: RichDoc) => onChange({ ...sections, [k]: doc });

    const restore = (k: SectionKey) => {
        const next = { ...sections };
        delete next[k];
        onChange(next);
        setResets(r => ({ ...r, [k]: r[k] + 1 }));
    };

    const muted = 'rounded-2xl border border-stone-200 bg-stone-50 p-4';
    const heading = 'text-sm font-bold text-stone-900';
    const linkBtn = 'min-h-11 px-2 text-sm font-semibold text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed';
    const name = (by: string) => by || t('adoptionDocs.someone');

    return (
        <div className="space-y-6">
            <section className={muted} data-testid="contract-section-1">
                <p className="text-sm text-stone-500">{t('adoptionDocs.section1_note')}</p>
            </section>

            {SECTION_KEYS.map(k => {
                const conflict = conflicts[k];
                const editor = (
                    <RichTextEditor
                        key={`${k}-${resets[k]}-${remounts?.[k] ?? 0}`}
                        value={sections[k] ?? STANDARD_RICH_DOCS[k]}
                        onChange={doc => edit(k, doc)}
                        ariaLabel={t('adoptionDocs.section_editor_label').replace('{n}', k)}
                    />
                );
                return (
                    <section key={k} className="space-y-2" data-testid={`contract-section-${k}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className={heading}>{STANDARD_SECTIONS_ES[k].title}</h3>
                            {updatedBy[k] !== undefined && !conflict && (
                                <span className="text-xs font-semibold text-teal-700" data-testid={`contract-section-${k}-updated-by`}>
                                    {t('adoptionDocs.updated_by').replace('{name}', name(updatedBy[k]!))}
                                </span>
                            )}
                        </div>

                        {conflict && (
                            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid={`contract-section-${k}-conflict`}>
                                <p className="text-sm text-amber-900">{t('adoptionDocs.conflict_banner').replace('{name}', name(conflict.by))}</p>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" className={linkBtn} onClick={() => setCompare(c => ({ ...c, [k]: !c[k] }))} data-testid={`contract-section-${k}-view-theirs`}>
                                        {compare[k] ? t('adoptionDocs.conflict_hide') : t('adoptionDocs.conflict_view')}
                                    </button>
                                    {!compare[k] && (
                                        <button type="button" className={linkBtn} disabled={saving} onClick={() => onKeepMine?.(k)} data-testid={`contract-section-${k}-keep-mine`}>
                                            {t('adoptionDocs.conflict_keep_mine')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {conflict && compare[k] ? (
                            <div className="grid gap-3 md:grid-cols-2" data-testid={`contract-section-${k}-compare`}>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                                        {t('adoptionDocs.conflict_their_version').replace('{name}', name(conflict.by))}
                                    </p>
                                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3" data-testid={`contract-section-${k}-theirs`}>
                                        <RichDocPreview doc={conflict.doc ?? STANDARD_RICH_DOCS[k]} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('adoptionDocs.conflict_your_version')}</p>
                                    {editor}
                                </div>
                                <div className="md:col-span-2 flex flex-wrap gap-2">
                                    <button type="button" className={linkBtn} disabled={saving} onClick={() => { setCompare(c => ({ ...c, [k]: false })); onKeepMine?.(k); }} data-testid={`contract-section-${k}-save-this`}>
                                        {t('adoptionDocs.conflict_save_this')}
                                    </button>
                                    <button type="button" className={linkBtn} disabled={saving} onClick={() => { setCompare(c => ({ ...c, [k]: false })); onKeepTheirs?.(k); }} data-testid={`contract-section-${k}-keep-theirs`}>
                                        {t('adoptionDocs.conflict_keep_theirs').replace('{name}', name(conflict.by))}
                                    </button>
                                </div>
                            </div>
                        ) : editor}

                        {storedSection(k, sections[k]) && (
                            <p className="text-xs text-stone-500 max-w-prose" data-testid={`contract-section-${k}-language-note`}>
                                {t('adoptionDocs.language_warning')}
                            </p>
                        )}

                        <button type="button" onClick={() => restore(k)} disabled={!sections[k]} className={linkBtn}>
                            {t('adoptionDocs.restore_section')}
                        </button>
                    </section>
                );
            })}

            <section className={`${muted} space-y-2`} data-testid="contract-section-5">
                <h3 className="text-sm font-bold text-stone-500">{STANDARD_SECTIONS_ES['5'].title}</h3>
                <StandardSectionPreview section={STANDARD_SECTIONS_ES['5']} />
                <p className="inline-flex items-center gap-2 text-xs font-semibold text-stone-500">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    {t('adoptionDocs.locked_section')}
                </p>
            </section>
        </div>
    );
}
