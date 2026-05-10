'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getRatingColors } from '@/lib/ratingColors';
import { RATING_LEVELS, RATING_LABEL_KEYS, getRatingLabelKey } from '@/domain/ratings';

interface RatingExplainerProps {
    rating: number;
    children: ReactNode;
}

export function RatingExplainer({ rating, children }: RatingExplainerProps) {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const currentKey = getRatingLabelKey(rating);

    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setIsOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);

    return (
        <div
            className="relative inline-block"
            ref={wrapperRef}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
            <button
                type="button"
                onClick={() => setIsOpen(o => !o)}
                aria-label={t('ratings.scale_title')}
                aria-expanded={isOpen}
                className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-1 rounded-full"
            >
                {children}
            </button>

            {isOpen && (
                <>
                    {/* Mobile backdrop */}
                    <div className="sm:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setIsOpen(false)} />

                    <div
                        role="dialog"
                        aria-label={t('ratings.scale_title')}
                        className="z-50 fixed inset-x-0 bottom-0 rounded-t-2xl sm:rounded-xl sm:absolute sm:inset-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-80 bg-white border border-stone-200 shadow-xl"
                    >
                        <div className="p-4 border-b border-stone-100 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-stone-900">{t('ratings.scale_title')}</h3>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                aria-label={t('common.close') || 'Close'}
                                className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors sm:hidden"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <ul className="p-2 space-y-1 max-h-[70vh] sm:max-h-none overflow-y-auto">
                            {RATING_LEVELS.map((level) => {
                                const colors = getRatingColors(level);
                                const key = RATING_LABEL_KEYS[level];
                                const isCurrent = key === currentKey;
                                return (
                                    <li
                                        key={level}
                                        className={`p-3 rounded-lg ${colors.bg} ${colors.border} border ${isCurrent ? `ring-2 ${colors.ring}` : ''}`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`font-semibold ${colors.text} text-sm`}>
                                                {'⭐'.repeat(level)}
                                            </span>
                                            <span className={`font-semibold ${colors.text} text-sm`}>
                                                {t(`ratings.${key}` as any)}
                                            </span>
                                        </div>
                                        <p className={`text-xs ${colors.text} opacity-90`}>
                                            {t(`ratings.explanation.${key}` as any)}
                                        </p>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="pb-[env(safe-area-inset-bottom)] sm:hidden" />
                    </div>
                </>
            )}
        </div>
    );
}
