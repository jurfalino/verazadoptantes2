'use client';

/**
 * Contract-section editor (TipTap v3). Only paragraph, bullet list, bold,
 * italic and underline exist in the schema, so pasted headings, tables, links
 * and images are reduced by ProseMirror's parser before tiptapToRichDoc ever
 * sees them; the converter is the second line of defence.
 *
 * Imported only by the /settings/adoption-docs editor page, so TipTap never
 * lands in the /settings or /organizations bundles.
 *
 * Reset from outside ("Restaurar texto original") by changing the `key` —
 * `value` is read once, at mount.
 */

import { useEffect, useRef } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { RichDoc } from '@/domain/adoptionDocs';
import { useLanguage } from '@/context/LanguageContext';
import { tiptapToRichDoc, richDocToTiptap, type TipTapNode } from '@/lib/tiptapRichDoc';

const extensions = [StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false,
    orderedList: false, strike: false, link: false, hardBreak: false, dropcursor: false, gapcursor: false,
    trailingNode: false,
})];

type Props = { value: RichDoc; onChange: (d: RichDoc) => void; ariaLabel: string };

export default function RichTextEditor({ value, onChange, ariaLabel }: Props) {
    const { t } = useLanguage();
    // useEditor keeps the options from its first render, so onUpdate would
    // otherwise call a stale onChange — one closing over an old `sections`
    // object, which would undo the edits made to the other sections.
    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; });

    const editor = useEditor({
        extensions,
        content: richDocToTiptap(value),
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'min-h-[160px] px-4 py-3 text-base leading-relaxed text-stone-900 focus:outline-none',
                'aria-label': ariaLabel,
                'aria-multiline': 'true',
                role: 'textbox',
            },
        },
        onUpdate: ({ editor: e }) => onChangeRef.current(tiptapToRichDoc(e.getJSON() as TipTapNode)),
    });

    const active = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: !!e?.isActive('bold'),
            italic: !!e?.isActive('italic'),
            underline: !!e?.isActive('underline'),
            bulletList: !!e?.isActive('bulletList'),
        }),
    });

    const buttons: { key: keyof NonNullable<typeof active>; label: string; run: () => void; icon: React.ReactNode }[] = [
        {
            key: 'bold', label: t('adoptionDocs.toolbar_bold'),
            run: () => editor?.chain().focus().toggleBold().run(),
            icon: <span className="text-base font-bold leading-none" aria-hidden="true">B</span>,
        },
        {
            key: 'italic', label: t('adoptionDocs.toolbar_italic'),
            run: () => editor?.chain().focus().toggleItalic().run(),
            icon: <span className="text-base italic font-semibold leading-none font-serif" aria-hidden="true">I</span>,
        },
        {
            key: 'underline', label: t('adoptionDocs.toolbar_underline'),
            run: () => editor?.chain().focus().toggleUnderline().run(),
            icon: <span className="text-base underline font-semibold leading-none" aria-hidden="true">U</span>,
        },
        {
            key: 'bulletList', label: t('adoptionDocs.toolbar_bullets'),
            run: () => editor?.chain().focus().toggleBulletList().run(),
            icon: (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6h11M9 12h11M9 18h11" />
                    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
                    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
                    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
                </svg>
            ),
        },
    ];

    return (
        <div className="rounded-xl border border-stone-200 bg-white focus-within:border-teal-400 transition-colors">
            <div role="toolbar" aria-label={t('adoptionDocs.toolbar_label')} className="flex gap-1 border-b border-stone-100 p-1">
                {buttons.map(b => {
                    const pressed = !!active?.[b.key];
                    return (
                        <button
                            key={b.key}
                            type="button"
                            onClick={b.run}
                            disabled={!editor}
                            aria-pressed={pressed}
                            aria-label={b.label}
                            title={b.label}
                            className={`min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${pressed
                                ? 'bg-teal-100 text-teal-800'
                                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}`}
                        >
                            {b.icon}
                        </button>
                    );
                })}
            </div>
            <div className="min-h-[160px] [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-2 [&_li_p]:my-0 [&_.ProseMirror>*:first-child]:mt-0 [&_.ProseMirror>*:last-child]:mb-0">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
