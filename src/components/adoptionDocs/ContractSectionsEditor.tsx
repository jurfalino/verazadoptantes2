'use client';

/**
 * «Contrato» tab. Section 1 (the animal's data) and section 5 (data consent)
 * are fixed and shown muted; sections 2–4 are editable, pre-filled with the
 * standard Spanish text.
 */

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { SECTION_KEYS, type ContractSections, type RichDoc, type SectionKey } from '@/domain/adoptionDocs';
import { STANDARD_SECTIONS_ES, STANDARD_RICH_DOCS } from '@/domain/standardContractText';
import RichTextEditor from './RichTextEditor';
import { StandardSectionPreview } from './RichDocPreview';

type Props = {
    sections: ContractSections;
    onChange: (s: ContractSections) => void;
    /** Bumped by the page after a save changes a section's content (e.g. an emptied one back to standard). */
    remounts?: Partial<Record<SectionKey, number>>;
};

export default function ContractSectionsEditor({ sections, onChange, remounts }: Props) {
    const { t } = useLanguage();
    // Bumped per section by "Restaurar texto original" to remount its editor
    // (RichTextEditor reads `value` only at mount).
    const [resets, setResets] = useState<Record<SectionKey, number>>({ '2': 0, '3': 0, '4': 0 });

    const edit = (k: SectionKey, doc: RichDoc) => onChange({ ...sections, [k]: doc });

    const restore = (k: SectionKey) => {
        const next = { ...sections };
        delete next[k];
        onChange(next);
        setResets(r => ({ ...r, [k]: r[k] + 1 }));
    };

    const muted = 'rounded-2xl border border-stone-200 bg-stone-50 p-4';
    const heading = 'text-sm font-bold text-stone-900';

    return (
        <div className="space-y-6">
            <section className={muted} data-testid="contract-section-1">
                <p className="text-sm text-stone-500">{t('adoptionDocs.section1_note')}</p>
            </section>

            {SECTION_KEYS.map(k => (
                <section key={k} className="space-y-2" data-testid={`contract-section-${k}`}>
                    <h3 className={heading}>{STANDARD_SECTIONS_ES[k].title}</h3>
                    <RichTextEditor
                        key={`${k}-${resets[k]}-${remounts?.[k] ?? 0}`}
                        value={sections[k] ?? STANDARD_RICH_DOCS[k]}
                        onChange={doc => edit(k, doc)}
                        ariaLabel={t('adoptionDocs.section_editor_label').replace('{n}', k)}
                    />
                    <button
                        type="button"
                        onClick={() => restore(k)}
                        disabled={!sections[k]}
                        className="min-h-11 px-2 text-sm font-semibold text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                    >
                        {t('adoptionDocs.restore_section')}
                    </button>
                </section>
            ))}

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
