'use client';

import { useTheme } from '@/context/ThemeContext';
import { useState, useRef, useEffect } from 'react';

const themes = [
    { id: 'light', label: 'Claro', icon: '☀️', bg: '#fafaf9', fg: '#1c1917' },
    { id: 'apple', label: 'Gris', icon: '🌫️', bg: '#d1d1d6', fg: '#1d1d1f' },
    { id: 'dark', label: 'Azul Noche', icon: '🌙', bg: '#0a1628', fg: '#e0e7ff' },
] as const;

export function ThemeSelector() {
    const { theme, setTheme } = useTheme();
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
                title="Cambiar tema"
                aria-label="Cambiar tema"
            >
                <span className="text-lg">{currentTheme.icon}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white dark:bg-stone-800 rounded-xl shadow-lg border border-stone-200 dark:border-stone-700 overflow-hidden z-50 min-w-[140px]">
                    {themes.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => {
                                setTheme(t.id);
                                setIsOpen(false);
                            }}
                            className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors text-left ${theme === t.id ? 'bg-stone-100 dark:bg-stone-700' : ''
                                }`}
                        >
                            <span
                                className="w-5 h-5 rounded-full border border-stone-300 flex-shrink-0"
                                style={{ backgroundColor: t.bg }}
                            />
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                                {t.label}
                            </span>
                            {theme === t.id && (
                                <span className="ml-auto text-teal-500">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
