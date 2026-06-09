'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimalChoice {
    id: string;
    animalName?: string | null;
    species?: string | null;
    date?: string | null;
    thumbnailUrl?: string | null;
}

interface Props {
    animals: AnimalChoice[];
    selectedId: string;
    onSelect: (id: string) => void;
    placeholder: string;
    /** When true, the date is appended to each row's label — used by the
     *  follow-up / returned-pet flow where the user picks a past adoption. */
    showDate?: boolean;
    formatDate?: (d: string) => string;
}

/**
 * Thumbnail-aware replacement for the native `<select>` previously used by
 * the AdoptionFormWizard's existing-animal step (v2.18.2). Native options
 * can only render text — for a vetting tool whose users are rescuers
 * managing many animals, the photo is the primary recognition signal.
 *
 * Renders a button trigger that shows the current selection (thumbnail +
 * name + species) and opens a popover with the full list. Closes on
 * outside click, Escape, or after a selection. Keyboard navigation is
 * minimal (Esc to close); upgrading to a full ARIA listbox keyboard model
 * is tracked as a follow-up — outside the scope of "users can't see the
 * photo" fix.
 *
 * Theming: stone/teal palette only (theme-safe per memory
 * `feedback_themed_colors_only`). The thumbnail container has a fixed
 * aspect-square shape so missing-image placeholders don't reflow the row.
 */
export default function AnimalSelectPicker({
    animals,
    selectedId,
    onSelect,
    placeholder,
    showDate = false,
    formatDate,
}: Props) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const selected = animals.find(a => a.id === selectedId) || null;

    // Close on outside click + Escape.
    useEffect(() => {
        if (!open) return;
        const onClickOutside = (e: MouseEvent) => {
            if (!wrapperRef.current) return;
            if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const handlePick = (id: string) => {
        onSelect(id);
        setOpen(false);
    };

    return (
        <div ref={wrapperRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                data-testid="animal-picker-trigger"
                className="w-full min-h-[2.5rem] pl-2 pr-10 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none flex items-center gap-2 text-left"
            >
                {selected ? (
                    <>
                        <AnimalThumb url={selected.thumbnailUrl} />
                        <span className="flex-1 min-w-0 truncate text-base md:text-sm">
                            {selected.animalName || '—'}
                            {selected.species ? ` (${selected.species})` : ''}
                            {showDate && selected.date ? ` — ${formatDate ? formatDate(selected.date) : selected.date}` : ''}
                        </span>
                    </>
                ) : (
                    <span className="flex-1 text-stone-500 text-base md:text-sm">{placeholder}</span>
                )}
                <svg
                    className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-teal-700 pointer-events-none"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                // v2.19.22: the open list renders INLINE (no `absolute`) so the
                // dropdown isn't clipped by the AdoptionFormWizard's
                // `overflow-hidden` container on mobile — the previous absolute
                // layout meant rescuers with the picker near the bottom of the
                // modal could only see the top few rows and physically couldn't
                // scroll to reach the rest (touch scroll on the popover also
                // chained up to the outer dialog scroll instead of scrolling
                // the inner list). Inline placement makes the list part of the
                // wizard's own scroll flow; `overscroll-contain` keeps the
                // inner scroll from chaining when the user does reach the
                // list's own boundaries. Trade-off: the form below the picker
                // gets pushed down while the list is open. That's a transient
                // state (the user is here to pick one animal) and the wizard's
                // outer scroll handles the extra height gracefully.
                <div
                    role="listbox"
                    className="mt-1 w-full max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white shadow-lg"
                >
                    {animals.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-stone-500">{placeholder}</p>
                    ) : (
                        <ul className="divide-y divide-stone-100">
                            {animals.map(a => {
                                const isActive = a.id === selectedId;
                                return (
                                    <li key={a.id}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={isActive}
                                            onClick={() => handlePick(a.id)}
                                            data-testid={`animal-option-${a.id}`}
                                            className={`w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-stone-50 focus:bg-stone-50 focus:outline-none transition-colors ${isActive ? 'bg-teal-50' : ''}`}
                                        >
                                            <AnimalThumb url={a.thumbnailUrl} />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-stone-900 truncate">
                                                    {a.animalName || '—'}
                                                    {a.species ? <span className="text-stone-500 font-normal"> ({a.species})</span> : null}
                                                </p>
                                                {showDate && a.date && (
                                                    <p className="text-xs text-stone-500 mt-0.5">
                                                        {formatDate ? formatDate(a.date) : a.date}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/** Fixed-shape thumbnail container — renders the image when present,
 *  otherwise a neutral paw-print placeholder so the row height stays
 *  consistent and the picker doesn't jitter as the user scrolls. */
function AnimalThumb({ url }: { url?: string | null }) {
    return (
        <div className="w-9 h-9 rounded-md bg-stone-100 border border-stone-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="w-full h-full object-cover" />
            ) : (
                <svg className="w-5 h-5 text-stone-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 8.5c-1.93 0-3.5 1.79-3.5 4S10.07 16.5 12 16.5s3.5-1.79 3.5-4-1.57-4-3.5-4zM5.5 12c-.97 0-1.75-1.12-1.75-2.5S4.53 7 5.5 7s1.75 1.12 1.75 2.5S6.47 12 5.5 12zm13 0c-.97 0-1.75-1.12-1.75-2.5S17.53 7 18.5 7s1.75 1.12 1.75 2.5S19.47 12 18.5 12zM8 5c-.97 0-1.75-1.12-1.75-2.5S7.03 0 8 0s1.75 1.12 1.75 2.5S8.97 5 8 5zm8 0c-.97 0-1.75-1.12-1.75-2.5S15.03 0 16 0s1.75 1.12 1.75 2.5S16.97 5 16 5z" />
                </svg>
            )}
        </div>
    );
}
