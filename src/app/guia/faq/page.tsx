'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type FaqItem = {
    slug: string;
    entry: {
        question: string;
        questionEs: string;
        questionEn: string;
        answerEs: string;
        answerEn: string;
        order: number;
    };
};

type LabelsData = {
    faqHeaderEs: string;
    faqHeaderEn: string;
    [key: string]: string;
};

export default function FaqPage() {
    const { locale, t } = useLanguage();
    const { data: session } = useSession();
    const isEnglish = locale === 'en';

    const [faq, setFaq] = useState<FaqItem[]>([]);
    const [labels, setLabels] = useState<LabelsData | null>(null);
    const [expandedFaq, setExpandedFaq] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/guide-content')
            .then((res) => res.json() as Promise<{ faq?: FaqItem[]; labels?: LabelsData }>)
            .then((data) => {
                setFaq(data.faq || []);
                setLabels(data.labels || null);
            })
            .catch((err) => console.error('[FAQ] Failed to load content:', err));
    }, [session]);

    const pick = <T,>(es: T, en: T) => (isEnglish ? en : es);

    const header = labels
        ? pick(labels.faqHeaderEs, labels.faqHeaderEn)
        : pick('Preguntas Frecuentes', 'Frequently Asked Questions');

    return (
        <main className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-2xl mx-auto space-y-8">
                {/* Header */}
                <header className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-50 mb-1">
                        <span className="text-3xl">❓</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-extrabold text-stone-900 tracking-tight">
                        {header}
                    </h1>
                    <p className="text-stone-500 text-sm">
                        {pick(
                            'Todo lo que necesitás saber sobre el proceso de adopción',
                            'Everything you need to know about the adoption process'
                        )}
                    </p>
                </header>

                {/* FAQ Accordion */}
                {faq.length > 0 && (
                    <section className="space-y-3">
                        {faq
                            .sort((a, b) => a.entry.order - b.entry.order)
                            .map((item) => {
                                const isExpanded = expandedFaq === item.slug;
                                return (
                                    <div
                                        key={item.slug}
                                        className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${isExpanded ? 'border-teal-200 shadow-md' : 'border-stone-200'}`}
                                    >
                                        <button
                                            onClick={() => setExpandedFaq(isExpanded ? null : item.slug)}
                                            className="w-full px-5 py-4 text-left flex items-center justify-between gap-3 hover:bg-stone-50 transition-colors"
                                        >
                                            <span className="font-semibold text-stone-900 text-sm leading-snug">
                                                {pick(item.entry.questionEs, item.entry.questionEn)}
                                            </span>
                                            <span className={`text-stone-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                            </span>
                                        </button>
                                        {isExpanded && (
                                            <div className="px-5 pb-4 text-stone-600 text-sm leading-relaxed border-t border-stone-100 pt-3">
                                                {pick(item.entry.answerEs, item.entry.answerEn)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </section>
                )}

                {/* Navigation */}
                <div className="flex items-center justify-center gap-4 pt-4">
                    <Link
                        href="/guia"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors text-sm"
                    >
                        ← {pick('Volver a la Guía', 'Back to Guide')}
                    </Link>
                    <Link
                        href="/"
                        className="text-stone-400 hover:text-stone-600 text-sm underline underline-offset-2 transition-colors"
                    >
                        {t('nav.back_to_search')}
                    </Link>
                </div>
            </div>
        </main>
    );
}
