'use client';

import { useRef, useState } from 'react';
import { AttachIcon, CloseIcon } from '@/components/ui/Glyph';

export interface PickedMedia {
    data: string;
    mimeType: string;
    preview: string;
    file?: File;
    thumbnail?: string;
}

/**
 * The import wizard's photo/video picker — one component for steps 1 and 2.
 *
 * Step 2 used to render a bare `<input type="file">`: the browser's English
 * "Choose Files — No file chosen", 16px wider than the card at 390px (sideways
 * scroll), and an empty <img> for every video (audit 2026-10-21, A5). The box
 * also takes a dropped file now: it said "click to upload" and had no drop
 * handler, so a screenshot dragged onto it opened in the browser instead (A8).
 * Pasting a screenshot is handled by the wizard, which owns the whole step.
 */
export default function MediaPicker({
    items,
    onAddFiles,
    onRemove,
    label,
    dropzoneText,
    hint,
    removeLabel,
    testId,
}: {
    items: PickedMedia[];
    onAddFiles: (files: File[]) => void;
    onRemove: (index: number) => void;
    label: string;
    dropzoneText: string;
    hint: string;
    removeLabel: string;
    testId?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);

    return (
        <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-stone-700 mb-2">
                <AttachIcon className="w-4 h-4 shrink-0" />{label}
            </label>
            <button
                type="button"
                data-testid={testId}
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                    e.preventDefault();
                    setDragOver(false);
                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
                    if (files.length) onAddFiles(files);
                }}
                className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-stone-300 hover:border-teal-400 hover:bg-teal-50'}`}
            >
                <svg className="w-8 h-8 mx-auto text-stone-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="block text-sm text-stone-600">{dropzoneText}</span>
                <span className="block text-xs text-stone-500 mt-0.5">{hint}</span>
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={e => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) onAddFiles(files);
                    // Reset so the same file can be picked again.
                    e.target.value = '';
                }}
                className="hidden"
            />

            {items.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-3">
                    {items.map((img, i) => (
                        <div key={i} className="relative">
                            {img.file ? (
                                <div className="w-full h-20 rounded-lg overflow-hidden bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center">
                                    {img.thumbnail && <img src={img.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover rounded-lg" />}
                                    <span className="relative w-8 h-8 rounded-full bg-white/25 flex items-center justify-center">
                                        <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                                    </span>
                                </div>
                            ) : (
                                <img src={img.preview} alt="" className="w-full h-20 object-cover rounded-lg" />
                            )}
                            {/* 24px visual, 44px hit area (§1.5) via the ::after inset. */}
                            <button
                                type="button"
                                onClick={() => onRemove(i)}
                                aria-label={removeLabel}
                                title={removeLabel}
                                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow after:absolute after:-inset-2.5 after:content-['']"
                            >
                                <CloseIcon className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
