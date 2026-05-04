'use client';

import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useState, useRef, useEffect } from 'react';

const themes = [
    { id: 'light', labelKey: 'theme.light', icon: '☀️', bg: '#e5e5ea', fg: '#1d1d1f' },
    { id: 'dark', labelKey: 'theme.dark', icon: '🌙', bg: '#0a1628', fg: '#e0e7ff' },
] as const;

export function ThemeSelector() {
    const { theme, setTheme } = useTheme();
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentTheme = themes.find(t => t.id === theme) || themes[0];

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-xl hover:bg-stone-200/50 dark:hover:bg-stone-700/50 transition-colors"
                title={t('theme.change')}
                aria-label={t('theme.change')}
            >
                <span className="text-lg">{currentTheme.icon}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white dark:bg-stone-800 rounded-xl shadow-lg border border-stone-200 dark:border-stone-700 overflow-hidden z-50 min-w-[140px]">
                    {themes.map((opt) => (
                        <button
                            key={opt.id}
                            onClick={() => {
                                setTheme(opt.id);
                                setIsOpen(false);
                            }}
                            className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors text-left ${theme === opt.id ? 'bg-stone-100 dark:bg-stone-700' : ''
                                }`}
                        >
                            <span
                                className="w-5 h-5 rounded-full border border-stone-300 flex-shrink-0"
                                style={{ backgroundColor: opt.bg }}
                            />
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                                {t(opt.labelKey)}
                            </span>
                            {theme === opt.id && (
                                <span className="ml-auto text-teal-700">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
