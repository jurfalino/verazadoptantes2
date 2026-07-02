'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { countries, getCountryByCode, type Country } from '@/config/countries';
import { useLanguage } from '@/context/LanguageContext';

interface CountrySelectorProps {
    value: string;
    onChange: (code: string) => void;
    detectedCountry?: string | null;
}

export function CountrySelector({ value, onChange, detectedCountry }: CountrySelectorProps) {
    const { locale, t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const selected = getCountryByCode(value);

    const filtered = useMemo(() => {
        if (!search.trim()) return countries;
        const q = search.toLowerCase();
        return countries.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.nameEs.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q)
        );
    }, [search]);

    // Reset highlight when list changes
    useEffect(() => {
        setHighlightIndex(0);
    }, [filtered.length]);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearch('');
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!isOpen || !listRef.current) return;
        const items = listRef.current.querySelectorAll('[data-country-item]');
        items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex, isOpen]);

    const handleSelect = (country: Country) => {
        onChange(country.code);
        setIsOpen(false);
        setSearch('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setIsOpen(true);
                e.preventDefault();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightIndex(i => Math.max(i - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filtered[highlightIndex]) {
                    handleSelect(filtered[highlightIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                setSearch('');
                break;
        }
    };

    const getName = (c: Country) => locale !== 'en' ? c.nameEs : c.name;

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Selected value / trigger */}
            <button
                type="button"
                onClick={() => {
                    setIsOpen(!isOpen);
                    if (!isOpen) {
                        setTimeout(() => inputRef.current?.focus(), 50);
                    }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 hover:border-stone-300 dark:hover:border-stone-600 transition-colors text-left"
            >
                <span className="text-xl">{selected?.flag || '🌍'}</span>
                <span className="flex-1 text-sm font-medium text-stone-800 dark:text-stone-200">
                    {selected ? getName(selected) : (t('settings.country_select') || 'Select country')}
                </span>
                {detectedCountry && value === detectedCountry && (
                    <span className="text-xs px-2 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-700 rounded-full font-medium">
                        {t('settings.country_detected') || 'Auto-detected'}
                    </span>
                )}
                <svg className={`w-4 h-4 text-stone-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-2 bg-white dark:bg-stone-800 rounded-xl shadow-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
                    {/* Search input */}
                    <div className="p-2 border-b border-stone-100 dark:border-stone-700">
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={locale !== 'en' ? 'Buscar país...' : 'Search country...'}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </div>

                    {/* Country list */}
                    <div ref={listRef} className="max-h-60 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-stone-500">
                                {locale !== 'en' ? 'No se encontraron países' : 'No countries found'}
                            </div>
                        ) : (
                            filtered.map((c, i) => (
                                <button
                                    key={c.code}
                                    data-country-item
                                    type="button"
                                    onClick={() => handleSelect(c)}
                                    className={`w-full px-4 py-2.5 flex items-center gap-3 text-left text-sm transition-colors
                                        ${i === highlightIndex ? 'bg-teal-50 dark:bg-teal-900/20' : 'hover:bg-stone-50 dark:hover:bg-stone-700/50'}
                                        ${value === c.code ? 'font-semibold' : 'font-medium'}
                                    `}
                                >
                                    <span className="text-lg flex-shrink-0">{c.flag}</span>
                                    <span className="text-stone-700 dark:text-stone-200">{getName(c)}</span>
                                    {value === c.code && (
                                        <span className="ml-auto text-teal-700 flex-shrink-0">✓</span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
