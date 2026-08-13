'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';

type FaqCategory = 'about' | 'privacy' | 'getting-started' | 'process';

type FaqItem = {
    slug: string;
    entry: {
        questionEs: string; questionEn: string; questionPt: string;
        answerEs: string; answerEn: string; answerPt: string;
        category: FaqCategory;
        order: number;
    };
};

// Display order of the category sections.
const CATEGORY_ORDER: FaqCategory[] = ['about', 'privacy', 'getting-started', 'process'];

// Accent-insensitive, case-insensitive normalizer for the search filter.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '');

// Render inline **bold** markers in an FAQ answer paragraph as emphasized <strong>.
// Lets the content (guide-data.ts) highlight core concepts without any markdown dep.
function renderInline(text: string) {
    return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
        const m = /^\*\*(.+)\*\*$/.exec(part);
        return m ? <strong key={i} className="font-semibold text-stone-800">{m[1]}</strong> : part;
    });
}

export default function FaqPage() {
    const { locale, t } = useLanguage();
    const isEn = locale === 'en';
    const isPt = locale === 'pt';
    const pick = <T,>(es: T, en: T, pt: T) => (isEn ? en : isPt ? pt : es);

    const [faq, setFaq] = useState<FaqItem[]>([]);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        fetch('/api/guide-content')
            .then((res) => res.json() as Promise<{ faq?: FaqItem[] }>)
            .then((data) => setFaq(data.faq || []))
            .catch((err) => console.error('[FAQ] Failed to load content:', err));
    }, []);

    // Deep-link: open + scroll to an entry when the URL has a matching #slug.
    useEffect(() => {
        if (faq.length === 0) return;
        const hash = decodeURIComponent(window.location.hash.replace('#', ''));
        if (hash && faq.some((f) => f.slug === hash)) {
            setExpanded((prev) => new Set(prev).add(hash));
            requestAnimationFrame(() => {
                document.getElementById(`faq-${hash}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    }, [faq]);

    const toggle = useCallback((slug: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(slug)) next.delete(slug); else next.add(slug);
            return next;
        });
    }, []);

    const catLabel = (c: FaqCategory) => ({
        about: t('faq.category_about'),
        privacy: t('faq.category_privacy'),
        'getting-started': t('faq.category_getting_started'),
        process: t('faq.category_process'),
    }[c]);

    const question = (i: FaqItem) => pick(i.entry.questionEs, i.entry.questionEn, i.entry.questionPt);
    const answer = (i: FaqItem) => pick(i.entry.answerEs, i.entry.answerEn, i.entry.answerPt);

    // Group visible (search-filtered) entries by category, sorted within category.
    const q = norm(query.trim());
    const grouped = useMemo(() => {
        return CATEGORY_ORDER.map((cat) => {
            const items = faq
                .filter((i) => i.entry.category === cat)
                .filter((i) => !q || norm(`${question(i)} ${answer(i)}`).includes(q))
                .sort((a, b) => a.entry.order - b.entry.order);
            return { cat, items };
        }).filter((g) => g.items.length > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [faq, q, locale]);

    const hasResults = grouped.length > 0;

    return (
        <main className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-2xl mx-auto space-y-8">
                {/* Header */}
                <header className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-50 text-teal-700 mb-1">
                        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 1.8-2 3M12 17h.01" />
                        </svg>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-extrabold text-stone-900 tracking-tight">{t('faq.title')}</h1>
                    <p className="text-stone-500 text-sm">{t('faq.subtitle')}</p>
                </header>

                {/* Search */}
                <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3-3" />
                        </svg>
                    </span>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('faq.search_placeholder')}
                        aria-label={t('faq.search_placeholder')}
                        className="w-full rounded-xl border border-stone-200 bg-white text-stone-900 placeholder-stone-400 text-sm pl-11 pr-4 py-3 outline-none focus:border-teal-500 transition-colors"
                    />
                </div>

                {/* Jump chips (hidden while searching, since sections collapse) */}
                {!q && faq.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {CATEGORY_ORDER.map((cat) => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors whitespace-nowrap"
                            >
                                {catLabel(cat)}
                            </button>
                        ))}
                    </div>
                )}

                {/* Categories */}
                {hasResults ? (
                    <div className="space-y-8">
                        {grouped.map(({ cat, items }) => (
                            <section key={cat} id={`cat-${cat}`} className="scroll-mt-20 space-y-3">
                                <h2 className="text-xs font-bold uppercase tracking-wide text-stone-500 px-1">{catLabel(cat)}</h2>
                                {items.map((item) => {
                                    const isOpen = expanded.has(item.slug);
                                    return (
                                        <div
                                            key={item.slug}
                                            id={`faq-${item.slug}`}
                                            className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all scroll-mt-20 ${isOpen ? 'border-teal-200 shadow-md' : 'border-stone-200'}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggle(item.slug)}
                                                aria-expanded={isOpen}
                                                className="w-full px-5 py-4 text-left flex items-center justify-between gap-3 hover:bg-stone-50 transition-colors"
                                            >
                                                <span className="font-semibold text-stone-900 text-sm leading-snug">{question(item)}</span>
                                                <span className={`text-stone-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </span>
                                            </button>
                                            {isOpen && (
                                                <div className="px-5 pb-4 text-stone-600 text-sm leading-relaxed border-t border-stone-100 pt-3 space-y-2">
                                                    {answer(item).split('\n').map((p) => p.trim()).filter(Boolean).map((p, i) => (
                                                        <p key={i}>{renderInline(p)}</p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </section>
                        ))}
                    </div>
                ) : faq.length > 0 ? (
                    <p className="text-center text-stone-500 text-sm py-8">{t('faq.no_results')}</p>
                ) : null}

                {/* Bottom CTA */}
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 text-center space-y-3">
                    <p className="font-semibold text-stone-900 text-sm">{t('faq.cta_title')}</p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Link href="/guia" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors text-sm">
                            {t('faq.cta_guide')}
                        </Link>
                        <a href="mailto:privacidad@buenadoptante.com" className="text-stone-500 hover:text-stone-600 text-sm underline underline-offset-2 transition-colors">
                            {t('faq.cta_contact')}
                        </a>
                    </div>
                </div>
            </div>
        </main>
    );
}
